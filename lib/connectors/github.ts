import {z} from "zod";
export const githubTarget=z.object({repository:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/).refine(s=>![".",".."].includes(s.split("/")[1])),branch:z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(s=>!s.includes(".."))});
export type ConnectorCheck={id:string;label:string;status:"PASS"|"FAIL"|"UNKNOWN";observed:string;nextStep:string};
export type GithubObservation={engine:"github-branch-1.0.0";repository:string;branch:string;sourceUrl:string;capturedAt:string;checks:ConnectorCheck[];limitations:string[]};
export class CollectionError extends Error{constructor(public code:string){super("Repository evidence could not be collected");}}
async function boundedJson(response:Response){
 if(!response.body)throw new CollectionError("EMPTY_RESPONSE");const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>65536)throw new CollectionError("RESPONSE_TOO_LARGE");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch(e){await reader.cancel().catch(()=>{});if(e instanceof CollectionError)throw e;throw new CollectionError("INVALID_RESPONSE");}
}
export async function collectGithub(target:{repository:string;branch:string},token:string,fetcher:typeof fetch=fetch):Promise<GithubObservation>{
 const value=githubTarget.parse(target);const [owner,repo]=value.repository.split("/");
 const base="https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo);
 const get=(url:string)=>fetcher(url,{method:"GET",headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2026-03-10"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
 const repository=await get(base);if(!repository.ok){await repository.body?.cancel();throw new CollectionError(repository.status===401?"CREDENTIAL_REJECTED":repository.status===403||repository.status===429?"ACCESS_OR_RATE_LIMIT":"REPOSITORY_UNAVAILABLE");}
 const metadata=await boundedJson(repository);if(typeof metadata.full_name!=="string"||metadata.full_name.toLowerCase()!==value.repository.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 const response=await get(base+"/branches/"+encodeURIComponent(value.branch)+"/protection");
 let protection:Record<string,any>|null=null;
 if(response.ok){const parsed=await boundedJson(response);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new CollectionError("INVALID_RESPONSE");protection=parsed;}
 else if(response.status===404){await response.body?.cancel();}
 else {await response.body?.cancel();throw new CollectionError(response.status===401?"CREDENTIAL_REJECTED":response.status===403||response.status===429?"ACCESS_OR_RATE_LIMIT":"COLLECTION_UNAVAILABLE");}
 const count=protection?.required_pull_request_reviews?.required_approving_review_count;
 const admins=protection?.enforce_admins?.enabled,force=protection?.allow_force_pushes?.enabled;
 const checks:ConnectorCheck[]=[
 {id:"peer-review",label:"At least one approving pull-request review",status:Number.isInteger(count)?count>=1?"PASS":"FAIL":protection&&protection.required_pull_request_reviews===null?"FAIL":"UNKNOWN",observed:Number.isInteger(count)?String(count)+" required approval(s)":"Not established",nextStep:"Inspect the branch's review requirement, bypass actors and applicable rulesets."},
 {id:"admin-enforcement",label:"Classic protection applies to administrators",status:typeof admins==="boolean"?admins?"PASS":"FAIL":"UNKNOWN",observed:typeof admins==="boolean"?String(admins):"Not established",nextStep:"Check administrator bypass policy and any separate rulesets."},
 {id:"force-push",label:"Classic protection disallows force pushes",status:typeof force==="boolean"?force?"FAIL":"PASS":"UNKNOWN",observed:typeof force==="boolean"?"Force pushes allowed: "+force:"Not established",nextStep:"Check force-push exceptions and repository rulesets."}
 ];
 return {engine:"github-branch-1.0.0",repository:value.repository,branch:value.branch,sourceUrl:"https://github.com/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+"/settings/branches",capturedAt:new Date().toISOString(),checks,limitations:["A timestamped observation of classic branch-protection settings, not a compliance certification or proof of operating effectiveness.","Repository rulesets, bypass actors, code contents and actual review history are not evaluated.",...(protection?[]:["Classic protection was not accessible. A 404 cannot distinguish missing permissions, an absent branch or protection managed through rulesets; all checks remain unknown."])]};
}
export function connectorOutcome(value:GithubObservation){return value.checks.some(c=>c.status==="FAIL")?"FOLLOW_UP":value.checks.some(c=>c.status==="UNKNOWN")?"INCOMPLETE":"OBSERVED";}
