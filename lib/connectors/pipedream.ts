import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {accountLinkScopes,pdFailure,pdRequest} from './pipedream-client';
export {pdConfig} from './pipedream-client';
import {CollectionError} from './collection-error';
import {githubInventoryChecks} from './github-inventory-checks';
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
 const cursors=new Set<string>();
 for(let page=0;page<10;page++){
  const raw=await pdRequest('connect:accounts:read','/accounts?'+params,fetcher);
  if(!Array.isArray(raw?.data)||raw.data.length>100)throw new CollectionError('INVALID_RESPONSE');
  const total=raw.page_info?.total_count;
  if(total!==undefined&&(!Number.isSafeInteger(total)||total<0))throw new CollectionError('INVALID_RESPONSE');
  if(total>1000)throw new CollectionError('SCOPE_LIMIT');
  accounts.push(...raw.data.map((row:unknown)=>accountRow.parse(row)));
  if(raw.data.length<100||total===accounts.length){
   return accounts.filter(r=>r.app.name_slug===app)
    .map(r=>({id:r.id,name:r.name||r.id,healthy:r.healthy===true&&!r.dead&&!r.error,canVerify:!r.dead&&!r.error,providerHealth:r.healthy??null,dead:r.dead===true,errorCode:r.error?pdFailure(r.error,'PROVIDER_REPORTED_ERROR'):null,updatedAt:r.updated_at??null}));
  }
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

export type Sample={keys:string[];digest:string;count:number;policyChecks?:Observation['checks']};
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
export function pdSample(ret:unknown,org:string,recipe:ProductRead):Sample{
 const salt=process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY;
 if(!salt||!/^[\da-f]{64}$/i.test(salt))throw new CollectionError('PROVIDER_DISABLED');
 const rows=inventory(ret);if(rows.length>1000)throw new CollectionError('SCOPE_LIMIT');
 const ids=rows.map(stableId);
 if(ids.some(v=>!v)||new Set(ids).size!==ids.length)throw new CollectionError('INVALID_RESPONSE');
 const keys=(ids as string[]).map(id=>createHmac('sha256',Buffer.from(salt,'hex')).update(JSON.stringify([org,recipe.app,recipe.action,id])).digest('hex')).sort();
 const checks=recipe.app==='github'&&recipe.action==='list-repositories'?{policyChecks:githubInventoryChecks(rows)}:{};
 return {keys,digest:sampleHash(keys),count:keys.length,...checks};
}
async function actionSample(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch,assertGrant:()=>Promise<void>){
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
 return atStep('records',async()=>pdSample(raw.ret,org,recipe));
}

/** Pipedream can report false immediately after a valid authorisation. Check ownership and explicit
 * failures before and after the signed action. Only its actual upstream response establishes a read. */
export async function readProduct(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch=fetch){
 pdAccount.parse(account);
 let providerHealth:boolean|null=null;
 const check=async()=>{
  const grant=(await pdAccounts(org,recipe.app,fetcher)).find(r=>r.id===account);
  if(!grant||grant.dead)throw new CollectionError('CREDENTIAL_REJECTED');
  if(grant.errorCode)throw new CollectionError(grant.errorCode);
  providerHealth=grant.providerHealth;
 };
 await atStep('grant',check);
 const sample=await actionSample(org,account,recipe,fetcher,check);
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
   observed:added+' additional of '+sample.count,nextStep:'Investigate additions before approving a revised baseline.'},...(sample.policyChecks??[])],
  limitations:['This comparison covers identifiers returned by the pinned product action. A changed provider page can change the sample.']};
}
