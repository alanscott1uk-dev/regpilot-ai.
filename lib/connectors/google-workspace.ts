import {resilientGet} from './resilient-http';
import {z} from "zod";
import {CollectionError,type ConnectorCheck} from "./github";
import type {Observation} from "./observation";
export const googleTarget=z.object({customerId:z.string().regex(/^C[A-Za-z0-9]{6,30}$/),clientId:z.string().max(120).regex(/^[A-Za-z0-9_-]{10,160}\.apps\.googleusercontent\.com$/)});
export const googleCredentials=z.object({clientSecret:z.string().min(16).max(512).regex(/^[^\r\n\0]+$/),refreshToken:z.string().min(20).max(4096).regex(/^[^\r\n\0]+$/)});
export type GoogleTarget=z.infer<typeof googleTarget>;
const BASE="https://admin.googleapis.com/admin/directory/v1";
async function json(response:Response,max=500000){
 const reader=response.body?.getReader();if(!reader)throw new CollectionError("EMPTY_RESPONSE");const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw new CollectionError("RESPONSE_TOO_LARGE");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch(e){if(e instanceof CollectionError)throw e;throw new CollectionError("INVALID_RESPONSE");}finally{await reader.cancel().catch(()=>{});}
}
/** Explicit-customer, read-only directory collection. Retains aggregates only. */
export async function collectGoogleWorkspace(target:GoogleTarget,credential:string,fetcher:typeof fetch=fetch){
 const t=googleTarget.parse(target);let secret:z.infer<typeof googleCredentials>;
 try{secret=googleCredentials.parse(JSON.parse(credential));}catch{throw new CollectionError("CREDENTIAL_UNAVAILABLE");}
 const started=Date.now(),signal=AbortSignal.timeout(25000);
 const auth=await fetcher("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:t.clientId,client_secret:secret.clientSecret,refresh_token:secret.refreshToken,grant_type:"refresh_token"}).toString(),cache:"no-store",redirect:"error",signal});
 if(!auth.ok){await auth.body?.cancel();throw new CollectionError([400,401].includes(auth.status)?"CREDENTIAL_REJECTED":"AUTH_UNAVAILABLE");}
 const token=await json(auth,20000);
 if(typeof token.access_token!=="string"||token.access_token.length<10||token.access_token.length>16000||/[\r\n]/.test(token.access_token)||String(token.token_type).toLowerCase()!=="bearer")throw new CollectionError("INVALID_AUTH_RESPONSE");
 const read=resilientGet(fetcher,'https://admin.googleapis.com',{Authorization:'Bearer '+token.access_token,Accept:'application/json'},{timeoutMs:Math.max(1,25000-(Date.now()-started)),maxRequests:24});
 const get=async(url:string)=>{const r=await read(url);if(r.status===401){await r.body?.cancel();throw new CollectionError("CREDENTIAL_REJECTED");}return r;};
 const customerResponse=await get(BASE+"/customers/"+encodeURIComponent(t.customerId)+"?fields=id");
 if(!customerResponse.ok){await customerResponse.body?.cancel();throw new CollectionError("TENANT_VERIFICATION_FAILED");}
 const customer=await json(customerResponse,20000);if(customer?.id!==t.customerId)throw new CollectionError("TARGET_MISMATCH");
 const coverage={records:0,active:0,suspended:0,archived:0,unknownStatus:0,pages:0,complete:true,available:true};
 const counts={enrolled:0,notEnrolled:0,enforced:0,notEnforced:0,unknown:0,admins:0,adminEnforced:0,adminNotEnforced:0,adminUnknown:0};
 let pageToken="",totalBytes=0;const pages=new Set<string>(),ids=new Set<string>();
 do{
  if(coverage.pages>=10||coverage.records>=2000){coverage.complete=false;break;}
  if(pages.has(pageToken))throw new CollectionError("PAGINATION_LOOP");pages.add(pageToken);
  const query=new URLSearchParams({customer:t.customerId,maxResults:"200",projection:"full",viewType:"admin_view",fields:"nextPageToken,users(id,customerId,suspended,archived,isAdmin,isDelegatedAdmin,isEnrolledIn2Sv,isEnforcedIn2Sv)"});
  if(pageToken)query.set("pageToken",pageToken);
  const response=await get(BASE+"/users?"+query);
  if(!response.ok){await response.body?.cancel();coverage.complete=false;coverage.available=false;break;}
  const body=await json(response);totalBytes+=Buffer.byteLength(JSON.stringify(body));if(totalBytes>2000000)throw new CollectionError("RESPONSE_TOO_LARGE");
  // An omitted users array can represent an empty Google directory. Never infer all-account coverage from it.
  if(body?.users!==undefined&&!Array.isArray(body.users)||body?.users?.length>2000)throw new CollectionError("INVALID_RESPONSE");
  coverage.pages++;
  for(const row of body.users||[]){
   if(coverage.records>=2000){coverage.complete=false;break;}
   if(!row||typeof row.id!=="string"||!row.id||row.id.length>200||ids.has(row.id))throw new CollectionError("INVALID_RESPONSE");
   if(row.customerId!==t.customerId)throw new CollectionError("TARGET_MISMATCH");ids.add(row.id);coverage.records++;
   if(row.archived===true){coverage.archived++;continue;}if(row.suspended===true){coverage.suspended++;continue;}
   if(row.suspended!==false||row.archived!==false){coverage.unknownStatus++;continue;}coverage.active++;
   if(typeof row.isEnrolledIn2Sv!=="boolean"||typeof row.isEnforcedIn2Sv!=="boolean"||typeof row.isAdmin!=="boolean"||typeof row.isDelegatedAdmin!=="boolean")counts.unknown++;
   if(row.isEnrolledIn2Sv===true)counts.enrolled++;if(row.isEnrolledIn2Sv===false)counts.notEnrolled++;
   if(row.isEnforcedIn2Sv===true)counts.enforced++;if(row.isEnforcedIn2Sv===false)counts.notEnforced++;
   if(row.isAdmin===true||row.isDelegatedAdmin===true){counts.admins++;if(row.isEnforcedIn2Sv===true)counts.adminEnforced++;else if(row.isEnforcedIn2Sv===false)counts.adminNotEnforced++;else counts.adminUnknown++;}
  }
  const next=body.nextPageToken;if(next!==undefined&&(typeof next!=="string"||!next||next.length>2048||/[\r\n\0]/.test(next)))throw new CollectionError("INVALID_RESPONSE");
  if(next&&!(body.users?.length))throw new CollectionError("INVALID_RESPONSE");pageToken=next||"";
 }while(pageToken);
 const complete=coverage.complete&&coverage.available&&!coverage.unknownStatus&&!counts.unknown;
 const status=(total:number,negative:number,unknown=0):ConnectorCheck["status"]=>!coverage.available?"UNKNOWN":negative?"FAIL":complete&&total>0&&!unknown?"PASS":"UNKNOWN";
 const checks:ConnectorCheck[]=[
  {id:"active-2sv-enrolment",label:"Active accounts enrolled in 2-step verification",status:status(coverage.active,counts.notEnrolled),observed:counts.enrolled+" enrolled; "+counts.notEnrolled+" not enrolled; "+coverage.active+" active accounts returned",nextStep:"Review unenrolled users and approved exceptions. Enrolment alone is not enforcement."},
  {id:"active-2sv-enforcement",label:"Google reports 2-step verification enforced for active accounts",status:status(coverage.active,counts.notEnforced),observed:counts.enforced+" enforced; "+counts.notEnforced+" not enforced",nextStep:"Check organisational-unit policy, enrolment grace periods and exceptions with your Google administrator."},
  {id:"admin-2sv-enforcement",label:"Google reports 2-step verification enforced for administrators",status:status(counts.admins,counts.adminNotEnforced,counts.adminUnknown),observed:counts.adminEnforced+" enforced; "+counts.adminNotEnforced+" not enforced; "+counts.admins+" active administrators returned",nextStep:"Review super and delegated administrator accounts and emergency-access arrangements."},
  {id:"directory-coverage",label:"Directory collection complete within configured limits",status:complete&&coverage.active>0?"PASS":"UNKNOWN",observed:coverage.records+" records; "+coverage.pages+" pages; "+coverage.suspended+" suspended; "+coverage.archived+" archived; "+coverage.unknownStatus+" unknown account states",nextStep:"Resolve missing permissions, unknown fields and collection limits before relying on complete coverage."}
 ];
 return {engine:"google-workspace-identity-1.0.0",customerId:t.customerId,sourceUrl:"https://admin.google.com/",capturedAt:new Date().toISOString(),checks,coverage,limitations:["Point-in-time Directory API settings, not proof of sign-in enforcement or compliance. Google changes can take time to appear.","Only aggregate counts are retained. Account IDs are used transiently for deduplication; names, emails, credentials and raw responses are not saved.","Suspended and archived accounts are counted separately. Sign-in activity, device posture, application access and exception suitability are not assessed.",...(!complete?["Coverage is incomplete or uncertain. No all-account pass is inferred."]:[])]} satisfies Observation&{customerId:string;coverage:typeof coverage};
}
