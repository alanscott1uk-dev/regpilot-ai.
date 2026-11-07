import {z} from "zod";
import {CollectionError,type ConnectorCheck} from "./github";
import type {Observation} from "./observation";
import {providerReader,validCredential,booleanCheck} from "./bounded-http";

export const gitlabTarget=z.object({projectPath:z.string().max(210).regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/).refine(s=>s.split("/").every(p=>p!=="."&&p!=="..")),branch:z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(s=>!s.includes(".."))});
function matches(pattern:string,branch:string){const escaped=pattern.split("*").map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*");return new RegExp("^"+escaped+"$").test(branch);}
function noPush(rule:any):boolean|undefined{
 const levels=rule.push_access_levels;if(!Array.isArray(levels)||!levels.length)return undefined;
 let unknown=false;
 for(const l of levels){if(!l||typeof l!=="object")return undefined;if(["user_id","group_id","deploy_key_id","member_role_id"].some(k=>l[k]!=null))return false;if(typeof l.access_level!=="number")unknown=true;else if(l.access_level>0)return false;else if(l.access_level!==0)unknown=true;}
 return unknown?undefined:true;
}
export async function collectGitlab(target:z.infer<typeof gitlabTarget>,token:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const parsed=gitlabTarget.safeParse(target);if(!parsed.success||!validCredential(token))throw new CollectionError("INVALID_TARGET");const t=parsed.data,get=providerReader(fetcher,{"PRIVATE-TOKEN":token});
 const project=(await get("https://gitlab.com/api/v4/projects/"+encodeURIComponent(t.projectPath)))!.body;
 if(!project||!Number.isSafeInteger(project.id)||project.id<1||typeof project.path_with_namespace!=="string"||project.path_with_namespace.toLowerCase()!==t.projectPath.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 const base="https://gitlab.com/api/v4/projects/"+project.id,branch=(await get(base+"/repository/branches/"+encodeURIComponent(t.branch)))!.body;
 if(!branch||branch.name!==t.branch)throw new CollectionError("TARGET_MISMATCH");
 const rules:any[]=[],seen=new Set<string>();let complete=true,page=1;
 while(true){const response=await get(base+"/protected_branches?per_page=100&page="+page,true);if(!response){complete=false;break;}if(!Array.isArray(response.body)||response.body.length>100)throw new CollectionError("INVALID_RESPONSE");for(const r of response.body){if(!r||typeof r.name!=="string"||r.name.length>255||seen.has(r.name))throw new CollectionError("INVALID_RESPONSE");seen.add(r.name);rules.push(r);}const next=response.headers.get("x-next-page");if(next===null){if(response.body.length===100)throw new CollectionError("PAGINATION_INCOMPLETE");break;}if(next==="")break;if(next!==String(page+1)||page>=5)throw new CollectionError("PAGINATION_LIMIT");page++;}
 const applicable=rules.filter(r=>matches(r.name,t.branch));
 const aggregate=(value:(r:any)=>boolean|undefined)=>!complete||branch.protected!==true||!applicable.length?undefined:applicable.some(r=>value(r)===false)?false:applicable.every(r=>value(r)===true)?true:undefined;
 const checks:ConnectorCheck[]=[
  booleanCheck("branch-protected","Selected branch is reported protected",branch.protected,true,"Review all applicable branch and group policies."),
  booleanCheck("force-push","All returned matching protections disable force push",aggregate(r=>typeof r.allow_force_push==="boolean"?!r.allow_force_push:undefined),true,"Remove force-push exceptions where appropriate; inspect inherited policies."),
  booleanCheck("direct-push","No direct-push grant in returned matching protections",aggregate(noPush),true,"Review every role, user, group, custom role and deploy-key push grant."),
  booleanCheck("pipeline-gate","Merges require successful pipelines",project.only_allow_merge_if_pipeline_succeeds,true,"Check pipeline availability, bypasses and actual merge history."),
  booleanCheck("discussion-gate","Merges require resolved discussions",project.only_allow_merge_if_all_discussions_are_resolved,true,"Review how discussion resolution is used in the project.")
 ];
 return {engine:"gitlab-project-1.0.0",sourceUrl:"https://gitlab.com/"+t.projectPath.split("/").map(encodeURIComponent).join("/"),capturedAt:new Date().toISOString(),checks,limitations:["Read-only GitLab.com settings observation. No code, commits, names, email addresses or raw access grants are retained.","All returned wildcard protections are considered; the most permissive matching grant prevents a pass. Unavailable/incomplete protections stay unknown.","Group rules not returned by the project endpoint, merge approval policies, bypasses and real operating effectiveness require separate review. Not a compliance verdict."]};
}
