import {CollectionError,type ConnectorCheck} from "./github";
const endpoint="https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies";
/** Aggregate configuration only. No policy names, IDs, users, groups or conditions
 * are persisted. Finding a requirement never proves all users are protected. */
export async function collectMicrosoftPolicy(get:(url:string)=>Promise<Response>,read:(response:Response,max?:number)=>Promise<any>){
 const counts={policies:0,enabled:0,reportOnly:0,disabled:0,unknown:0,explicitMfa:0,pages:0,complete:false};
 let next=endpoint+"?$select=id,state,grantControls",bytes=0;const seen=new Set<string>(),ids=new Set<string>();
 while(next&&counts.pages<3){
  const url=new URL(next);
  if(url.origin!=="https://graph.microsoft.com"||url.pathname!=="/v1.0/identity/conditionalAccess/policies"||url.username||url.password||url.hash)throw new CollectionError("UNSAFE_PAGINATION");
  if(seen.has(url.href))throw new CollectionError("PAGINATION_LOOP");seen.add(url.href);
  const response=await get(url.href);
  if(!response.ok){await response.body?.cancel();break;}
  const body=await read(response,262144);bytes+=Buffer.byteLength(JSON.stringify(body));
  if(bytes>524288)throw new CollectionError("RESPONSE_TOO_LARGE");
  if(!Array.isArray(body?.value)||body.value.length>200)throw new CollectionError("INVALID_RESPONSE");
  counts.pages++;
  for(const row of body.value){
   if(counts.policies>=200)break;
   if(!row||typeof row.id!=="string"||!row.id||row.id.length>100||ids.has(row.id))throw new CollectionError("INVALID_RESPONSE");ids.add(row.id);counts.policies++;
   if(row.state==="enabled")counts.enabled++;else if(row.state==="disabled")counts.disabled++;else if(row.state==="enabledForReportingButNotEnforced")counts.reportOnly++;else counts.unknown++;
   const controls=row.grantControls?.builtInControls;
   // OR with another control allows sign-in without MFA: never count it as required.
   if(row.state==="enabled"&&Array.isArray(controls)&&controls.includes("mfa")&&
     (row.grantControls.operator==="AND"||(row.grantControls.operator==="OR"&&controls.length===1&&
       !(row.grantControls.customAuthenticationFactors?.length)&&!(row.grantControls.termsOfUse?.length)&&!row.grantControls.authenticationStrength)))counts.explicitMfa++;
  }
  const link=body["@odata.nextLink"];
  if(link!==undefined&&(typeof link!=="string"||!link))throw new CollectionError("INVALID_RESPONSE");
  if(!link&&counts.policies<200){counts.complete=true;break;}
  if(counts.policies>=200)break;
  next=link||"";
 }
 const checks:ConnectorCheck[]=[
  {id:"conditional-access-coverage",label:"Conditional-access policy list fully retrieved",status:counts.complete&&!counts.unknown?"PASS":"UNKNOWN",observed:`${counts.policies} policies; ${counts.enabled} enabled; ${counts.reportOnly} report-only; ${counts.disabled} disabled; complete: ${counts.complete}`,nextStep:"Verify Policy.Read.All consent and Microsoft licensing; investigate missing pages or unknown states. Report-only policies are not enforced."},
  {id:"conditional-access-explicit-mfa",label:"An enabled policy explicitly requires MFA",status:counts.explicitMfa>0?"PASS":counts.complete&&!counts.unknown?"FAIL":"UNKNOWN",observed:`${counts.explicitMfa} enabled policies explicitly require the MFA grant control`,nextStep:"Assess user/app scope, exclusions, authentication-strength policies and sign-in results separately. This setting does not establish coverage or MFA enforcement for every account."}
 ];
 return {checks,coverage:counts};
}
