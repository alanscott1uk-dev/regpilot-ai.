import {z} from "zod";
export const githubTarget=z.object({repository:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/).refine(s=>![".",".."].includes(s.split("/")[1])),branch:z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(s=>!s.includes(".."))});
export type ConnectorCheck={id:string;label:string;status:"PASS"|"FAIL"|"UNKNOWN";observed:string;nextStep:string};
export type GithubObservation={engine:"github-branch-2.0.0";repository:string;branch:string;sourceUrl:string;capturedAt:string;checks:ConnectorCheck[];limitations:string[]};
export class CollectionError extends Error{constructor(public code:string){super("Connected evidence could not be collected");}}
async function boundedJson(response:Response){
 if(!response.headers.get("content-type")?.includes("json"))throw new CollectionError("INVALID_RESPONSE");
 if(!response.body)throw new CollectionError("EMPTY_RESPONSE");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>262144)throw new CollectionError("RESPONSE_TOO_LARGE");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch(e){if(e instanceof CollectionError)throw e;throw new CollectionError("INVALID_RESPONSE");}finally{await reader.cancel().catch(()=>{});}
}
/** Fixed-origin reads only. Rules describe configured requirements; bypass actors and
 * actual enforcement are separate questions. Missing access never means compliant. */
export async function collectGithub(target:{repository:string;branch:string},token:string,fetcher:typeof fetch=fetch):Promise<GithubObservation>{
 const value=githubTarget.parse(target),[owner,repo]=value.repository.split("/"),branch=encodeURIComponent(value.branch);
 const base="https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo),signal=AbortSignal.timeout(25000);
 const get=async(path:string,optional=false)=>{
  const url=base+path;
  let r:Response;try{r=await fetcher(url,{method:"GET",headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2026-03-10"},redirect:"error",cache:"no-store",signal});}catch{throw new CollectionError("PROVIDER_UNAVAILABLE");}
  if(r.url&&r.url!==url){await r.body?.cancel();throw new CollectionError("TARGET_MISMATCH");}
  if(!r.ok){await r.body?.cancel();if(optional&&[403,404].includes(r.status))return null;throw new CollectionError(r.status===401?"CREDENTIAL_REJECTED":[403,429].includes(r.status)?"ACCESS_OR_RATE_LIMIT":"COLLECTION_UNAVAILABLE");}
  return {body:await boundedJson(r),more:/rel="next"/.test(r.headers.get("link")||"")};
 };
 const metadata=(await get(""))!.body;
 if(typeof metadata?.full_name!=="string"||metadata.full_name.toLowerCase()!==value.repository.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 const branchData=(await get("/branches/"+branch))!.body;
 if(branchData?.name!==value.branch)throw new CollectionError("TARGET_MISMATCH");
 const protection=(await get("/branches/"+branch+"/protection",true))?.body||null;
 if(protection&&(typeof protection!=="object"||Array.isArray(protection)))throw new CollectionError("INVALID_RESPONSE");
 const rules:any[]=[];let complete=false,pages=0;
 for(let page=1;page<=3;page++){
  const r=await get("/rules/branches/"+branch+"?per_page=100&page="+page,true);
  if(!r)break;
  if(!Array.isArray(r.body)||r.body.length>100||r.body.some((x:any)=>!x||typeof x.type!=="string"))throw new CollectionError("INVALID_RESPONSE");
  rules.push(...r.body);pages++;
  if(!r.more&&r.body.length<100){complete=true;break;}
 }
 const workflow=(await get("/actions/permissions/workflow",true))?.body;
 const count=protection?.required_pull_request_reviews?.required_approving_review_count,admins=protection?.enforce_admins?.enabled,force=protection?.allow_force_pushes?.enabled;
 const checks:ConnectorCheck[]=[
 {id:"peer-review",label:"Classic protection requires an approving review",status:Number.isInteger(count)?count>=1?"PASS":"FAIL":protection&&protection.required_pull_request_reviews===null?"FAIL":"UNKNOWN",observed:Number.isInteger(count)?String(count)+" required approval(s)":"Not established",nextStep:"Review classic protection alongside applicable rulesets and bypass actors."},
 {id:"admin-enforcement",label:"Classic protection applies to administrators",status:typeof admins==="boolean"?admins?"PASS":"FAIL":"UNKNOWN",observed:typeof admins==="boolean"?String(admins):"Not established",nextStep:"Check administrator bypass policy and separate rulesets."},
 {id:"force-push",label:"Classic protection disallows force pushes",status:typeof force==="boolean"?force?"FAIL":"PASS":"UNKNOWN",observed:typeof force==="boolean"?"Force pushes allowed: "+force:"Not established",nextStep:"Check force-push exceptions and repository rulesets."},
 {id:"ruleset-coverage",label:"Applicable active ruleset list fully retrieved",status:complete?"PASS":"UNKNOWN",observed:`${rules.length} active rules across ${pages} pages; complete: ${complete}`,nextStep:"Resolve permissions or collection limits. An empty list is not a protected branch."}
 ];
 const ruleCheck=(id:string,label:string,predicate:(r:any)=>boolean)=>{
  const found=rules.some(predicate);checks.push({id,label,status:found?"PASS":complete?"FAIL":"UNKNOWN",observed:found?"Required by an applicable active ruleset":complete?"Requirement not found in active rulesets":"Not established",nextStep:"Assess classic protection, ruleset bypass actors and actual operation before relying on this setting."});
 };
 ruleCheck("ruleset-peer-review","Active ruleset requires an approving review",r=>r.type==="pull_request"&&Number.isInteger(r.parameters?.required_approving_review_count)&&r.parameters.required_approving_review_count>=1);
 ruleCheck("ruleset-status-checks","Active ruleset requires named status checks",r=>r.type==="required_status_checks"&&Array.isArray(r.parameters?.required_status_checks)&&r.parameters.required_status_checks.some((x:any)=>typeof x?.context==="string"&&x.context.trim()));
 ruleCheck("ruleset-force-push","Active ruleset blocks non-fast-forward pushes",r=>r.type==="non_fast_forward");
 ruleCheck("ruleset-deletion","Active ruleset restricts branch deletion",r=>r.type==="deletion");
 ruleCheck("ruleset-signatures","Active ruleset requires signed commits",r=>r.type==="required_signatures");
 ruleCheck("ruleset-stale-review","Active ruleset dismisses stale approvals",r=>r.type==="pull_request"&&r.parameters?.dismiss_stale_reviews_on_push===true);
 checks.push({id:"workflow-token-permissions",label:"Default workflow token has read permissions",status:workflow?.default_workflow_permissions==="read"?"PASS":workflow?.default_workflow_permissions==="write"?"FAIL":"UNKNOWN",observed:["read","write"].includes(workflow?.default_workflow_permissions)?workflow.default_workflow_permissions:"Not established",nextStep:"Check workflow-level permission overrides separately; the repository default is not a guarantee for every job."});
 checks.push({id:"workflow-approval",label:"Workflows cannot approve pull requests by default",status:typeof workflow?.can_approve_pull_request_reviews==="boolean"?workflow.can_approve_pull_request_reviews?"FAIL":"PASS":"UNKNOWN",observed:typeof workflow?.can_approve_pull_request_reviews==="boolean"?String(workflow.can_approve_pull_request_reviews):"Not established",nextStep:"Review GitHub Actions approval permissions and any separate app credentials."});
 return {engine:"github-branch-2.0.0",repository:value.repository,branch:value.branch,sourceUrl:"https://github.com/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+"/settings/branches",capturedAt:new Date().toISOString(),checks,limitations:["Timestamped configuration observations, not compliance certification or proof of operating effectiveness.","Rulesets and classic protection are reported separately; a missing requirement in one can be supplied by the other. Bypass actors, workflow overrides, code contents and actual review history are not evaluated.",...(protection?[]:["Classic protection was not accessible. A 403 or 404 cannot distinguish missing permissions from protection managed through rulesets; classic checks remain unknown."]),...(!complete?["Active-rule retrieval was incomplete; missing rules remain unknown."]:[])]};
}
export function connectorOutcome(value:GithubObservation){return value.checks.some(c=>c.status==="FAIL")?"FOLLOW_UP":value.checks.some(c=>c.status==="UNKNOWN")?"INCOMPLETE":"OBSERVED";}
