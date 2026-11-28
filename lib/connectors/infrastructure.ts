import {z} from 'zod';
import {CollectionError} from './collection-error';
import {providerReader,booleanCheck,validCredential} from './bounded-http';
import type {Observation} from './observation';
export const vercelTarget=z.object({projectId:z.string().regex(/^prj_[A-Za-z0-9]{10,80}$/),teamId:z.string().regex(/^team_[A-Za-z0-9]{10,80}$/)});
export const supabaseTarget=z.object({projectRef:z.string().regex(/^[a-z]{20}$/),providerOrganizationId:z.string().regex(/^[a-z0-9]{20}$/)});
const follow='Inspect the provider configuration, scope and exceptions independently. This observation does not certify compliance.';
export function observeVercel(target:z.infer<typeof vercelTarget>,raw:any):Observation{
 const t=vercelTarget.parse(target);
 if(raw?.id!==t.projectId||raw?.accountId!==t.teamId)throw new CollectionError('TARGET_MISMATCH');
 const protection=raw.ssoProtection,mode=protection?.deploymentType;
 const modes=['all','all_except_custom_domains','preview','prod_deployment_urls_and_all_previews'];
 const known=protection===null||modes.includes(mode),enabled=modes.includes(mode)&&protection?.enabled!==false;
 return {engine:'vercel-project-1.0.0',sourceUrl:'https://vercel.com/dashboard',capturedAt:new Date().toISOString(),checks:[
  {id:'project-scope',label:'Project and team identities verified',status:'PASS',observed:'Exact configured project and team returned',nextStep:follow},
  booleanCheck('fork-protection','Fork deployments require authorization',raw.gitForkProtection,true,follow),
  {id:'deployment-authentication',label:'Project declares Vercel Authentication protection',status:known?(enabled?'PASS':'FAIL'):'UNKNOWN',observed:enabled?'Configured scope: '+mode:known?'Not configured':'Not established',nextStep:'Inspect custom-domain exclusions, per-alias exceptions and automation bypasses. A project setting does not prove every URL requires authentication.'},
  {id:'application-authentication',label:'Application authorization independently verified',status:'UNKNOWN',observed:'Not established by project metadata',nextStep:'Test application authentication and tenant isolation separately from deployment protection.'}
 ],limitations:['Read-only project metadata only. Environment variables, secrets, source code and traffic are not collected.','Project protection can have alias and automation exceptions; no claim of protection on every URL or production availability is inferred. Missing fields remain unknown.']};
}
export async function collectVercel(target:z.infer<typeof vercelTarget>,token:string,fetcher:typeof fetch=fetch){
 const t=vercelTarget.parse(target);if(!validCredential(token))throw new CollectionError('INVALID_CREDENTIAL');
 const read=providerReader(fetcher,{Authorization:'Bearer '+token});
 const raw=(await read('https://api.vercel.com/v9/projects/'+t.projectId+'?teamId='+t.teamId))!.body;
 return observeVercel(t,raw);
}
export function observeSupabase(target:z.infer<typeof supabaseTarget>,raw:any,ssl:any=null):Observation{
 const t=supabaseTarget.parse(target);
 if(raw?.id!==t.projectRef||raw?.organization_id!==t.providerOrganizationId)throw new CollectionError('TARGET_MISMATCH');
 const status=typeof raw.status==='string'&&/^[A-Z_]{1,50}$/.test(raw.status)?raw.status:null;
 const applied=ssl?.appliedSuccessfully===true,encrypted=ssl?.currentConfig?.database;
 return {engine:'supabase-project-1.0.0',sourceUrl:'https://supabase.com/dashboard/project/'+t.projectRef,capturedAt:new Date().toISOString(),checks:[
  {id:'project-scope',label:'Project and organization identities verified',status:'PASS',observed:'Exact configured project and organization returned',nextStep:follow},
  {id:'project-health',label:'Project reports active healthy status',status:status?(status==='ACTIVE_HEALTHY'?'PASS':'FAIL'):'UNKNOWN',observed:status||'Not established',nextStep:'Investigate service state; point-in-time health is not an availability guarantee.'},
  {id:'database-tls',label:'Database SSL enforcement applied',status:applied&&typeof encrypted==='boolean'?(encrypted?'PASS':'FAIL'):'UNKNOWN',observed:applied&&typeof encrypted==='boolean'?'Applied database SSL enforcement: '+encrypted:'Not established',nextStep:'Use database_ssl_config_read permission and verify applied configuration. HTTPS APIs alone do not establish database TLS enforcement.'},
  {id:'database-access-policies',label:'Database access policies independently verified',status:'UNKNOWN',observed:'Not assessed by project metadata',nextStep:'Inspect RLS, role grants, storage policies and restore tests separately; no SQL or customer rows are read by this adapter.'}
 ],limitations:['Project health and applied SSL setting only; no database rows, API keys, Auth configuration or customer documents are read.','The SSL endpoint is a documented beta; unavailable or changed fields remain unknown. No backup, region-compliance, RLS or application-security approval is inferred.']};
}
export async function collectSupabase(target:z.infer<typeof supabaseTarget>,token:string,fetcher:typeof fetch=fetch){
 const t=supabaseTarget.parse(target);if(!validCredential(token))throw new CollectionError('INVALID_CREDENTIAL');
 const read=providerReader(fetcher,{Authorization:'Bearer '+token}),base='https://api.supabase.com/v1/projects/'+t.projectRef;
 const project=(await read(base))!.body;
 // Check exact identity before requesting even optional settings.
 observeSupabase(t,project);
 const ssl=(await read(base+'/ssl-enforcement',true))?.body;
 return observeSupabase(t,project,ssl);
}
