import {z} from 'zod';
import {atStep} from './collection-step';
import {profiles,evaluateResource,type ResourcePolicy,type RuleState} from './resource-control';
import type {ConnectorCheck} from './github';
import {createHash,createHmac} from 'node:crypto';
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
 const rows=new Map<string,{slug:string;name:string;auth:string;category:string;docs?:string}>();
 for(const line of text.split('\n')){
  const fields=line.split('|').map(s=>s.trim());
  const slug=/^`([a-z0-9][a-z0-9_-]{0,99})`$/.exec(fields[1]??'')?.[1];
  const docs=/^\[docs\]\((https:\/\/nango\.dev\/docs\/(?:api-integrations|integrations\/all)\/[a-z0-9_-]+)\.md\)$/.exec(fields[4]??'')?.[1];
  if(slug&&fields[2]&&fields[3]&&!rows.has(slug))rows.set(slug,{slug,name:fields[2].slice(0,150),auth:fields[3].slice(0,60),category:(fields[7]??'').slice(0,120),...(docs?{docs}:{})});
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
export async function deployedModels(source:Integration,id:string,key:string,fetcher:typeof fetch){
 const params=new URLSearchParams({provider_config_key:source.integration,connection_id:brokerId.parse(id),syncs:'*'});
 const rows=(await get('/sync/status?'+params,key,fetcher)).syncs;
 if(!Array.isArray(rows)||rows.length>200)throw new CollectionError('SCOPE_LIMIT');
 const models=new Map<string,Array<{state:string;finishedAt:string|null;expected:number|null}>>();
 for(const row of rows){
  if(row?.connection_id!==id)throw new CollectionError('TARGET_MISMATCH');
  const names=new Set([...Object.keys(row.recordCount??{}),...Object.keys(row.latestResult??{})]);
  for(const name of names){
   if(!sourceModel.safeParse(name).success)continue;
   const finished=z.iso.datetime({offset:true}).safeParse(row.finishedAt);
   const states=models.get(name)??[];
   states.push({expected:Number.isSafeInteger(row.recordCount?.[name])&&row.recordCount[name]>=0?row.recordCount[name]:null,state:['SUCCESS','RUNNING','PAUSED','STOPPED','ERROR'].includes(row.status)?String(row.status):'UNKNOWN',finishedAt:finished.success?new Date(finished.data).toISOString():null});
   models.set(name,states);
  }
 }
 if(models.size>200)throw new CollectionError('SCOPE_LIMIT');
 return [...models].map(([name,jobs])=>{
  const allComplete=jobs.every(job=>job.state==='SUCCESS'&&job.finishedAt);
  const finishedAt=allComplete?jobs.map(job=>job.finishedAt!).sort()[0]:null;
  const age=finishedAt?Date.now()-Date.parse(finishedAt):NaN;
  const state=jobs.some(job=>['ERROR','PAUSED','STOPPED'].includes(job.state))?'NEEDS_ATTENTION':
   allComplete&&age>=0?(age<=86400000?'FRESH':'STALE'):'UNKNOWN';
  return {name,state,finishedAt,expected:jobs.length===1?jobs[0].expected:null};
 });
}
export async function readSync(org:string,source:Integration,id:string,model:string,key:string,fetcher:typeof fetch=fetch,policy?:ResourcePolicy){
 sourceModel.parse(model);
 await atStep('grant',()=>checkGrant(org,source,id,key,fetcher));
 const deployed=await atStep('model',()=>deployedModels(source,id,key,fetcher)).catch(error=>{
  if(error instanceof CollectionError&&error.code==='ACCESS_DENIED'&&source.models.includes(model))return [];
  throw error;
 });
 const pipeline=deployed.find(entry=>entry.name===model);
 if(!pipeline&&!source.models.includes(model))throw new CollectionError('INVALID_TARGET',undefined,'model');
 const q=new URLSearchParams({model,limit:'50'}),seen=new Set<string>(),items=[] as {id:string;changed:string;action:string}[];
 const evaluated:{resource:string;states:RuleState[]}[]=[],now=Date.now();
 let more=false;
 for(let page=0;page<4;page++){
  const result=await atStep('records',()=>get('/records?'+q,key,fetcher,{'Connection-Id':id,'Provider-Config-Key':source.integration}));
  const records=z.array(z.object({id:z.union([z.string().min(1).max(512),z.number().safe()]),_nango_metadata:z.object({last_modified_at:z.iso.datetime({offset:true}),last_action:z.enum(['ADDED','UPDATED','DELETED'])})})).max(50).parse(result.records);
  for(const [index,row] of records.entries()){
   items.push({id:String(row.id),changed:row._nango_metadata.last_modified_at,action:row._nango_metadata.last_action});
   if(policy&&row._nango_metadata.last_action!=='DELETED'){
    const resource=createHmac('sha256',key).update(JSON.stringify([org,source.integration,id,model,String(row.id)])).digest('hex').slice(0,24);
    evaluated.push({resource,states:evaluateResource(result.records[index],policy,now)});
   }
  }
  more=result.next_cursor!=null;
  if(!more)break;
  const cursor=z.string().min(1).max(4096).parse(result.next_cursor);
  if(seen.has(cursor))throw new CollectionError('INVALID_RESPONSE',undefined,'records');seen.add(cursor);q.set('cursor',cursor);
 }
 if(new Set(items.map(i=>i.id)).size!==items.length)throw new CollectionError('INVALID_RESPONSE',undefined,'records');
 const sorted=items.sort((a,b)=>a.id.localeCompare(b.id)||a.changed.localeCompare(b.changed));
 const finalPipeline=policy&&pipeline?(await atStep('model',()=>deployedModels(source,id,key,fetcher))).find(p=>p.name===model):undefined;
 const populationComplete=!!policy&&!!pipeline&&!!finalPipeline&&pipeline.state==='FRESH'&&finalPipeline.state==='FRESH'&&pipeline.finishedAt===finalPipeline.finishedAt&&pipeline.expected===evaluated.length&&finalPipeline.expected===evaluated.length&&!more;
 const rules:ConnectorCheck[]=policy?profiles[policy.profile].rules.map((rule,index)=>{
  const failed=evaluated.filter(row=>row.states[index]==='FAIL'),unknown=evaluated.filter(row=>row.states[index]==='UNKNOWN');
  const complete=!!evaluated.length&&populationComplete&&!unknown.length;
  return {id:'resource-'+policy.profile+'-'+rule.field,label:rule.label,status:failed.length?'FAIL':complete?'PASS':'UNKNOWN',
   observed:(evaluated.length-failed.length-unknown.length)+' passed · '+failed.length+' failed · '+unknown.length+' unknown · '+evaluated.length+' active resources',
   nextStep:'Review the mapped source field and any affected resources.'};
 }):[];
 const findings=evaluated.filter(row=>row.states.some(state=>state!=='PASS')).sort((a,b)=>a.resource.localeCompare(b.resource)).slice(0,12);
 const ruleHash=policy?createHash('sha256').update(JSON.stringify({populationComplete,statuses:rules.map(r=>r.status),resources:evaluated.sort((a,b)=>a.resource.localeCompare(b.resource))})).digest('hex'):null;
 return {rules,findings,populationComplete,activeResources:evaluated.length,ruleHash,syncState:pipeline?.state??"UNKNOWN",syncCompletedAt:pipeline?.finishedAt??null,count:items.length,limited:more,deleted:items.filter(r=>r.action==='DELETED').length,lastChanged:items.map(r=>new Date(r.changed).toISOString()).sort().at(-1)??null,
  digest:createHash('sha256').update(JSON.stringify(sorted)).digest('hex')};
}

export async function managedSyncObservation(org:string,target:{scope:string;record:string;reference?:string},fetcher:typeof fetch=fetch,policy?:ResourcePolicy):Promise<import('./observation').Observation>{
 const key=brokerKey();if(!key)throw new CollectionError('PROVIDER_DISABLED');
 const [integration,connectionId]=target.scope.split('/');
 const source=(await atStep('integration',()=>enabledIntegrations(key,fetcher,org))).find(s=>s.integration===integration&&s.provider===target.reference);
 if(!source)throw new CollectionError('TARGET_MISMATCH',undefined,'integration');
 const sample=await readSync(org,source,connectionId,target.record,key,fetcher,policy);
 await checkGrant(org,source,connectionId,key,fetcher);
 return {engine:policy?'managed-control-'+policy.profile+'-v1':'managed-sync-metadata-v1',capturedAt:new Date().toISOString(),sourceUrl:'https://nango.dev/docs/api-integrations/'+source.provider,
  checks:[...sample.rules,...(policy?[{id:'affected-resources',label:'Affected resource references',status:sample.rules.some(r=>r.status==='FAIL')?'FAIL' as const:sample.rules.every(r=>r.status==='PASS')?'PASS' as const:'UNKNOWN' as const,observed:sample.findings.map(r=>r.resource+' '+r.states.join('/')).join(' · ')||'No affected resources returned',nextStep:'Up to 12 pseudonymous references are retained for comparison.'}]:[]),{id:'source-sync',label:'Source sync completed in the past 24 hours',status:sample.syncState==='FRESH'?'PASS':sample.syncState==='STALE'||sample.syncState==='NEEDS_ATTENTION'?'FAIL':'UNKNOWN',observed:sample.syncState+' · '+(sample.syncCompletedAt??'completion unconfirmed'),nextStep:'Check the deployed upstream sync schedule, errors and last completion.'},
   {id:'sync-coverage',label:'Synced record metadata available',status:sample.count&&!sample.limited?'PASS':'UNKNOWN',observed:sample.count+' records · '+(sample.limited?'truncated':'end of returned pages'),nextStep:'Compare the model and its sync scope with the source system.'},
   {id:'sync-sample',label:'Version of the sampled record identities and modification times',status:sample.count?'PASS':'UNKNOWN',observed:sample.digest+' · last change '+(sample.lastChanged??'unknown')+' · '+sample.deleted+' deleted',nextStep:'Inspect changed records in the provider before relying on the control.'}],
  limitations:['The broker cache is read on this collection. The upstream job status and completion time come from the broker. Verify the underlying control and model scope in the source system.']};
}
