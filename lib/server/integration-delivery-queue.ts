import {Prisma} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {DELIVERY_LIMITS,deliveryBackoff,deliveryHttpOutcome} from '../integration-delivery';
import {db} from './db';
import {transaction} from './intelligence-service';
import {decryptConnectorSecret} from './connector-secret';
import {deliveryInclude,deliveryEligibility,type DeliveryRecord} from './integration-delivery-state';
import {outboundIntegrationsEnabled} from './integration-delivery-events';
import {DeliveryTransportError,sendIntegrationDelivery,type DeliveryTransportDependencies,type DeliveryTransportResult} from './integration-delivery-transport';
import type {executeScheduledTick} from '../cron-tick.mjs';
type Tx=Prisma.TransactionClient;
export type ClaimedDelivery={id:string;organizationId:string;endpointId:string;leaseToken:string};
export const deliveryDispatcherEnabled=()=>outboundIntegrationsEnabled()&&process.env.REGPILOT_AUTOMATION_ENABLED==='true'&&(process.env.REGPILOT_WORKER_ENABLED==='true'||process.env.REGPILOT_CRON_ENABLED==='true');
const ctx=(job:{organizationId:string})=>({organizationId:job.organizationId,userId:'',role:'ADMIN' as const});
const fence=(job:ClaimedDelivery)=>({id:job.id,organizationId:job.organizationId,state:'SENDING',leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}});
async function releaseEndpoint(tx:Tx,job:ClaimedDelivery){await tx.integrationEndpoint.updateMany({where:{id:job.endpointId,organizationId:job.organizationId,leaseToken:job.leaseToken},data:{leaseToken:null,leaseUntil:null}});}
export async function claimIntegrationDelivery(exact?:{organizationId:string;deliveryId:string}):Promise<ClaimedDelivery|null>{
 if(!deliveryDispatcherEnabled())return null;
 return db.$transaction(async tx=>{
  const endpoints=await tx.$queryRaw<Array<{id:string;organizationId:string}>>(Prisma.sql`
   SELECT e.id,e."organizationId" FROM "IntegrationEndpoint" e
   WHERE (e."leaseUntil" IS NULL OR e."leaseUntil"<=NOW())
    ${exact?Prisma.sql`AND e."organizationId"=${exact.organizationId}::uuid`:Prisma.empty}
    AND EXISTS (SELECT 1 FROM "IntegrationDelivery" d WHERE d."endpointId"=e.id
     ${exact?Prisma.sql`AND d.id=${exact.deliveryId}::uuid`:Prisma.empty}
     AND ((d.state='PENDING' AND d."availableAt"<=NOW()) OR (d.state='SENDING' AND d."leaseUntil"<=NOW())))
   ORDER BY e."lastDispatchedAt" ASC NULLS FIRST,e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED`);
  const endpoint=endpoints[0];if(!endpoint)return null;
  const row=await tx.integrationDelivery.findFirst({where:{endpointId:endpoint.id,...(exact?{id:exact.deliveryId}:{}),OR:[{state:'PENDING',availableAt:{lte:new Date()}},{state:'SENDING',leaseUntil:{lte:new Date()}}]},orderBy:[{availableAt:'asc'},{id:'asc'}]});if(!row)return null;
  if(row.state==='SENDING'&&row.leaseToken)await tx.integrationAttempt.updateMany({where:{deliveryId:row.id,state:'SENDING',leaseToken:row.leaseToken},data:{state:'INTERRUPTED',errorCode:'WORKER_LEASE_EXPIRED',finishedAt:new Date()}});
  const leaseToken=randomUUID(),leaseUntil=new Date(Date.now()+DELIVERY_LIMITS.leaseMs);
  await tx.integrationEndpoint.update({where:{id:endpoint.id},data:{leaseToken,leaseUntil,lastDispatchedAt:new Date()}});
  await tx.integrationDelivery.update({where:{id:row.id},data:{state:'SENDING',version:{increment:1},leaseToken,leaseUntil}});
  return {id:row.id,organizationId:row.organizationId,endpointId:row.endpointId,leaseToken};
 },{timeout:10000});
}
async function reserveBudgets(tx:Tx,row:DeliveryRecord){
 const now=Date.now(),minute=new Date(Math.floor(now/60000)*60000),day=new Date(new Date(now).toISOString().slice(0,10)+'T00:00:00.000Z');
 const budgets=[{bucket:'endpoint:'+row.endpointId,window:minute,limit:DELIVERY_LIMITS.endpointPerMinute,next:new Date(minute.getTime()+60000)},{bucket:'company-minute',window:minute,limit:DELIVERY_LIMITS.companyPerMinute,next:new Date(minute.getTime()+60000)},{bucket:'company-day',window:day,limit:DELIVERY_LIMITS.companyPerDay,next:new Date(day.getTime()+86400000)}];
 // The enclosing company advisory transaction makes this all-or-none admission.
 for(const budget of budgets){const value=await tx.integrationBudget.findUnique({where:{organizationId_bucket_window:{organizationId:row.organizationId,bucket:budget.bucket,window:budget.window}}});if(value&&value.count>=budget.limit)return budget.next;}
 for(const budget of budgets)await tx.integrationBudget.upsert({where:{organizationId_bucket_window:{organizationId:row.organizationId,bucket:budget.bucket,window:budget.window}},create:{organizationId:row.organizationId,bucket:budget.bucket,window:budget.window,count:1},update:{count:{increment:1}}});
 return null;
}
async function cancelDelivery(tx:Tx,job:ClaimedDelivery,code:string){await tx.integrationDelivery.updateMany({where:fence(job),data:{state:'CANCELLED',version:{increment:1},lastErrorCode:code,finishedAt:new Date(),leaseToken:null,leaseUntil:null}});await tx.integrationAttempt.updateMany({where:{deliveryId:job.id,state:'SENDING',leaseToken:job.leaseToken},data:{state:'CANCELLED',finishedAt:new Date(),errorCode:code}});await releaseEndpoint(tx,job);}
async function prepareAttempt(job:ClaimedDelivery){return transaction(ctx(job),async tx=>{
 const row=await tx.integrationDelivery.findFirst({where:fence(job),include:deliveryInclude});if(!row||row.endpoint.leaseToken!==job.leaseToken||!row.endpoint.leaseUntil||row.endpoint.leaseUntil<=new Date())return {state:'SUPERSEDED' as const};
 if(!deliveryDispatcherEnabled()){await tx.integrationDelivery.update({where:{id:row.id},data:{state:'PENDING',availableAt:new Date(Date.now()+60000),leaseToken:null,leaseUntil:null}});await releaseEndpoint(tx,job);return {state:'DISABLED' as const};}
 const eligibility=await deliveryEligibility(tx,row);
 if(eligibility.code||!eligibility.envelope){await cancelDelivery(tx,job,eligibility.code||'PAYLOAD_INTEGRITY_FAILED');return {state:'CANCELLED' as const};}
 if(row.cycleAttempts>=DELIVERY_LIMITS.attemptsPerCycle){await tx.integrationDelivery.update({where:{id:row.id},data:{state:'DEAD',lastErrorCode:'ATTEMPTS_EXHAUSTED',finishedAt:new Date(),leaseToken:null,leaseUntil:null}});await releaseEndpoint(tx,job);return {state:'DEAD' as const};}
 const retryAt=await reserveBudgets(tx,row);if(retryAt){await tx.integrationDelivery.update({where:{id:row.id},data:{state:'PENDING',availableAt:retryAt,lastErrorCode:'RATE_BUDGET',leaseToken:null,leaseUntil:null}});await releaseEndpoint(tx,job);return {state:'BUDGET_DEFERRED' as const};}
 const body=JSON.stringify(eligibility.envelope),requestHash=createHash('sha256').update(body).digest('hex'),attempt=await tx.integrationAttempt.create({data:{organizationId:row.organizationId,deliveryId:row.id,number:row.attempts+1,endpointVersion:row.endpointVersion,secretVersion:row.secretVersion,leaseToken:job.leaseToken,requestHash}});
 await tx.integrationDelivery.update({where:{id:row.id},data:{attempts:{increment:1},cycleAttempts:{increment:1}}});
 return {state:'READY' as const,row,body,attemptId:attempt.id,envelope:eligibility.envelope};
});}
async function assertBeforeSend(job:ClaimedDelivery){return transaction(ctx(job),async tx=>{
 const row=await tx.integrationDelivery.findFirst({where:fence(job),include:deliveryInclude});if(!row||row.endpoint.leaseToken!==job.leaseToken||!deliveryDispatcherEnabled())throw new DeliveryTransportError('SEND_AUTHORITY_CHANGED');
 const check=await deliveryEligibility(tx,row);if(check.code)throw new DeliveryTransportError(check.code);
});}
export async function executeIntegrationDelivery(job:ClaimedDelivery,deps:DeliveryTransportDependencies={}){
 const prepared=await prepareAttempt(job);if(prepared.state!=='READY')return prepared.state;
 let result:DeliveryTransportResult|null=null,error:DeliveryTransportError|null=null;
 try{
  let secret:string;try{secret=decryptConnectorSecret(prepared.row.endpoint.encryptedSecret!,job.organizationId,'outbound-delivery:'+job.endpointId);}catch{throw new DeliveryTransportError('SIGNING_SECRET_UNAVAILABLE');}
  result=await sendIntegrationDelivery({url:prepared.row.endpoint.url,body:prepared.body,secret,eventId:prepared.row.eventId,deliveryId:job.id,attemptId:prepared.attemptId},{...deps,beforeSend:async()=>{await deps.beforeSend?.();await assertBeforeSend(job);}});
 }catch(problem){error=problem instanceof DeliveryTransportError?problem:new DeliveryTransportError('DELIVERY_FAILED',true);}
 return transaction(ctx(job),async tx=>{
  const row=await tx.integrationDelivery.findFirst({where:fence(job),include:deliveryInclude});if(!row||row.endpoint.leaseToken!==job.leaseToken)return 'SUPERSEDED';
  const check=await deliveryEligibility(tx,row),now=new Date();
  const outcome=result?deliveryHttpOutcome(result.status):error?.retryable?'RETRY':'DEAD';
  let state:'DELIVERED'|'PENDING'|'DEAD'|'CANCELLED'=outcome==='RETRY'?'PENDING':outcome;
  let code=result?outcome==='DELIVERED'?null:result.status>=300&&result.status<400?'HTTP_REDIRECT':'HTTP_'+result.status:error?.code||'DELIVERY_FAILED';
  if(check.code||!deliveryDispatcherEnabled()){state='CANCELLED';code=check.code||'DISPATCH_DISABLED';}
  if(state==='DELIVERED'&&prepared.envelope.type==='endpoint.probe'&&result?.challenge!==prepared.envelope.data.challenge){state='DEAD';code='PROBE_CHALLENGE_MISMATCH';}
  const availableAt=new Date(Date.now()+deliveryBackoff(row.cycleAttempts,result?.retryAfterSeconds));
  if(state==='PENDING'&&(row.cycleAttempts>=DELIVERY_LIMITS.attemptsPerCycle||availableAt>=row.event.expiresAt)){state='DEAD';code=row.cycleAttempts>=DELIVERY_LIMITS.attemptsPerCycle?'ATTEMPTS_EXHAUSTED':'RETRY_AFTER_EXPIRY';}
  await tx.integrationAttempt.updateMany({where:{id:prepared.attemptId,state:'SENDING',leaseToken:job.leaseToken},data:{state:state==='PENDING'?'RETRY_SCHEDULED':state==='DEAD'?'FAILED':state,finishedAt:now,errorCode:code,...(result?{httpStatus:result.status,durationMs:result.durationMs,responseBytes:result.responseBytes,peerAddressHash:result.peerAddressHash}:{durationMs:Math.max(0,now.getTime()-(await tx.integrationAttempt.findUniqueOrThrow({where:{id:prepared.attemptId},select:{startedAt:true}})).startedAt.getTime())})}});
  await tx.integrationDelivery.update({where:{id:row.id},data:{state,version:{increment:1},lastErrorCode:code,lastHttpStatus:result?.status||null,leaseToken:null,leaseUntil:null,...(state==='PENDING'?{availableAt,finishedAt:null}:{finishedAt:now}),...(state==='DELIVERED'?{deliveredAt:now}:{})}});
  await tx.integrationEndpoint.update({where:{id:job.endpointId},data:{leaseToken:null,leaseUntil:null,...(state==='DELIVERED'?{lastDeliveredAt:now,failureCode:null,...(prepared.envelope.type==='endpoint.probe'?{state:'ACTIVE',verifiedAt:now,verifiedVersion:row.endpointVersion}:{})}:state==='CANCELLED'?{}:{lastFailureAt:now,failureCode:code})}});
  return state==='PENDING'?'RETRY_SCHEDULED':state;
 });
}
export async function integrationDeliveryHealth(){
 if(!outboundIntegrationsEnabled())return {pending:0,dead:0,oldestPendingAt:null as string|null};
 const [pending,dead,oldest]=await Promise.all([db.integrationDelivery.count({where:{state:{in:['PENDING','SENDING']}}}),db.integrationDelivery.count({where:{state:'DEAD'}}),db.integrationDelivery.findFirst({where:{state:{in:['PENDING','SENDING']}},orderBy:{createdAt:'asc'},select:{createdAt:true}})]);
 return {pending,dead,oldestPendingAt:oldest?.createdAt.toISOString()||null};
}
export async function runIntegrationDeliveryBatch(limit=12,parallelism=2,deadline=Date.now()+20000,deps:DeliveryTransportDependencies={}){
 if(!deliveryDispatcherEnabled())return {processed:0,outcomes:[] as string[],attention:0,limitReached:false,disabled:true};
 if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(parallelism)||parallelism<1||parallelism>2||!Number.isFinite(deadline))throw Error('Invalid delivery batch limits');
 let admitted=0;const outcomes:string[]=[];await Promise.all(Array.from({length:parallelism},async()=>{while(Date.now()<deadline&&admitted<limit){admitted++;const job=await claimIntegrationDelivery();if(!job){admitted--;return;}try{outcomes.push(await executeIntegrationDelivery(job,deps));}catch{outcomes.push('FAILED');}}}));
 const health=await integrationDeliveryHealth();return {processed:outcomes.length,outcomes,attention:health.dead,limitReached:health.pending>0,disabled:false};
}
export async function finalizeIntegrationDeliveryTick<T extends Awaited<ReturnType<typeof executeScheduledTick>>>(tick:T):Promise<T>{
 if(!outboundIntegrationsEnabled())return tick;
 const health=await integrationDeliveryHealth(),modules=tick.modules as Record<string,{state:string;processed:number;attention:number;outcomeCount?:number}>,previous=modules.deliveries||{state:'disabled',processed:0,attention:0};
 const state=previous.state==='failed'?'failed':health.dead?'attention':health.pending?'backlog':previous.state;
 return {...tick,ok:tick.ok&&!health.dead,modules:{...modules,deliveries:{...previous,state,attention:Math.max(previous.attention,health.dead),pending:health.pending}}};
}
export async function pruneIntegrationDeliveries(){
 const before=new Date(Date.now()-DELIVERY_LIMITS.historyDays*86400000);
 return db.$transaction(async tx=>{
  const rows=await tx.integrationDelivery.findMany({where:{state:{in:['DELIVERED','CANCELLED','DEAD']},createdAt:{lt:before}},select:{id:true},orderBy:{createdAt:'asc'},take:500});if(rows.length)await tx.integrationDelivery.deleteMany({where:{id:{in:rows.map(row=>row.id)},state:{in:['DELIVERED','CANCELLED','DEAD']}}});
  const events=await tx.integrationEvent.findMany({where:{createdAt:{lt:before},deliveries:{none:{}}},select:{id:true},take:500});if(events.length)await tx.integrationEvent.deleteMany({where:{id:{in:events.map(row=>row.id)},deliveries:{none:{}}}});
  // Budget windows are operational counters, not administrator recovery receipts.
  const budgets=await tx.integrationBudget.findMany({where:{window:{lt:new Date(Date.now()-2*86400000)}},select:{id:true},take:1000});if(budgets.length)await tx.integrationBudget.deleteMany({where:{id:{in:budgets.map(row=>row.id)}}});
  return {deliveries:rows.length,events:events.length,budgets:budgets.length};
 },{timeout:10000});
}
