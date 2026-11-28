import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {awsBinding} from "../../lib/connectors/aws-target";

export const accountId="222222222222",brokerArn="arn:aws:iam::111111111111:role/pilot-broker";
type Options={loose?:"missing"|"incorrect";wrongAccount?:boolean;wrongRole?:boolean;deny?:boolean;absentBlock?:boolean;throttle?:boolean;deliveryError?:boolean;ageHours?:number};
type Request={hostname:string;headers:Record<string,string>;body?:unknown;path:string;method:string};
export function awsTransport(orgId:string,opts:Options={}){
  const binding=awsBinding(orgId),calls:string[]=[],externalIds:Array<string|null>=[];
  const arn="arn:aws:cloudtrail:eu-west-2:"+accountId+":trail/customer-trail";
  const region="eu-west-2";
  const xml=(s:string)=>s;
  const response=(content:string,statusCode=200,json=false)=>({response:{statusCode,headers:{"content-type":json?"application/x-amz-json-1.1":"text/xml"},body:Readable.from([Buffer.from(content)])}});
  function stsError(reason:string){return response(xml('<ErrorResponse><Error><Type>Sender</Type><Code>'+reason+'</Code><Message>fixture</Message></Error><RequestId>fixture</RequestId></ErrorResponse>'),403);}
  function credentials(key:string){return '<Credentials><AccessKeyId>'+key+'</AccessKeyId><SecretAccessKey>fixture-secret</SecretAccessKey><SessionToken>fixture-session</SessionToken><Expiration>'+new Date(Date.now()+900000).toISOString()+'</Expiration></Credentials>';}
  function sts(action:string,inner:string){return response('<'+action+'Response xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><'+action+'Result>'+inner+'</'+action+'Result></'+action+'Response>');}
  const handler={async handle(r:Request){
    const auth=r.headers.authorization??"";
    if(r.hostname==="sts."+region+".amazonaws.com"){
      const fields=new URLSearchParams(typeof r.body==="string"?r.body:Buffer.from(r.body as Uint8Array).toString());
      const action=fields.get("Action")!;calls.push(action);
      if(action==="AssumeRoleWithWebIdentity"){
        assert.equal(fields.get("WebIdentityToken"),"fixture-oidc-token");assert.equal(fields.get("RoleArn"),brokerArn);
        return sts(action,credentials("BROKERKEY"));
      }
      if(action==="AssumeRole"){
        assert.match(auth,/Credential=BROKERKEY\//);assert.equal(fields.get("RoleArn"),"arn:aws:iam::"+accountId+":role/"+binding.roleName);
        const external=fields.get("ExternalId");externalIds.push(external);
        if(external===binding.externalId||(!external&&opts.loose==="missing")||(external&&external!==binding.externalId&&opts.loose==="incorrect"))return sts(action,credentials("CUSTOMERKEY"));
        return stsError("AccessDenied");
      }
      assert.equal(action,"GetCallerIdentity");assert.match(auth,/Credential=CUSTOMERKEY\//);
      return sts(action,"<Account>"+(opts.wrongAccount?"333333333333":accountId)+"</Account><Arn>arn:aws:sts::"+accountId+":assumed-role/"+(opts.wrongRole?"another":binding.roleName)+"/regpilot-evidence</Arn>");
    }
    assert.match(auth,/Credential=CUSTOMERKEY\//);
    if(r.hostname===accountId+".s3-control."+region+".amazonaws.com"){
      calls.push("GetPublicAccessBlock");assert.equal(r.method,"GET");assert.match(r.path,/publicAccessBlock$/);
      if(opts.deny||opts.absentBlock)return response("<Error><Code>"+(opts.deny?"AccessDenied":"NoSuchPublicAccessBlockConfiguration")+"</Code><Message>fixture</Message></Error>",opts.deny?403:404);
      return response("<PublicAccessBlockConfiguration><BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>");
    }
    assert.equal(r.hostname,"cloudtrail."+region+".amazonaws.com");
    const action=r.headers["x-amz-target"].split(".")[1];calls.push(action);
    if(opts.throttle)return response(JSON.stringify({__type:"ThrottlingException",message:"fixture"}),400,true);
    if(opts.deny)return response(JSON.stringify({__type:"AccessDeniedException",message:"fixture"}),403,true);
    const params=JSON.parse(typeof r.body==="string"?r.body:Buffer.from(r.body as Uint8Array).toString());
    if(action==="DescribeTrails"){assert.equal(params.includeShadowTrails,true);return response(JSON.stringify({trailList:[{TrailARN:arn,HomeRegion:region,IsMultiRegionTrail:true,LogFileValidationEnabled:true}]}),200,true);}
    if(action==="GetTrailStatus"){assert.equal(params.Name,arn);const at=Math.floor(Date.now()/1000)-(opts.ageHours??1)*3600;
      return response(JSON.stringify({IsLogging:true,LatestDeliveryTime:at,LatestDigestDeliveryTime:at,LatestDeliveryError:opts.deliveryError?"fixture-private-bucket":undefined}),200,true);}
    assert.equal(action,"GetEventSelectors");assert.equal(params.TrailName,arn);
    return response(JSON.stringify({TrailARN:arn,EventSelectors:[{ReadWriteType:"All",IncludeManagementEvents:true}]}),200,true);
  }};
  return {runtime:{token:async()=>"fixture-oidc-token",requestHandler:handler},calls,externalIds};
}
