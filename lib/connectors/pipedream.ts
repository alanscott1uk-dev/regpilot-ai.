import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from './bounded-http';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';
import {productActionUrl,type ProductRead} from './product-recipes';
import type {Observation} from './observation';

const api='https://api.pipedream.com/v1';
export const pdAccount=z.string().regex(/^apn_[A-Za-z0-9]{1,90}$/);
export const pdApp=z.string().regex(/^[a-z0-9_]{1,78}$/);
export const pdAction=z.string().regex(/^[a-z0-9-]{1,118}$/);
export function pdConfig(){
 const project=process.env.REGPILOT_PIPEDREAM_PROJECT_ID??'',client=process.env.REGPILOT_PIPEDREAM_CLIENT_ID??'',secret=process.env.REGPILOT_PIPEDREAM_CLIENT_SECRET??'';
 const environment=process.env.REGPILOT_PIPEDREAM_ENVIRONMENT??'development';
 return /^proj_[A-Za-z0-9]+$/.test(project)&&client&&secret&&['development','production'].includes(environment)?{project,client,secret,environment}:null;
}
type Config=NonNullable<ReturnType<typeof pdConfig>>;
type Access={token:string;until:number};
let access:{key:string;promise:Promise<Access>}|undefined;
async function jsonResponse(res:Response,limit=1_000_000){
 if(!res.ok){
  await res.body?.cancel();
  const code=res.status===429?'RATE_LIMITED':res.status===403||res.status===401?'ACCESS_DENIED':res.status===404?'TARGET_MISMATCH':'PROVIDER_UNAVAILABLE';
  const retry=Number(res.headers.get('Retry-After'));
  throw new CollectionError(code,Number.isFinite(retry)&&retry>0?Math.min(3600,retry):undefined);
 }
 return readBoundedJson(res,limit);
}
async function bearer(c:Config,fetcher:typeof fetch){
 const key=createHash('sha256').update(JSON.stringify([c.project,c.client,c.secret,c.environment])).digest('hex');
 if(access?.key===key){const a=await access.promise;if(a.until>Date.now()+30000)return a.token;}
 const promise=(async()=>{
  const r=await fetcher(api+'/oauth/token',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},
   body:JSON.stringify({grant_type:'client_credentials',client_id:c.client,client_secret:c.secret})});
  const v=await jsonResponse(r,8192);
  if(typeof v.access_token!=='string'||!v.access_token||v.access_token.length>8192||/\s/.test(v.access_token)||!Number.isFinite(v.expires_in)||v.expires_in<=0)throw new CollectionError('INVALID_RESPONSE');
  return {token:v.access_token as string,until:Date.now()+Math.min(3600,v.expires_in)*1000};
 })();
 access={key,promise};
 try{return (await promise).token;}catch(e){if(access?.promise===promise)access=undefined;throw e;}
}
async function request(path:string,fetcher:typeof fetch,payload?:object){
 const config=pdConfig();if(!config)throw new CollectionError('PROVIDER_DISABLED');
 const token=await bearer(config,fetcher);
 const res=await fetcher(api+'/connect/'+config.project+path,{method:payload?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Bearer '+token,'x-pd-environment':config.environment,'Content-Type':'application/json'},
  ...(payload?{body:JSON.stringify(payload)}:{})});
 if(res.status===401)access=undefined;
 return jsonResponse(res);
}
const user=(org:string)=>'regpilot-'+z.uuid().parse(org);
const accountRow=z.object({id:pdAccount,healthy:z.boolean(),dead:z.boolean().nullable().optional(),app:z.object({name_slug:z.string()}),name:z.string().nullable().optional(),updated_at:z.string().optional()});
export async function pdAccounts(org:string,app:string,fetcher:typeof fetch=fetch){
 const path='/users/'+user(org)+'/accounts?'+new URLSearchParams({app:pdApp.parse(app),include_credentials:'false'});
 const raw=await request(path,fetcher);
 if(!Array.isArray(raw))throw new CollectionError('INVALID_RESPONSE');
 if(raw.length>1000)throw new CollectionError('SCOPE_LIMIT');
 return raw.map((row:unknown)=>accountRow.parse(row)).filter((r:z.infer<typeof accountRow>)=>r.app.name_slug===app)
  .map((r:z.infer<typeof accountRow>)=>({id:r.id,name:r.name||r.id,healthy:r.healthy&&!r.dead,updatedAt:r.updated_at??null}));
}
export async function pdLink(org:string,app:string,fetcher:typeof fetch=fetch){
 const r=await request('/tokens',fetcher,{external_user_id:user(org),app_id:pdApp.parse(app),expires_in:900});
 const u=typeof r.connect_link_url==='string'?URL.parse(r.connect_link_url):null;
 if(!u||u.protocol!=='https:'||!(u.hostname==='pipedream.com'||u.hostname.endsWith('.pipedream.com'))||u.username||u.password||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now())throw new CollectionError('INVALID_RESPONSE');
 return u.href;
}

export type Sample={keys:string[];digest:string;count:number};
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
 return {keys,digest:sampleHash(keys),count:keys.length};
}
export async function readProduct(org:string,account:string,recipe:ProductRead,fetcher:typeof fetch=fetch){
 pdAccount.parse(account);
 const assertGrant=async()=>{
  const accountRow=(await pdAccounts(org,recipe.app,fetcher)).find((x:{id:string})=>x.id===account);
  if(!accountRow||!accountRow.healthy)throw new CollectionError('CREDENTIAL_REJECTED');
 };
 await atStep('grant',assertGrant);
 const raw=await atStep('records',async()=>{
  try{return await request('/actions/run',fetcher,{id:recipe.app+'-'+recipe.action,version:recipe.version,
   external_user_id:user(org),configured_props:{[recipe.prop]:{authProvisionId:account}}});}
  catch(error){
   if(error instanceof CollectionError&&error.code==='ACCESS_DENIED')await atStep('grant',assertGrant);
   throw error;
  }
 });
 if(!raw||!Object.hasOwn(raw,'ret')||raw.error||Array.isArray(raw.os)&&raw.os.some((item:{err?:unknown})=>item?.err))throw new CollectionError('INVALID_RESPONSE',undefined,'records');
 const sample=await atStep('records',async()=>pdSample(raw.ret,org,recipe));
 await atStep('grant',assertGrant);
 return sample;
}
export function productObservation(recipe:ProductRead,sample:Sample,expected:string[]):Observation{
 const baseline=new Set(expected),current=new Set(sample.keys);
 const added=sample.keys.filter(k=>!baseline.has(k)).length,missing=expected.filter(k=>!current.has(k)).length;
 return {engine:'pipedream-read-'+recipe.version,sourceUrl:productActionUrl(recipe),capturedAt:new Date().toISOString(),
  checks:[{id:'approved-resources',label:'Previously approved identifiers appear in the returned sample',status:missing?'FAIL':'PASS',
   observed:missing+' missing of '+expected.length,nextStep:'Review the source account and the named inventory read.'},
   {id:'unreviewed-resources',label:'Returned identifiers belong to the approved sample',status:added?'FAIL':'PASS',
   observed:added+' additional of '+sample.count,nextStep:'Investigate additions before approving a revised baseline.'}],
  limitations:['This comparison covers identifiers returned by the pinned product action. A changed provider page can change the sample.']};
}
