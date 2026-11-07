import {z} from "zod";
import {CollectionError,type ConnectorCheck} from "./github";
import type {Observation} from "./observation";
export const microsoftTarget=z.object({tenantId:z.uuid(),clientId:z.uuid()});
export type MicrosoftTarget=z.infer<typeof microsoftTarget>;
export type MicrosoftObservation=Observation&{engine:"microsoft365-identity-1.0.0";tenantId:string;coverage:{records:number;members:number;guests:number;unknownType:number;pages:number;complete:boolean;reportAvailable:boolean;staleRecords:number;missingDates:number};};
const GRAPH="https://graph.microsoft.com",REPORT="/v1.0/reports/authenticationMethods/userRegistrationDetails";
async function json(response:Response,max=1_000_000){
 if(!response.body)throw new CollectionError("EMPTY_RESPONSE");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new CollectionError("RESPONSE_TOO_LARGE");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch(e){await reader.cancel().catch(()=>{});if(e instanceof CollectionError)throw e;throw new CollectionError("INVALID_RESPONSE");}
}
function reportUrl(value:string){
 let url:URL;try{url=new URL(value);}catch{throw new CollectionError("UNSAFE_PAGINATION");}
 if(url.origin!==GRAPH||url.pathname!==REPORT||url.username||url.password||url.hash)throw new CollectionError("UNSAFE_PAGINATION");return url.href;
}
/** Read-only global-cloud adapter. No user identifiers, secrets or raw API responses
 * enter the returned observation. Registration/capability is never MFA enforcement. */
export async function collectMicrosoft365(target:MicrosoftTarget,secret:string,fetcher:typeof fetch=fetch):Promise<MicrosoftObservation>{
 const t=microsoftTarget.parse(target),signal=AbortSignal.timeout(25000);
 const auth=await fetcher("https://login.microsoftonline.com/"+t.tenantId+"/oauth2/v2.0/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:t.clientId,client_secret:secret,scope:GRAPH+"/.default",grant_type:"client_credentials"}).toString(),redirect:"error",cache:"no-store",signal});
 if(!auth.ok){await auth.body?.cancel();throw new CollectionError(auth.status===400||auth.status===401?"CREDENTIAL_REJECTED":"AUTH_UNAVAILABLE");}
 const token=await json(auth,20000);if(typeof token?.access_token!=="string"||token.access_token.length<10||token.access_token.length>16000||/[\r\n]/.test(token.access_token)||String(token.token_type).toLowerCase()!=="bearer")throw new CollectionError("INVALID_AUTH_RESPONSE");
 const get=async(url:string)=>{const response=await fetcher(url,{method:"GET",headers:{Authorization:"Bearer "+token.access_token,Accept:"application/json"},redirect:"error",cache:"no-store",signal});if(response.status===401){await response.body?.cancel();throw new CollectionError("CREDENTIAL_REJECTED");}return response;};
 const org=await get(GRAPH+"/v1.0/organization?$select=id");if(!org.ok){await org.body?.cancel();throw new CollectionError("TENANT_VERIFICATION_FAILED");}
 const organisation=await json(org,20000);if(!Array.isArray(organisation?.value)||organisation.value.length!==1||String(organisation.value[0]?.id).toLowerCase()!==t.tenantId.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 const limitations=["Point-in-time Microsoft Graph observations, not a compliance verdict or proof of MFA enforcement at sign-in.","The registration report excludes disabled users and can lag changes. Guest accounts are counted separately; policy effectiveness, conditional-access scope and sign-in activity are not evaluated.","Only aggregate counts/settings are retained. Microsoft responses may contain identifiers in transient server memory; no user names, emails or account IDs are saved in this observation."];
 let defaults:boolean|null=null;
 const defaultsResponse=await get(GRAPH+"/v1.0/policies/identitySecurityDefaultsEnforcementPolicy?$select=isEnabled");
 if(defaultsResponse.ok){const body=await json(defaultsResponse,20000);if(typeof body?.isEnabled==="boolean")defaults=body.isEnabled;else limitations.push("Security-default response was incomplete.");}else{await defaultsResponse.body?.cancel();limitations.push("Security defaults could not be read. Verify Policy.Read.All consent and service availability.");}
 const coverage={records:0,members:0,guests:0,unknownType:0,pages:0,complete:true,reportAvailable:true,staleRecords:0,missingDates:0};
 const counts={registered:0,notRegistered:0,capable:0,notCapable:0,unknown:0,admins:0,adminCapable:0,adminNotCapable:0,adminUnknown:0};
 let next=GRAPH+REPORT,bytesRead=0;const seen=new Set<string>(),ids=new Set<string>();
 while(next){
  const url=reportUrl(next);if(seen.has(url))throw new CollectionError("PAGINATION_LOOP");seen.add(url);
  if(coverage.pages>=10||coverage.records>=2000){coverage.complete=false;break;}
  const response=await get(url);if(!response.ok){await response.body?.cancel();coverage.complete=false;coverage.reportAvailable=false;limitations.push("MFA registration report unavailable or incomplete. Check AuditLog.Read.All consent, required Microsoft licensing and throttling.");break;}
  const data=await json(response);bytesRead+=Buffer.byteLength(JSON.stringify(data),"utf8");if(bytesRead>2_000_000)throw new CollectionError("RESPONSE_TOO_LARGE");if(!Array.isArray(data?.value)||data.value.length>2000)throw new CollectionError("INVALID_RESPONSE");coverage.pages++;
  for(const row of data.value){
   if(coverage.records>=2000){coverage.complete=false;break;}
   if(!row||typeof row!=="object"||typeof row.id!=="string"||!row.id.length||row.id.length>100||ids.has(row.id))throw new CollectionError("INVALID_RESPONSE");ids.add(row.id);coverage.records++;
   const updated=typeof row.lastUpdatedDateTime==="string"?Date.parse(row.lastUpdatedDateTime):NaN;
   if(!Number.isFinite(updated))coverage.missingDates++;else if(Date.now()-updated>48*3600000||updated>Date.now()+300000)coverage.staleRecords++;
   if(row.userType==="guest"){coverage.guests++;continue;}if(row.userType!=="member"){coverage.unknownType++;continue;}coverage.members++;
   if(typeof row.isMfaRegistered!=="boolean"||typeof row.isMfaCapable!=="boolean"||typeof row.isAdmin!=="boolean")counts.unknown++;
   if(row.isMfaRegistered===true)counts.registered++;if(row.isMfaRegistered===false)counts.notRegistered++;
   if(row.isMfaCapable===true)counts.capable++;if(row.isMfaCapable===false)counts.notCapable++;
   if(row.isAdmin===true){counts.admins++;if(row.isMfaCapable===true)counts.adminCapable++;else if(row.isMfaCapable===false)counts.adminNotCapable++;else counts.adminUnknown++;}
  }
  const link=data["@odata.nextLink"];if(link!==undefined&&(typeof link!=="string"||!link.length))throw new CollectionError("INVALID_RESPONSE");next=link?reportUrl(link):"";
 }
 const fresh=coverage.reportAvailable&&!coverage.staleRecords&&!coverage.missingDates,complete=coverage.complete&&!coverage.unknownType&&!counts.unknown;
 const status=(total:number,negative:number,unknown=0):ConnectorCheck["status"]=>!fresh?"UNKNOWN":negative>0?"FAIL":complete&&total>0&&!unknown?"PASS":"UNKNOWN";
 const checks:ConnectorCheck[]=[
  {id:"security-defaults",label:"Microsoft security defaults enabled",status:defaults===true?"PASS":"UNKNOWN",observed:defaults===null?"Not established":defaults?"Enabled":"Disabled; alternative access policies require review",nextStep:"Review security defaults or the scope of your conditional-access policies. Disabled defaults alone do not prove MFA is missing."},
  {id:"member-mfa-registration",label:"Reported member accounts registered for MFA",status:status(coverage.members,counts.notRegistered),observed:`${counts.registered} registered; ${counts.notRegistered} not registered; ${coverage.members} member accounts returned`,nextStep:"Review unregistered accounts in Microsoft Entra. Registration does not mean MFA is required at sign-in."},
  {id:"member-mfa-capability",label:"Reported member accounts capable of MFA",status:status(coverage.members,counts.notCapable),observed:`${counts.capable} capable; ${counts.notCapable} not capable; ${counts.unknown} incomplete records`,nextStep:"Check allowed authentication methods and enrolment. Verify policy enforcement separately."},
  {id:"admin-mfa-capability",label:"Reported administrator accounts capable of MFA",status:status(counts.admins,counts.adminNotCapable,counts.adminUnknown),observed:`${counts.adminCapable} capable; ${counts.adminNotCapable} not capable; ${counts.admins} administrator accounts returned`,nextStep:"Investigate privileged accounts and any emergency-access exceptions with your Microsoft administrator."},
  {id:"registration-coverage",label:"Registration report complete and recent within this collection",status:fresh&&complete&&coverage.records>0?"PASS":"UNKNOWN",observed:`${coverage.records} records across ${coverage.pages} pages; ${coverage.staleRecords} older than 48 hours or future-dated; ${coverage.missingDates} missing dates; ${coverage.unknownType} unknown account types`,nextStep:"Resolve missing permissions, licensing, report freshness or collection limits before relying on aggregate coverage."}
 ];
 if(!coverage.complete)limitations.push("Collection is incomplete: limit, permissions or availability prevented reading the entire report. No all-account pass is inferred.");
 return {engine:"microsoft365-identity-1.0.0",tenantId:t.tenantId.toLowerCase(),sourceUrl:"https://entra.microsoft.com/",capturedAt:new Date().toISOString(),checks,coverage,limitations};
}
