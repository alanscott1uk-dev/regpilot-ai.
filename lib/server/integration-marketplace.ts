import {z} from 'zod';
import {brokerId,brokerOrigin,hostedConnectSession} from '../connectors/hosted-oauth';
import {aiProvider,workspaceIntegrationId,brokerKey,enabledIntegrations,checkGrant,workspaceGrants,readSync,publicDirectory,sourceModel} from '../connectors/marketplace';
import {checkedJson} from '../services/http';
import {transaction,IntelligenceError} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {ADMIN,WRITER,requireMember} from './workspace-member';
import {hashValue} from '../regulatory/intelligence';
const fields={integration:brokerId,connectionId:brokerId};
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('ENABLE'),slug:brokerId}).strict(),
 z.object({action:z.literal('DIRECTORY')}).strict(),z.object({action:z.literal('AVAILABLE')}).strict(),
 z.object({action:z.enum(['CONNECT','GRANTS']),integration:brokerId}).strict(),
 z.object({action:z.literal('RENEW'),...fields}).strict(),
 z.object({action:z.literal('COLLECT'),...fields,model:sourceModel}).strict(),
 z.object({action:z.literal('SET_AI'),...fields,model:brokerId,previous:z.uuid().nullable()}).strict(),
 z.object({action:z.literal('UNLINK_AI'),previous:z.uuid()}).strict()
]);
const binding=z.object({...fields,provider:aiProvider,model:brokerId});
type Bound=z.infer<typeof binding>;
const scope=(ctx:AuthorizedContext)=>({organizationId:ctx.organizationId,entityType:'WorkspaceAiProvider',entityId:ctx.organizationId});
async function currentBinding(ctx:AuthorizedContext,manage=false){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,manage?ADMIN:WRITER);
  const event=await tx.auditEvent.findFirst({where:scope(ctx),orderBy:[{createdAt:'desc'},{id:'desc'}]});
  return {version:event?.id??null,binding:event?.action==='ai.provider-linked'?binding.parse(event.details):null};
 });
}
export async function aiChoice(ctx:AuthorizedContext){const {binding:b,version}=await currentBinding(ctx);return {provider:b?.provider??null,model:b?.model??null,version};}
async function saveBinding(ctx:AuthorizedContext,b:Bound|null,previous:string|null){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);
  const head=await tx.auditEvent.findFirst({where:scope(ctx),orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  if((head?.id??null)!==previous)throw new IntelligenceError('The AI connection changed. Refresh first.',409);
  const event=await tx.auditEvent.create({data:{...scope(ctx),actorId:ctx.userId,action:b?'ai.provider-linked':'ai.provider-unlinked',details:b??{}}});
  return {version:event.id,provider:b?.provider??null,model:b?.model??null};
 });
}
export async function marketplaceAction(ctx:AuthorizedContext,raw:unknown,fetcher:typeof fetch=fetch){
 const d=actions.parse(raw);
 const allow=()=>transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
 await allow();
 if(d.action==='UNLINK_AI')return saveBinding(ctx,null,d.previous);
 if(d.action==='DIRECTORY'){const entries=await publicDirectory(fetcher);await allow();return {entries,checkedAt:new Date().toISOString()};}
 const key=brokerKey();
 if(d.action==='ENABLE'){
  if(!key||process.env.REGPILOT_MARKETPLACE_SELF_SERVICE_ENABLED!=='true')throw new IntelligenceError('Workspace provider setup awaits broker configuration.',503);
  const entries=await publicDirectory(fetcher),match=entries.find(e=>e.slug===d.slug);
  if(!match||match.auth!=='API_KEY')throw new IntelligenceError('This provider requires a preconfigured integration.',400);
  const integration=workspaceIntegrationId(ctx.organizationId,match.slug),list=()=>enabledIntegrations(key,fetcher,ctx.organizationId);
  const existing=(await list()).find(s=>s.integration===integration);if(existing)return {source:existing};
  await allow();
  const response=await fetcher(brokerOrigin+'/integrations',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({provider:match.slug,unique_key:integration}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  const accepted=response.ok;await response.body?.cancel();
  const source=(await list()).find(s=>s.integration===integration&&s.provider===match.slug);
  if(!source)throw new IntelligenceError(accepted?'Refresh after the hosted integration becomes available.':'The broker did not enable this provider.',502);
  await allow();return {source};
 }
 if(d.action==='AVAILABLE'){const integrations=key?await enabledIntegrations(key,fetcher,ctx.organizationId):[];await allow();return {integrations,ai:await aiChoice(ctx),enabled:!!key,selfService:!!key&&process.env.REGPILOT_MARKETPLACE_SELF_SERVICE_ENABLED==='true'};}
 if(!key)throw new IntelligenceError('Managed integrations await configuration.',503);
 const sources=await enabledIntegrations(key,fetcher,ctx.organizationId),source=sources.find(s=>s.integration===d.integration);
 if(!source)throw new IntelligenceError('This integration is unavailable.',404);
 const tags={regpilot_integration:source.integration},config={key,integration:source.integration};
 if(d.action==='CONNECT'||d.action==='RENEW'){
  if(d.action==='RENEW')await checkGrant(ctx.organizationId,source,d.connectionId,key,fetcher,true);
  await allow();return hostedConnectSession(ctx.organizationId,ctx.userId,config,fetcher,tags,d.action==='RENEW'?d.connectionId:undefined);
 }
 if(d.action==='GRANTS'){const grants=await workspaceGrants(ctx.organizationId,source,key,fetcher);await allow();return {grants};}
 if(d.action==='SET_AI'){
  const provider=aiProvider.parse(source.provider);
  if(!source.aiModels.includes(d.model))throw new IntelligenceError('Select a configured model.',400);
  await checkGrant(ctx.organizationId,source,d.connectionId,key,fetcher);
  const response=await fetcher(brokerOrigin+'/proxy/v1/models/'+encodeURIComponent(d.model),{headers:{Authorization:'Bearer '+key,'Provider-Config-Key':source.integration,'Connection-Id':d.connectionId,Retries:'0',...(provider==='anthropic'?{'Nango-Proxy-anthropic-version':'2023-06-01'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const model=await checkedJson(response,16384);
  if(model.id!==d.model)throw new IntelligenceError('The provider did not confirm this exact model identifier.',409);
  return saveBinding(ctx,{integration:source.integration,connectionId:d.connectionId,provider,model:d.model},d.previous);
 }
 if(d.action!=='COLLECT')throw new IntelligenceError('Unknown operation',400);
 const entityId=hashValue([source.integration,d.connectionId,d.model]),where={organizationId:ctx.organizationId,entityType:'ManagedSyncSample',entityId,action:'integration.sync-sampled'};
 const head=()=>transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);return tx.auditEvent.findFirst({where,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});});
 const before=await head(),sample=await readSync(ctx.organizationId,source,d.connectionId,d.model,key,fetcher);
 await checkGrant(ctx.organizationId,source,d.connectionId,key,fetcher);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const prior=await tx.auditEvent.findFirst({where,orderBy:[{createdAt:'desc'},{id:'desc'}]});
  if(prior?.id!==before?.id)throw new IntelligenceError('A newer collection was saved. Refresh to compare.',409);
  const priorDigest=z.object({digest:z.string()}).safeParse(prior?.details).data?.digest??null;
  const row=await tx.auditEvent.create({data:{...where,actorId:ctx.userId,details:{...sample,integration:source.integration,model:d.model,previous:prior?.id??null}}});
  return {...sample,receiptId:row.id,checkedAt:row.createdAt.toISOString(),previousCheckedAt:prior?.createdAt.toISOString()??null,changed:priorDigest===null?null:sample.digest!==priorDigest};
 });
}
export async function resolveCustomerAi(ctx:AuthorizedContext,version:string,fetcher:typeof fetch=fetch){
 const key=brokerKey(),state=await currentBinding(ctx),b=state.binding;
 if(!key||!b||state.version!==version)throw new IntelligenceError('Refresh your organisation’s AI connection.',409);
 const sources=await enabledIntegrations(key,fetcher,ctx.organizationId);
 const source=sources.find(s=>s.integration===b.integration&&s.provider===b.provider&&s.aiModels.includes(b.model));
 if(!source)throw new IntelligenceError('The selected model is unavailable.',409);
 await checkGrant(ctx.organizationId,source,b.connectionId,key,fetcher);
 if((await currentBinding(ctx)).version!==version)throw new IntelligenceError('The selected AI account changed.',409);
 return {...b,key};
}
