import {z} from 'zod';
import {createHash} from 'node:crypto';
import {brokerId,brokerOrigin} from './hosted-oauth';
import {readBoundedJson,validCredential} from './bounded-http';
import {CollectionError} from './collection-error';
export const catalogUrl='https://nango.dev/docs/api-catalog.txt';
export const sourceModel=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
export function brokerKey(){
 const key=process.env.REGPILOT_NANGO_API_KEY??'';
 return process.env.REGPILOT_MARKETPLACE_ENABLED==='true'&&validCredential(key)?key:null;
}
export function modelChoices(key:string){
 const schema=z.record(brokerId,z.array(sourceModel).max(50));
 return schema.parse(JSON.parse(process.env.REGPILOT_SYNC_MODELS||'{}'))[key]??[];
}
export const aiProvider=z.enum(['openai','anthropic']);
export function aiModels(provider:string){
 if(!aiProvider.safeParse(provider).success)return [];
 const value=process.env['REGPILOT_CUSTOMER_'+provider.toUpperCase()+'_MODELS']??'';
 return value.split(',').map(s=>s.trim()).filter(s=>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(s)).slice(0,20);
}
export function parseDirectory(text:string){
 const rows=new Map<string,{slug:string;name:string;auth:string;category:string}>();
 for(const line of text.split('\n')){
  const fields=line.split('|').map(s=>s.trim());
  const slug=/^`([a-z0-9][a-z0-9_-]{0,99})`$/.exec(fields[1]??'')?.[1];
  if(slug&&fields[2]&&fields[3]&&!rows.has(slug))rows.set(slug,{slug,name:fields[2].slice(0,150),auth:fields[3].slice(0,60),category:(fields[7]??'').slice(0,120)});
 }
 if(!rows.size||rows.size>5000)throw new CollectionError('INVALID_RESPONSE');
 return [...rows.values()];
}
export async function publicDirectory(fetcher:typeof fetch=fetch){
 const r=await fetcher(catalogUrl,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok||!r.body){await r.body?.cancel();throw new CollectionError('PROVIDER_UNAVAILABLE');}
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>2_000_000)throw new CollectionError('SCOPE_LIMIT');chunks.push(value);}
 return parseDirectory(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});}
}
async function get(path:string,key:string,fetcher:typeof fetch,headers:Record<string,string>={}){
 const r=await fetcher(brokerOrigin+path,{headers:{Authorization:'Bearer '+key,...headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!r.ok){await r.body?.cancel();throw new CollectionError(r.status===401||r.status===403?'ACCESS_DENIED':'PROVIDER_UNAVAILABLE');}
 return readBoundedJson(r,2_000_000);
}
export function workspaceIntegrationId(org:string,slug:string){
 const prefix='rpw-'+z.uuid().parse(org).replaceAll('-','')+'-';
 const digest=createHash('sha256').update(brokerId.parse(slug)).digest('hex').slice(0,16);
 return prefix+slug.slice(0,40)+'-'+digest;
}
export async function enabledIntegrations(key:string,fetcher:typeof fetch=fetch,org?:string){
 const data=(await get('/integrations',key,fetcher)).data;
 if(!Array.isArray(data)||data.length>5000)throw new CollectionError('SCOPE_LIMIT');
 return data.filter(v=>brokerId.safeParse(v?.unique_key).success&&brokerId.safeParse(v?.provider).success&&(v.unique_key.startsWith('regpilot-')||!!org&&v.unique_key===workspaceIntegrationId(org,v.provider)))
  .map(v=>({integration:String(v.unique_key),provider:String(v.provider),name:String(v.display_name||v.provider).slice(0,150),models:modelChoices(v.unique_key),aiModels:aiModels(v.provider)}));
}
export type Integration=Awaited<ReturnType<typeof enabledIntegrations>>[number];
export async function workspaceGrants(org:string,source:Integration,key:string,fetcher:typeof fetch=fetch,exact?:string){
 const q=new URLSearchParams({'tags[organization_id]':z.uuid().parse(org),'tags[regpilot_integration]':source.integration,limit:'100',...(exact?{connectionId:brokerId.parse(exact)}:{})});
 const rows=(await get('/connections?'+q,key,fetcher)).connections;
 if(!Array.isArray(rows)||rows.length>=100)throw new CollectionError('SCOPE_LIMIT');
 return rows.filter(v=>v?.tags?.organization_id===org&&v.tags.regpilot_integration===source.integration&&v.provider===source.provider&&v.provider_config_key===source.integration&&(!exact||v.connection_id===exact))
  .map(v=>({id:brokerId.parse(v.connection_id),healthy:Array.isArray(v.errors)&&v.errors.length===0}));
}
export async function checkGrant(org:string,source:Integration,id:string,key:string,fetcher:typeof fetch,allowFault=false){
 const grants=await workspaceGrants(org,source,key,fetcher,id);
 if(grants.length!==1||!allowFault&&!grants[0].healthy)throw new CollectionError('TARGET_MISMATCH');
}
export async function readSync(org:string,source:Integration,id:string,model:string,key:string,fetcher:typeof fetch=fetch){
 if(!source.models.includes(sourceModel.parse(model)))throw new CollectionError('INVALID_TARGET');
 await checkGrant(org,source,id,key,fetcher);
 const q=new URLSearchParams({model,limit:'50'}),seen=new Set<string>(),items=[] as {id:string;changed:string;action:string}[];
 let more=false;
 for(let page=0;page<4;page++){
  const result=await get('/records?'+q,key,fetcher,{'Connection-Id':id,'Provider-Config-Key':source.integration});
  const records=z.array(z.object({id:z.union([z.string().min(1).max(512),z.number().safe()]),_nango_metadata:z.object({last_modified_at:z.iso.datetime({offset:true}),last_action:z.enum(['ADDED','UPDATED','DELETED'])})})).max(50).parse(result.records);
  for(const row of records)items.push({id:String(row.id),changed:row._nango_metadata.last_modified_at,action:row._nango_metadata.last_action});
  more=result.next_cursor!=null;
  if(!more)break;
  const cursor=z.string().min(1).max(4096).parse(result.next_cursor);
  if(seen.has(cursor))throw new CollectionError('INVALID_RESPONSE');seen.add(cursor);q.set('cursor',cursor);
 }
 if(new Set(items.map(i=>i.id)).size!==items.length)throw new CollectionError('INVALID_RESPONSE');
 const sorted=items.sort((a,b)=>a.id.localeCompare(b.id)||a.changed.localeCompare(b.changed));
 return {count:items.length,limited:more,deleted:items.filter(r=>r.action==='DELETED').length,lastChanged:items.map(r=>new Date(r.changed).toISOString()).sort().at(-1)??null,
  digest:createHash('sha256').update(JSON.stringify(sorted)).digest('hex')};
}

export async function managedSyncObservation(org:string,target:{scope:string;record:string;reference?:string},fetcher:typeof fetch=fetch):Promise<import('./observation').Observation>{
 const key=brokerKey();if(!key)throw new CollectionError('PROVIDER_DISABLED');
 const [integration,connectionId]=target.scope.split('/');
 const source=(await enabledIntegrations(key,fetcher,org)).find(s=>s.integration===integration&&s.provider===target.reference);
 if(!source)throw new CollectionError('TARGET_MISMATCH');
 const sample=await readSync(org,source,connectionId,target.record,key,fetcher);
 await checkGrant(org,source,connectionId,key,fetcher);
 return {engine:'managed-sync-metadata-v1',capturedAt:new Date().toISOString(),sourceUrl:'https://nango.dev/docs/api-integrations/'+source.provider,
  checks:[{id:'sync-coverage',label:'Synced record metadata available',status:sample.count&&!sample.limited?'PASS':'UNKNOWN',observed:sample.count+' records · '+(sample.limited?'truncated':'end of returned pages'),nextStep:'Compare the model and its sync scope with the source system.'},
   {id:'sync-sample',label:'Version of the sampled record identities and modification times',status:sample.count?'PASS':'UNKNOWN',observed:sample.digest+' · last change '+(sample.lastChanged??'unknown')+' · '+sample.deleted+' deleted',nextStep:'Inspect changed records in the provider before relying on the control.'}],
  limitations:['The broker cache is read on this collection. Provider-side sync completeness, last successful source poll and a specific control outcome require separate evidence.']};
}
