import {SignatureV4} from "@smithy/signature-v4";
import {Sha256Node} from "@smithy/core/checksum";
import {HttpRequest} from "@smithy/core/protocols";
import {awsOrganizationTarget,type AwsOrganizationTarget} from "./aws-target";
import {withAwsAccount,collectAws,type AwsRuntime} from "./aws";
import {CollectionError} from "./collection-error";
import {readBoundedJson} from "./bounded-http";
import type {Observation} from "./observation";
import type {ConnectorCheck} from "./github";

const maxPages=6,accountLimit=6,host="organizations.us-east-1.amazonaws.com";
type OrgRead=(action:"DescribeOrganization"|"ListAccounts",body:Record<string,unknown>)=>Promise<any>;
export async function inspectAwsOrganization(t:AwsOrganizationTarget,read:OrgRead,collect:(id:string)=>Promise<Observation>){
  const org=(await read("DescribeOrganization",{}))?.Organization;
  if(org?.Id!==t.awsOrganizationId||(org.ManagementAccountId??org.MasterAccountId)!==t.accountId)throw new CollectionError("TARGET_MISMATCH");
  const accounts=new Map<string,string>(),tokens=new Set<string>();
  let token:string|undefined,finished=false;
  for(let page=0;page<maxPages;page++){
    const data=await read("ListAccounts",{MaxResults:20,...(token?{NextToken:token}:{})});
    if(!Array.isArray(data?.Accounts)||data.Accounts.length>20)throw new CollectionError("INVALID_RESPONSE");
    for(const account of data.Accounts){
      if(!/^\d{12}$/.test(account?.Id)||account.Arn!=="arn:aws:organizations::"+t.accountId+":account/"+t.awsOrganizationId+"/"+account.Id)throw new CollectionError("TARGET_MISMATCH");
      if(accounts.has(account.Id))throw new CollectionError("INVALID_RESPONSE");
      accounts.set(account.Id,typeof account.State==="string"?account.State:"UNKNOWN");
    }
    if(data.NextToken==null){finished=true;break;}
    if(typeof data.NextToken!=="string"||!data.NextToken.length||data.NextToken.length>100000||tokens.has(data.NextToken))throw new CollectionError("INVALID_RESPONSE");
    token=data.NextToken;tokens.add(token!);
  }
  if(finished&&!accounts.has(t.accountId))throw new CollectionError("TARGET_MISMATCH");
  const active=[...accounts].filter(([,state])=>state==="ACTIVE").map(([id])=>id).sort();
  const selected=active.slice(0,accountLimit),unknown=[...accounts.values()].filter(state=>!["ACTIVE","CLOSED","SUSPENDED","PENDING_CLOSURE","PENDING_ACTIVATION"].includes(state)).length;
  const follow="Review the account inventory, member roles and the selected CloudTrail region before relying on this evidence.";
  const checks:ConnectorCheck[]=[{id:"organization-inventory",label:"AWS Organizations account inventory",status:finished&&!unknown?"PASS":"UNKNOWN",
    observed:accounts.size+" accounts returned; "+active.length+" active; "+unknown+" unclassified; "+(finished?"pagination complete":"further pages omitted"),nextStep:follow}];
  let readAccounts=0;
  for(let start=0;start<selected.length;start+=2){
    const batch=await Promise.all(selected.slice(start,start+2).map(async id=>{
      try{
        const snapshot=await collect(id);
        if(!snapshot.checks.length)throw new CollectionError("INVALID_RESPONSE");
        const memberChecks=snapshot.checks.map(c=>({...c,id:id+"-"+c.id,label:id+" · "+c.label}));
        return [{id:id+"-access",label:id+" · member evidence",status:"PASS" as const,observed:"Member role and account identity verified.",nextStep:follow},...memberChecks];
      }catch(e){
        if(!(e instanceof CollectionError)||["AWS_TRUST_UNSCOPED","TARGET_MISMATCH","RATE_LIMITED","PROVIDER_TIMEOUT"].includes(e.code))throw e;
        return [{id:id+"-access",label:id+" · member evidence",status:"UNKNOWN" as const,observed:"Member evidence unavailable ("+e.code+")",nextStep:follow}];
      }
    }));
    for(const result of batch){if(result[0].status==="PASS")readAccounts++;checks.push(...result);}
  }
  checks.push({id:"member-coverage",label:"Active accounts examined in "+t.region,status:finished&&!unknown&&active.length>0&&readAccounts===active.length?"PASS":"UNKNOWN",
    observed:readAccounts+" of "+active.length+" returned active accounts examined; "+(active.length-readAccounts)+" omitted or inaccessible.",nextStep:follow});
  return {engine:"aws-organizations-evidence-1.0.0",sourceUrl:"https://console.aws.amazon.com/organizations/v2/home/accounts",
    checks,capturedAt:new Date().toISOString(),limitations:["Discovery is limited to six pages of twenty accounts and inspection of six active accounts, in account-number order. Checks cover S3 account public-access settings and CloudTrail for the selected region."]};
}
export async function collectAwsOrganization(input:AwsOrganizationTarget,organizationId:string,runtime:AwsRuntime & {fetcher?:typeof fetch}={}){
  const t=awsOrganizationTarget.parse(input),signal=runtime.signal??AbortSignal.timeout(25000),bounded={...runtime,signal};
  return withAwsAccount(t,organizationId,bounded,async(options)=>{
    const signer=new SignatureV4({service:"organizations",region:"us-east-1",sha256:Sha256Node,credentials:options.credentials});
    const read:OrgRead=async(action,input)=>{
      const body=JSON.stringify(input),headers={host,"content-type":"application/x-amz-json-1.1","x-amz-target":"AWSOrganizationsV20161128."+action};
      const request=await signer.sign(new HttpRequest({protocol:"https:",hostname:host,path:"/",method:"POST",headers,body}));
      const response=await (runtime.fetcher??fetch)("https://"+host+"/",{method:"POST",headers:request.headers,body,signal,redirect:"error",cache:"no-store"});
      if(!response.ok){
        const error=await readBoundedJson(response,16384).catch(()=>null);
        const type=String(error?.__type||error?.code||"").split("#").pop();
        if(response.status===429||type==="TooManyRequestsException")throw new CollectionError("RATE_LIMITED",60);
        throw new CollectionError(response.status===403||type==="AccessDeniedException"?"AWS_ROLE_ACCESS":"PROVIDER_UNAVAILABLE");
      }
      return readBoundedJson(response,256*1024);
    };
    return inspectAwsOrganization(t,read,id=>collectAws({accountId:id,region:t.region},organizationId,bounded));
  });
}
