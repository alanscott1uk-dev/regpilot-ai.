import type {AdvancedEventSelector,EventSelector,GetTrailStatusCommandOutput,Trail} from "@aws-sdk/client-cloudtrail";
import type {PublicAccessBlockConfiguration} from "@aws-sdk/client-s3-control";
import type {AwsTarget} from "./aws-target";
import {awsRegion} from "./aws-target";
import type {Observation} from "./observation";
import {CollectionError,type ConnectorCheck} from "./github";

type Answer=boolean|null;
type Selectors={EventSelectors?:EventSelector[];AdvancedEventSelectors?:AdvancedEventSelector[]};
type TrailStatus=Pick<GetTrailStatusCommandOutput,"IsLogging"|"LatestDeliveryTime"|"LatestDeliveryError"|"LatestDigestDeliveryTime"|"LatestDigestDeliveryError">;
export type AwsEvidenceReader={
  publicBlock():Promise<PublicAccessBlockConfiguration|null>;
  trails():Promise<Trail[]|null>;
  status(arn:string):Promise<TrailStatus|null>;
  selectors(arn:string,home:string):Promise<Selectors|null>;
};
const all=(values:Answer[]):Answer=>values.includes(false)?false:values.includes(null)?null:true;
const any=(values:Answer[]):Answer=>values.includes(true)?true:values.includes(null)?null:false;
const boolean=(value:unknown):Answer=>typeof value==="boolean"?value:null;

function advancedSide(selectors:AdvancedEventSelector[],read:boolean):Answer{
  const possible:Answer[]=[];
  for(const selector of selectors){
    const fields=selector.FieldSelectors;
    if(!fields?.length){possible.push(null);continue;}
    const category=fields.filter(f=>f.Field==="eventCategory");
    if(category.length!==1||!category[0].Equals?.length){possible.push(null);continue;}
    if(!category[0].Equals.includes("Management"))continue;
    if(fields.some(f=>Object.keys(f).some(k=>k!=="Field"&&k!=="Equals"))){possible.push(null);continue;}
    const restrictions=fields.filter(f=>f.Field!=="eventCategory");
    if(!restrictions.length)return true;
    if(restrictions.length===1&&restrictions[0].Field==="readOnly"&&restrictions[0].Equals?.length){
      if(restrictions[0].Equals.includes(String(read)))return true;
    }else possible.push(null);
  }
  return any(possible);
}
export function managementEvents(selectors:Selectors|null):Answer{
  if(!selectors)return null;
  const basic=selectors.EventSelectors,advanced=selectors.AdvancedEventSelectors;
  if(basic?.length&&advanced?.length)return null;
  if(advanced?.length)return all([advancedSide(advanced,true),advancedSide(advanced,false)]);
  if(!basic?.length)return null;
  const side=(type:"ReadOnly"|"WriteOnly"):Answer=>any(basic.map(s=>{
    if(s.IncludeManagementEvents===false)return false;
    if(typeof s.IncludeManagementEvents!=="boolean"||!s.ReadWriteType)return null;
    if(!["All","ReadOnly","WriteOnly"].includes(s.ReadWriteType))return null;
    if(s.ReadWriteType!==type&&s.ReadWriteType!=="All")return false;
    return s.ExcludeManagementEventSources?.length?null:true;
  }));
  return all([side("ReadOnly"),side("WriteOnly")]);
}
type TrailFinding={logging:Answer;management:Answer;integrity:Answer;logs:Answer;digests:Answer};
function delivery(at:Date|undefined,error:string|undefined,now:number):Answer{
  if(error?.trim())return false;
  const age=now-(at?.getTime()??NaN);
  return Number.isFinite(age)&&age>=0&&age<=24*3600000?true:null;
}
async function inspectTrail(t:Trail,target:AwsTarget,reader:AwsEvidenceReader,now:number):Promise<TrailFinding>{
  const arn=t.TrailARN,home=t.HomeRegion;
  const match=arn?.match(/^arn:aws:cloudtrail:([a-z0-9-]+):(\d{12}):trail\/[A-Za-z0-9_.-]{1,128}$/);
  if(!match||!home||home!==match[1]||(match[2]!==target.accountId&&t.IsOrganizationTrail!==true)||
    (home!==target.region&&t.IsMultiRegionTrail===false))throw new CollectionError("TARGET_MISMATCH");
  const unknown={logging:null,management:null,integrity:null,logs:null,digests:null};
  if(!awsRegion.safeParse(home).success||(home!==target.region&&t.IsMultiRegionTrail!==true))return unknown;
  const [status,selectors]=await Promise.all([reader.status(arn!),reader.selectors(arn!,home)]);
  return {logging:boolean(status?.IsLogging),management:managementEvents(selectors),integrity:boolean(t.LogFileValidationEnabled),
    logs:delivery(status?.LatestDeliveryTime,status?.LatestDeliveryError,now),
    digests:delivery(status?.LatestDigestDeliveryTime,status?.LatestDigestDeliveryError,now)};
}
export async function awsPosture(target:AwsTarget,reader:AwsEvidenceReader,now=Date.now()):Promise<Observation>{
  const [block,trails]=await Promise.all([reader.publicBlock(),reader.trails()]);
  const keys=["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"] as const;
  const labels=["Reject public ACLs","Ignore public ACLs","Reject public bucket policies","Restrict public buckets"];
  const checks:ConnectorCheck[]=keys.map((key,i)=>({id:"s3-"+key.toLowerCase(),label:"S3 account setting · "+labels[i],
    status:block?.[key]===true?"PASS":block?.[key]===false?"FAIL":"UNKNOWN",
    observed:block?.[key]===true?"Enabled":block?.[key]===false?"Disabled":"Account setting unavailable",
    nextStep:"Review the account-level setting and any required exceptions with the storage owner."}));
  const rows:TrailFinding[]=[];
  const ordered=trails?.slice().sort((a,b)=>(a.TrailARN??"").localeCompare(b.TrailARN??""));
  const incomplete=!ordered||ordered.length>10;
  if(ordered&&new Set(ordered.map(t=>t.TrailARN)).size!==ordered.length)throw new CollectionError("INVALID_RESPONSE");
  for(const trail of (ordered??[]).slice(0,10))rows.push(await inspectTrail(trail,target,reader,now));
  function coverage(id:string,label:string,assess:(row:TrailFinding)=>Answer){
    const results=rows.map(assess),decision=any(incomplete?[...results,null]:results);
    checks.push({id,label,status:decision===true?"PASS":decision===false?"FAIL":"UNKNOWN",
      observed:`${results.filter(v=>v===true).length} confirmed, ${results.filter(v=>v===false).length} exceptions, ${results.filter(v=>v===null).length} unresolved across ${rows.length} examined trails in ${target.region}. ${incomplete?"Inventory incomplete.":"Inventory returned in full."}`,
      nextStep:"Review the trail's regional logging state, event selectors and log-file validation together in CloudTrail."});
  }
  coverage("trail-active","At least one trail is logging in the selected region",r=>r.logging);
  coverage("trail-management","An active trail captures unrestricted management reads and writes",r=>all([r.logging,r.management]));
  coverage("trail-validated","An active trail has log-file validation enabled",r=>all([r.logging,r.integrity]));
  coverage("trail-combined","The same active trail covers management reads, writes and integrity validation",r=>all([r.logging,r.management,r.integrity]));
  coverage("trail-delivery","An active trail delivered log files to S3 within 24 hours",r=>all([r.logging,r.logs]));
  coverage("trail-delivery-integrity","One qualifying trail delivered both logs and integrity digests to S3 within 24 hours",r=>all([r.logging,r.management,r.integrity,r.logs,r.digests]));
  return {engine:"aws-account-evidence-1.0.0",sourceUrl:"https://"+target.region+".console.aws.amazon.com/cloudtrail/home?region="+target.region,
    capturedAt:new Date(now).toISOString(),checks,limitations:[
      "STS verified AWS account "+target.accountId+" for this collection in "+target.region+".",
    "S3 results describe effective account-level public access settings. Bucket-specific policies, object contents and individual access are outside this collection.",
      "CloudTrail evidence covers one region and up to ten visible trails. Unsupported home regions, restricted selectors and unreadable settings limit the conclusion. An old or missing S3 delivery timestamp is unresolved. A reported delivery error is an exception. Delivery of specific events and cryptographic verification of individual digests require separate evidence."
    ]};
}
