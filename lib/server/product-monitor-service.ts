import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from './db';
import {transaction,IntelligenceError} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {connectorScopeHash} from './connector-verification';
import {readRecordKeys} from '../connectors/operational-records';
import {CollectionError} from '../connectors/collection-error';
import {pdAccount,pdAccounts,pdAction,pdApp,pdConfig,pdLink,readProduct,productObservation,sampleHash} from '../connectors/pipedream';
import {recipeFor,productSearch,productTotal} from '../connectors/product-recipes';
import {connectorsEnabled} from './connector-flags';
import {resourcePolicy,resourceProfile} from '../connectors/resource-control';
import {hashValue} from '../regulatory/intelligence';
import {stagingProductHistory} from './staging-product-probe';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const selection=z.object({app:pdApp,action:pdAction});
const chooseAccount=selection.extend({account:pdAccount,policy:resourcePolicy.optional()});
const monitor=z.object({id:z.uuid(),version:z.number().int().positive()});
export const productCommand=z.discriminatedUnion('op',[
 z.object({op:z.literal('SCHEDULES'),after:z.uuid().optional()}),
 z.object({op:z.literal('SEARCH'),q:z.string().max(100).default(''),offset:z.number().int().min(0).max(10000).default(0)}),
 selection.extend({op:z.literal('CONNECT')}),selection.extend({op:z.literal('ACCOUNTS')}),
 selection.extend({op:z.literal('DISCOVER'),account:pdAccount,profile:resourceProfile}),
 chooseAccount.extend({op:z.literal('PREVIEW')}),
 chooseAccount.extend({op:z.literal('APPROVE'),controlId:z.uuid(),digest,reviewDigest:digest.optional(),consent:z.literal(true)}),
 monitor.extend({op:z.literal('START_RENEWAL')}),monitor.extend({op:z.literal('VERIFY_RENEWAL'),requestId:z.uuid()})
]);
const baseline=z.object({app:pdApp,action:pdAction,version:z.string(),account:pdAccount,controlId:z.uuid(),
 project:z.string(),environment:z.string(),keys:z.array(digest).min(1).max(1000),digest,policy:resourcePolicy.optional()});
type Target={scope:string;record:string;reference?:string};
const remember=(org:string,value:z.infer<typeof baseline>)=>{
 const hash=createHash('sha256').update(JSON.stringify([org,value.app,value.action,value.version,value.account,value.controlId,value.project,value.environment,value.digest,...(value.policy?[hashValue(value.policy)]:[])])).digest('hex');
 return hash.slice(0,8)+'-'+hash.slice(8,12)+'-8'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
};

export async function productBinding(org:string,target:Target,controlId?:string){
 const cfg=pdConfig(),recipe=recipeFor(target.scope,target.record);
 if(!cfg||!recipe||!target.reference)throw new CollectionError('INVALID_TARGET');
 const receipt=await db.auditEvent.findFirst({where:{id:target.reference,organizationId:org,entityType:'ProductReadBaseline',action:'product.baseline-approved'}});
 const result=baseline.safeParse(receipt?.details);
 if(!result.success)throw new CollectionError('INVALID_TARGET');
 const v=result.data;
 if(v.app!==recipe.app||v.action!==recipe.action||v.version!==recipe.version||v.project!==cfg.project||v.environment!==cfg.environment||
    (controlId!==undefined&&v.controlId!==controlId)||sampleHash(v.keys)!==v.digest||remember(org,v)!==receipt?.id)throw new CollectionError('TARGET_MISMATCH');
 return {v,recipe};
}
export async function collectProductMonitor(org:string,target:Target,fetcher:typeof fetch=fetch){
 const {v,recipe}=await productBinding(org,target);
 return productObservation(recipe,await readProduct(org,v.account,recipe,fetcher,v.policy),v.keys);
}

export async function productMonitorCommand(ctx:AuthorizedContext,input:unknown,fetcher:typeof fetch=fetch){
 const cmd=productCommand.parse(input),org=ctx.organizationId;
 await transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
 if(cmd.op==='SEARCH'){
  const matches=productSearch(cmd.q);
  const [history,paused]=await Promise.all([stagingProductHistory(org),db.evidenceConnector.findMany({where:{organizationId:org,provider:'PIPEDREAM_READ',enabled:false,failureCode:'CREDENTIAL_REJECTED'},orderBy:{id:'asc'},take:100,select:{id:true,version:true,repository:true}})]);
  return {total:productTotal,matches:matches.length,products:matches.slice(cmd.offset,cmd.offset+40),enabled:connectorsEnabled()&&!!pdConfig(),paused,history};
 }
 if(cmd.op==='SCHEDULES'){
  return transaction(ctx,async tx=>{
   await requireMember(tx,ctx,ADMIN);
   const rows=await tx.evidenceConnector.findMany({where:{organizationId:org,provider:'PIPEDREAM_READ',intervalHours:1,...(cmd.after?{id:{gt:cmd.after}}:{})},
    orderBy:{id:'asc'},take:21,select:{id:true,repository:true,enabled:true,failureCode:true,lastSuccessAt:true,nextRunAt:true,leaseUntil:true,control:{select:{title:true}}}});
   const now=new Date();
   const schedules=rows.slice(0,20).map(row=>{
    const [,app,action]=row.repository.split(':');
    const state=!row.enabled?'Paused':row.leaseUntil&&row.leaseUntil>now?'Collecting':row.failureCode?'Retry pending':row.nextRunAt<=now?'Due':'Scheduled';
    return {id:row.id,product:recipeFor(app,action)?.name??app,action,control:row.control.title,state,failureCode:row.failureCode,
     lastSuccessAt:row.lastSuccessAt?.toISOString()??null,nextRunAt:row.enabled?row.nextRunAt.toISOString():null};
   });
   return {schedules,asOf:now.toISOString(),next:rows.length>20?schedules[19].id:null};
  });
 }
 const cfg=pdConfig();if(!connectorsEnabled()||!cfg)throw new IntelligenceError('Connect the Pipedream project in deployment settings to enable hosted reads.',503);
 if(cmd.op==='START_RENEWAL'||cmd.op==='VERIFY_RENEWAL'){
  const row=await db.evidenceConnector.findFirst({where:{id:cmd.id,organizationId:org,version:cmd.version,provider:'PIPEDREAM_READ',enabled:false,failureCode:'CREDENTIAL_REJECTED',control:{enabled:true}}});
  if(!row)throw new IntelligenceError('Refresh the list of paused product monitors.',409);
  const {v,recipe}=await productBinding(org,readRecordKeys('PIPEDREAM_READ',row.repository,row.branch),row.controlId);
  const scopeHash=connectorScopeHash(row),events={organizationId:org,entityType:'EvidenceConnector',entityId:row.id};
  const incident=await db.auditEvent.findFirst({where:{...events,action:'connector.collection_failed',AND:[
   {details:{path:['code'],equals:'CREDENTIAL_REJECTED'}},{details:{path:['scopeHash'],equals:scopeHash}},
   {details:{path:['configVersion'],equals:row.version}},{details:{path:['step'],equals:'grant'}}]},orderBy:{createdAt:'desc'}});
  if(!incident)throw new IntelligenceError('A recorded grant failure is required for this recovery.',409);
  if(cmd.op==='START_RENEWAL'){
   const link=await pdLink(org,v.app,fetcher);
   const request=await transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);return tx.auditEvent.create({data:{...events,actorId:ctx.userId,action:'product.renewal-started',details:{incidentId:incident.id,version:row.version}},select:{id:true}});});
   return {link,requestId:request.id};
  }
  const start=await db.auditEvent.findFirst({where:{...events,id:cmd.requestId,action:'product.renewal-started',details:{path:['incidentId'],equals:incident.id}}});
  if(!start)throw new IntelligenceError('Start renewal for this grant before verification.',409);
  const grant=(await pdAccounts(org,v.app,fetcher)).find(g=>g.id===v.account);
  if(!grant?.canVerify||!grant.updatedAt||!(Date.parse(grant.updatedAt)>start.createdAt.getTime()&&Date.parse(grant.updatedAt)<=Date.now()+1000))throw new IntelligenceError('Finish reauthorising the original account, then verify its updated grant.',409);
  const sample=await readProduct(org,v.account,recipe,fetcher);
  if(!sample.count)throw new IntelligenceError('The renewed account returned no identifiable resources.',409);
  return transaction(ctx,async tx=>{
   await requireMember(tx,ctx,ADMIN);
   const saved=await tx.evidenceConnector.updateMany({where:{id:row.id,organizationId:org,version:row.version,enabled:false,failureCode:'CREDENTIAL_REJECTED',leaseToken:null},data:{enabled:true,version:{increment:1},configuredById:ctx.userId,attempts:0,nextRunAt:new Date(),failureCode:null}});
   if(!saved.count)throw new IntelligenceError('This monitor changed while verifying renewal.',409);
   await tx.auditEvent.create({data:{...events,actorId:ctx.userId,action:'connector.configured',details:{scopeHash,controlId:row.controlId,enabled:true,previousVersion:row.version,version:row.version+1,credentialReplaced:true,method:'HOSTED_REAUTHORISATION',incidentId:incident.id,requestId:start.id}}});
   return {id:row.id,version:row.version+1};
  });
 }
 const recipe=recipeFor(cmd.app,cmd.action);
 if(!recipe)throw new IntelligenceError('Choose a published product action.',404);
 if(cmd.op==='CONNECT')return {link:await pdLink(org,recipe.app,fetcher)};
 if(cmd.op==='ACCOUNTS')return {accounts:await pdAccounts(org,recipe.app,fetcher)};
 const sample=await readProduct(org,cmd.account,recipe,fetcher,cmd.op==='DISCOVER'?cmd.profile:cmd.policy);
 if(!sample.count)throw new IntelligenceError('The action returned an empty inventory. Select an account with identifiable records.',409);
 if(cmd.op==='DISCOVER')return {suggestions:sample.suggestions??{}};
 const reviewDigest=cmd.policy&&sample.mapped?hashValue([org,cfg.project,cfg.environment,cmd.account,recipe.app,recipe.action,recipe.version,cmd.policy,sample.digest,sample.mapped.digest]):undefined;
 if(cmd.op==='PREVIEW')return {count:sample.count,digest:sample.digest,...(sample.mapped?{reviewDigest,checks:sample.mapped.checks,observable:sample.mapped.observable}:{})};
 if(reviewDigest!==cmd.reviewDigest||sample.mapped&&!sample.mapped.observable)
  throw new IntelligenceError('Preview the current mapping. Each rule needs at least one observable result before approval.',409);
 if(sample.digest!==cmd.digest)throw new IntelligenceError('The sample has changed. Review the current inventory before approval.',409);
 const snapshot={app:recipe.app,action:recipe.action,version:recipe.version,account:cmd.account,controlId:cmd.controlId,project:cfg.project,environment:cfg.environment,keys:sample.keys,digest:sample.digest,...(cmd.policy?{policy:cmd.policy}:{})};
 const reference=remember(org,snapshot);
 await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  if(!await tx.managedControl.findFirst({where:{id:cmd.controlId,organizationId:org,enabled:true},select:{id:true}}))throw new IntelligenceError('Select an active control in this workspace.',409);
  await tx.auditEvent.createMany({data:[{id:reference,organizationId:org,actorId:ctx.userId,entityType:'ProductReadBaseline',entityId:reference,action:'product.baseline-approved',details:{...snapshot,...(sample.mapped?{review:{digest:reviewDigest!,checks:sample.mapped.checks}}:{})}}],skipDuplicates:true});
 });
 const {saveConnector}=await import('./connector-service');
 return saveConnector(ctx,{provider:'PIPEDREAM_READ',scope:recipe.app,record:recipe.action,reference,controlId:cmd.controlId,consent:true,version:0,enabled:true,intervalHours:1});
}
