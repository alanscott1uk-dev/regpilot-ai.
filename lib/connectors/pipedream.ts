import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {accountLinkScopes,pdFailure,pdRequest} from './pipedream-client';
export {pdConfig} from './pipedream-client';
import {CollectionError} from './collection-error';
import {evaluateResource,profiles,suggestResourceFields,type ResourcePolicy} from './resource-control';
import {githubInventoryChecks} from './github-inventory-checks';
import {githubTarget} from './github';
import {atStep} from './collection-step';
import {productActionUrl,type ProductRead} from './product-recipes';
import type {Observation} from './observation';

export const pdAccount=z.string().regex(/^apn_[A-Za-z0-9]{1,90}$/);
export const pdApp=z.string().regex(/^[a-z0-9_]{1,78}$/);
export const pdAction=z.string().regex(/^[a-z0-9-]{1,118}$/);
const user=(org:string)=>'regpilot-'+z.uuid().parse(org);
const accountRow=z.object({id:pdAccount,healthy:z.boolean().nullish(),dead:z.boolean().nullish(),error:z.unknown().optional(),app:z.object({name_slug:z.string()}),name:z.string().nullable().optional(),updated_at:z.string().optional()});
export async function pdAccounts(org:string,app:string,fetcher:typeof fetch=fetch){
 const params=new URLSearchParams({external_user_id:user(org),app:pdApp.parse(app),include_credentials:'false',limit:'100'});
 const accounts:z.infer<typeof accountRow>[]=[];
 const cursors=new Set<string>(),accountIds=new Set<string>();
 let expected:number|undefined;
 for(let page=0;page<10;page++){
  const raw=await pdRequest('connect:accounts:read','/accounts?'+params,fetcher);
  if(!Array.isArray(raw?.data)||raw.data.length>100)throw new CollectionError('INVALID_RESPONSE');
  const total=raw.page_info?.total_count;
  if(total!==undefined&&(!Number.isSafeInteger(total)||total<0))throw new CollectionError('INVALID_RESPONSE');
  if(total>1000)throw new CollectionError('SCOPE_LIMIT');
  if(total!==undefined){
   if(expected!==undefined&&total!==expected)throw new CollectionError('INVALID_RESPONSE');
   expected=total;
  }
  for(const item of raw.data){
   const row=accountRow.parse(item);
   if(accountIds.has(row.id))throw new CollectionError('INVALID_RESPONSE');
   accountIds.add(row.id);accounts.push(row);
  }
  if(expected!==undefined&&accounts.length>expected)throw new CollectionError('INVALID_RESPONSE');
  if(expected===accounts.length||(expected===undefined&&raw.data.length<100)){
   return accounts.filter(r=>r.app.name_slug===app)
    .map(r=>({id:r.id,name:r.name||r.id,healthy:r.healthy===true&&!r.dead&&!r.error,canVerify:!r.dead&&!r.error,providerHealth:r.healthy??null,dead:r.dead===true,errorCode:r.error?pdFailure(r.error,'PROVIDER_REPORTED_ERROR'):null,updatedAt:r.updated_at??null}));
  }
  if(!raw.data.length)throw new CollectionError('INVALID_RESPONSE');
  const next=raw.page_info?.end_cursor;
  if(typeof next!=='string'||!next||next.length>1024||cursors.has(next))throw new CollectionError('INVALID_RESPONSE');
  cursors.add(next);params.set('after',next);
 }
 throw new CollectionError('SCOPE_LIMIT');
}
export async function pdLink(org:string,app:string,fetcher:typeof fetch=fetch){
 const r=await pdRequest('connect:tokens:create','/tokens',fetcher,{external_user_id:user(org),app_id:pdApp.parse(app),expires_in:900,scope:accountLinkScopes});
 const u=typeof r.connect_link_url==='string'?URL.parse(r.connect_link_url):null;
 if(!u||u.protocol!=='https:'||!(u.hostname==='pipedream.com'||u.hostname.endsWith('.pipedream.com'))||u.username||u.password||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now())throw new CollectionError('INVALID_RESPONSE');
 u.searchParams.set('app',app);
 // Pipedream's hosted GitHub flow has a two-scope read-only profile for monitoring and renewal.
 if(app==='github')u.searchParams.set('oauthScopeProfile','read_only');
 return u.href;
}

type PolicySelection=ResourcePolicy|ResourcePolicy['profile'];
export type Sample={keys:string[];digest:string;count:number;policyChecks?:Observation['checks'];suggestions?:Record<string,string>;mapped?:{digest:string;observable:boolean;checks:Observation['checks']}};
export const sampleHash=(keys:string[])=>createHash('sha256').update(JSON.stringify(keys)).digest('hex');
function stableId(row:unknown):string|null{
 if(typeof row==='string'||typeof row==='number'&&Number.isSafeInteger(row))return String(row);
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const record=row as Record<string,unknown>;
 for(const k of ['id','gid','uuid','key','uid','ID','Id','slug',...(Object.hasOwn(record,'label')?['value']:[])]){
  const v=record[k];if(typeof v==='string'&&v.trim()&&v.length<=1000||typeof v==='number'&&Number.isSafeInteger(v))return String(v);
 }
 return null;
}
function inventory(value:unknown):unknown[]{
 if(Array.isArray(value))return value;
 if(value&&typeof value==='object'){
  if(stableId(value)!==null)return [value];
  const entries=Object.entries(value).filter(([k,v])=>Array.isArray(v)&&!['errors','warnings','links','logs'].includes(k));
  if(entries.length===1)return entries[0][1] as unknown[];
  const data=(value as Record<string,unknown>).data;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&stableId(data)!==null)return [data];
 }
 throw new CollectionError('INVALID_RESPONSE');
}
export function pdSample(ret:unknown,org:string,recipe:ProductRead,policy?:PolicySelection):Sample{
 const salt=process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY;
 if(!salt||!/^[\da-f]{64}$/i.test(salt))throw new CollectionError('PROVIDER_DISABLED');
 const rows=inventory(ret);if(rows.length>1000)throw new CollectionError('SCOPE_LIMIT');
 const ids=rows.map(stableId);
 if(ids.some(v=>!v)||new Set(ids).size!==ids.length)throw new CollectionError('INVALID_RESPONSE');
 const keys=(ids as string[]).map(id=>createHmac('sha256',Buffer.from(salt,'hex')).update(JSON.stringify([org,recipe.app,recipe.action,id])).digest('hex'));
 const checks=recipe.app==='github'&&recipe.action==='list-repositories'?{policyChecks:githubInventoryChecks(rows)}:{};
 const mapped=policy&&typeof policy!=='string'?mappedProductChecks(rows,keys,policy):undefined;
 const suggestions=typeof policy==='string'?suggestResourceFields(rows,policy):undefined;
 keys.sort();
 return {keys,digest:sampleHash(keys),count:keys.length,...checks,...(suggestions?{suggestions}:{}),...(mapped?{mapped}:{})};
}

function mappedProductChecks(rows:unknown[],keys:string[],policy:ResourcePolicy){
 const now=Date.now();
 const evaluated=rows.map((row,i)=>({key:keys[i],states:evaluateResource(row,policy,now)})).sort((a,b)=>a.key.localeCompare(b.key));
 let observable=true;
 const checks:Observation['checks']=profiles[policy.profile].rules.map((rule,index)=>{
  const passed=evaluated.filter(row=>row.states[index]==='PASS').length;
  const failed=evaluated.filter(row=>row.states[index]==='FAIL').length;
  const unknown=rows.length-passed-failed;
  if(!passed&&!failed)observable=false;
  const exceptions=evaluated.filter(row=>row.states[index]!=='PASS');
  const examples=exceptions.slice(0,5).map(row=>row.key.slice(0,16)+' '+row.states[index]);
  const fingerprint=exceptions.length?createHash('sha256').update(JSON.stringify(exceptions.map(row=>[row.key,row.states[index]]))).digest('hex'):null;
  return {id:'mapped-'+policy.profile+'-'+rule.field,label:rule.label,
   status:failed?'FAIL':!rows.length||unknown?'UNKNOWN':'PASS',
   observed:passed+' passed, '+failed+' failed, '+unknown+' unknown in the returned sample.'+(fingerprint?' Affected references: '+examples.join(', ')+'. Set SHA-256: '+fingerprint:''),
   nextStep:'Review the mapped fields in the authorised product account.'};
 });
 const digest=createHash('sha256').update(JSON.stringify(evaluated)).digest('hex');
 return {checks,observable,digest};
}
async function actionResult(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch,assertGrant:()=>Promise<void>){
 const raw=await atStep('records',async()=>{
  try{return await pdRequest('connect:actions:*','/actions/run',fetcher,{id:recipe.app+'-'+recipe.action,version:recipe.version,
   external_user_id:user(org),configured_props:{...recipe.fixedProps,[recipe.prop]:{authProvisionId:account}}});}
  catch(error){
   if(error instanceof CollectionError&&error.code==='CREDENTIAL_REJECTED')error.step='grant';
   if(error instanceof CollectionError&&error.code==='ACCESS_DENIED')await atStep('grant',assertGrant);
   throw error;
  }
 });
 const error=raw?.error||(Array.isArray(raw?.os)?raw.os.find((item:{err?:unknown})=>item?.err)?.err:null);
 if(!raw||!Object.hasOwn(raw,'ret')||error){
  const code=pdFailure(error,'INVALID_RESPONSE');
  throw new CollectionError(code,undefined,code==='CREDENTIAL_REJECTED'?'grant':'records');
 }
 return raw.ret as unknown;
}

const repositoryIdentity=z.object({id:z.union([z.number().int().positive(),z.string().min(1)]),full_name:githubTarget.shape.repository});
const optionalDetailErrors=new Set(['ACCESS_DENIED','INSUFFICIENT_SCOPE','TARGET_MISMATCH','ACTION_UNAVAILABLE','PLAN_REQUIRED']);
async function actionSample(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch,assertGrant:()=>Promise<void>,policy?:PolicySelection){
 const raw=await actionResult(org,account,recipe,fetcher,assertGrant);
 return atStep('records',async()=>{
  if(recipe.app!=='github'||recipe.action!=='list-repositories')return pdSample(raw,org,recipe,policy);
  const rows=inventory(raw);
  if(rows.length>1000)throw new CollectionError('SCOPE_LIMIT');
  // GitHub leaves settings out of list responses. Read details for up to four listed repositories.
  // Additional repositories retain the observations available from the list.
  const details=await Promise.all(rows.slice(0,4).map(async row=>{
   const original=repositoryIdentity.safeParse(row);
   if(!original.success)return row;
   const {id,full_name}=original.data;
   const source={...recipe,action:'get-repository',version:'0.1.3',fixedProps:{repoFullname:full_name}};
   let expanded:unknown;
   try{expanded=await actionResult(org,account,source,fetcher,assertGrant);}
   catch(error){if(error instanceof CollectionError&&optionalDetailErrors.has(error.code))return row;throw error;}
   const identity=repositoryIdentity.safeParse(expanded);
   if(!identity.success||String(identity.data.id)!==String(id)||identity.data.full_name.toLowerCase()!==full_name.toLowerCase())throw new CollectionError('TARGET_MISMATCH');
   return {...row as Record<string,unknown>,...expanded as Record<string,unknown>};
  }));
  return pdSample([...details,...rows.slice(4)],org,recipe,policy);
 });
}

/** Pipedream can report false immediately after a valid authorisation. Check ownership and explicit
 * failures before and after the signed action. Only its actual upstream response establishes a read. */
export async function readProduct(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch=fetch,policy?:PolicySelection){
 pdAccount.parse(account);
 let providerHealth:boolean|null=null;
 const check=async()=>{
  const grant=(await pdAccounts(org,recipe.app,fetcher)).find(r=>r.id===account);
  if(!grant||grant.dead)throw new CollectionError('CREDENTIAL_REJECTED');
  if(grant.errorCode)throw new CollectionError(grant.errorCode);
  providerHealth=grant.providerHealth;
 };
 await atStep('grant',check);
 const sample=await actionSample(org,account,recipe,fetcher,check,policy);
 await atStep('grant',check);
 return {...sample,providerHealth:providerHealth as boolean|null};
}
export function productObservation(recipe:ProductRead,sample:Sample,expected:string[]):Observation{
 const baseline=new Set(expected),current=new Set(sample.keys);
 const added=sample.keys.filter(k=>!baseline.has(k)).length,missing=expected.filter(k=>!current.has(k)).length;
 return {engine:'pipedream-read-'+recipe.version,sourceUrl:productActionUrl(recipe),capturedAt:new Date().toISOString(),
  checks:[{id:'approved-resources',label:'Previously approved identifiers appear in the returned sample',status:missing?'FAIL':'PASS',
   observed:missing+' missing of '+expected.length,nextStep:'Review the source account and the named inventory read.'},
   {id:'unreviewed-resources',label:'Returned identifiers belong to the approved sample',status:added?'FAIL':'PASS',
   observed:added+' additional of '+sample.count,nextStep:'Investigate additions before approving a revised baseline.'},...(sample.policyChecks??[]),...(sample.mapped?.checks??[])],
  limitations:['This comparison covers identifiers returned by the pinned product action. A changed provider page can change the sample.']};
}
