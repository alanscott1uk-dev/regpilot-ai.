import {Prisma,type AutomationEvent,type EvidenceConnector} from '@prisma/client';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db} from './db';
import {hashValue} from '../regulatory/intelligence';
import {transaction,IntelligenceError} from './intelligence-service';
import {applyConnectorReaction,ReactionInvalid} from './connector-reactions';
import {connectorsEnabled} from './connector-flags';
import {releaseDispatchLease} from './fair-dispatch';
import {requireMember,ADMIN} from './workspace-member';
import type {AuthorizedContext} from './authorization';
const MAX_ATTEMPTS=5;
export const connectorEventKey=(job:Pick<EvidenceConnector,'organizationId'|'id'|'leaseToken'>)=>hashValue({kind:'connector-reaction:v1',organizationId:job.organizationId,connectorId:job.id,leaseToken:job.leaseToken});
export async function enqueueConnectorEvent(tx:Prisma.TransactionClient,job:EvidenceConnector,input:{kind:'CONNECTOR_OBSERVED'|'CONNECTOR_FAILED';runId?:string;fingerprint:string;changed?:boolean;reasonCode?:string}){
 if(!job.leaseToken)throw Error('Collection lease required');
 return tx.automationEvent.upsert({where:{eventKey:connectorEventKey(job)},update:{},create:{organizationId:job.organizationId,connectorId:job.id,eventKey:connectorEventKey(job),configVersion:job.version,...input}});
}
/** Claim one event per workspace, fairly across workspaces, with database fencing.
 * An optional exact event selector is used by the originating collection only. */
export async function claimAutomationEvent(exact?:{id:string;organizationId:string}){
 if(!connectorsEnabled())return null;
 const token=randomUUID(),filter=exact?Prisma.sql`AND j.id=${exact.id}::uuid AND j."organizationId"=${exact.organizationId}::uuid`:Prisma.empty;
 const rows=await db.$queryRaw<AutomationEvent[]>(Prisma.sql`
 WITH lane AS (
  SELECT l."organizationId" FROM "DispatchLane" l
  WHERE l.kind='AUTOMATION' AND (l."leaseUntil" IS NULL OR l."leaseUntil"<=NOW())
   AND NOT EXISTS (SELECT 1 FROM "AutomationEvent" active WHERE active."organizationId"=l."organizationId" AND active.state='PROCESSING' AND active."leaseUntil">NOW())
   AND EXISTS (SELECT 1 FROM "AutomationEvent" j WHERE j."organizationId"=l."organizationId" AND j.state IN ('PENDING','PROCESSING') AND j."availableAt"<=NOW() AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=NOW()) ${filter})
  ORDER BY l."lastDispatchedAt" ASC NULLS FIRST,l."organizationId" FOR UPDATE OF l SKIP LOCKED LIMIT 1
 ), due AS (
  SELECT j.id FROM "AutomationEvent" j JOIN lane l ON l."organizationId"=j."organizationId"
  WHERE j.state IN ('PENDING','PROCESSING') AND j."availableAt"<=NOW() AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=NOW()) ${filter}
  ORDER BY j."createdAt",j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
 ), claimed AS (
  UPDATE "AutomationEvent" j SET state='PROCESSING',"leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '60 seconds',attempts=j.attempts+1,version=j.version+1,"updatedAt"=NOW()
  FROM due WHERE j.id=due.id RETURNING j.*
 ), advanced AS (
  UPDATE "DispatchLane" l SET "lastDispatchedAt"=clock_timestamp(),"leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '60 seconds',"dispatchCount"=l."dispatchCount"+1
  FROM claimed j WHERE l."organizationId"=j."organizationId" AND l.kind='AUTOMATION' RETURNING l."organizationId"
 ) SELECT j.* FROM claimed j JOIN advanced a ON a."organizationId"=j."organizationId"`);
 return rows[0]??null;
}
class AutomationSuperseded extends Error{}
type Handler=(tx:Prisma.TransactionClient,event:AutomationEvent)=>Promise<'DONE'|'CANCELLED'>;
export async function executeAutomationEvent(event:AutomationEvent,handler:Handler=applyConnectorReaction){
 try{
  const connector=await db.evidenceConnector.findFirst({where:{id:event.connectorId,organizationId:event.organizationId},select:{configuredById:true}});
  if(!connector)return 'SUPERSEDED';
  const ctx:AuthorizedContext={organizationId:event.organizationId,userId:connector.configuredById,role:'ADMIN'};
  return await transaction(ctx,async tx=>{
   if(!connectorsEnabled())throw new AutomationSuperseded();
   const locked=await tx.$queryRaw<AutomationEvent[]>`SELECT * FROM "AutomationEvent" WHERE id=${event.id}::uuid AND "organizationId"=${event.organizationId}::uuid AND state='PROCESSING' AND "leaseToken"=${event.leaseToken}::uuid AND "leaseUntil">NOW() FOR UPDATE`;
   if(!locked.length)throw new AutomationSuperseded();
   const current=locked[0];
   const state=current.attempts>MAX_ATTEMPTS?'DEAD':await handler(tx,current);
   if(!connectorsEnabled())throw new AutomationSuperseded();
   const ack=await tx.automationEvent.updateMany({where:{id:current.id,organizationId:current.organizationId,state:'PROCESSING',leaseToken:current.leaseToken,leaseUntil:{gt:new Date()}},data:{state,leaseToken:null,leaseUntil:null,finishedAt:new Date(),lastErrorCode:state==='DEAD'?'WORKER_INTERRUPTED':null,version:{increment:1}}});
   if(!ack.count)throw new AutomationSuperseded();
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'AutomationEvent',entityId:current.id,action:'automation.'+state.toLowerCase(),details:{kind:current.kind,attempt:current.attempts,connectorId:current.connectorId}}});
   return state;
  });
 }catch(error){
  if(error instanceof AutomationSuperseded)return 'SUPERSEDED';
  const permanent=error instanceof ReactionInvalid,dead=permanent||event.attempts>=MAX_ATTEMPTS;
  const changed=await db.automationEvent.updateMany({where:{id:event.id,organizationId:event.organizationId,state:'PROCESSING',leaseToken:event.leaseToken,leaseUntil:{gt:new Date()}},data:{state:dead?'DEAD':'PENDING',leaseToken:null,leaseUntil:null,availableAt:new Date(Date.now()+Math.min(900000,30000*2**Math.min(5,event.attempts-1))+Math.floor(Math.random()*10000)),finishedAt:dead?new Date():null,lastErrorCode:permanent?error.code:'AUTOMATION_FAILED',version:{increment:1}}});
  return changed.count?(dead?'DEAD':'RETRY_SCHEDULED'):'SUPERSEDED';
 }finally{await releaseDispatchLease('AUTOMATION',event);}
}
export async function processConnectorEvent(job:EvidenceConnector){
 const row=await db.automationEvent.findUnique({where:{eventKey:connectorEventKey(job)},select:{id:true,organizationId:true}});
 if(!row||row.organizationId!==job.organizationId)return 'ABSENT';
 const claimed=await claimAutomationEvent(row);return claimed?executeAutomationEvent(claimed):'QUEUED';
}
export async function runAutomationBatch(limit=20,parallelism=2,deadline=Date.now()+20000){
 if(!connectorsEnabled())return {processed:0,outcomes:[],disabled:true};
 if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(parallelism)||parallelism<1||parallelism>4||!Number.isFinite(deadline))throw Error('Invalid automation worker bounds');
 let reserved=0;const outcomes:string[]=[];
 async function worker(){while(connectorsEnabled()&&Date.now()<deadline&&reserved<limit){reserved++;const event=await claimAutomationEvent();if(!event)return;outcomes.push(await executeAutomationEvent(event));}}
 await Promise.all(Array.from({length:parallelism},worker));
 const [pending,dead]=await Promise.all([db.automationEvent.count({where:{state:{in:['PENDING','PROCESSING']}}}),db.automationEvent.count({where:{state:'DEAD'}})]);
 return {processed:outcomes.length,outcomes,attention:dead,limitReached:pending>0,budgetExhausted:Date.now()>=deadline};
}
export async function automationHealth(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx);
  const groups=await tx.automationEvent.groupBy({by:['state'],where:{organizationId:ctx.organizationId},_count:{_all:true},_min:{createdAt:true}});
  const dead=await tx.automationEvent.findMany({where:{organizationId:ctx.organizationId,state:'DEAD'},orderBy:{createdAt:'asc'},take:20,select:{id:true,kind:true,connectorId:true,version:true,attempts:true,replayCount:true,lastErrorCode:true,createdAt:true}});
  const pending=groups.filter(g=>['PENDING','PROCESSING'].includes(g.state));
  const oldest=pending.flatMap(g=>g._min.createdAt?[g._min.createdAt.getTime()]:[]);
  return {counts:Object.fromEntries(groups.map(g=>[g.state,g._count._all])),oldestPendingAgeSeconds:oldest.length?Math.max(0,Math.floor((Date.now()-Math.min(...oldest))/1000)):0,deadLetters:dead,deadLetterLimitReached:(groups.find(g=>g.state==='DEAD')?._count._all||0)>20};
 });
}
export async function replayAutomationEvent(ctx:AuthorizedContext,id:string,version:number){
 if(!connectorsEnabled())throw new IntelligenceError('Automation awaits activation',503);
 if(!z.uuid().safeParse(id).success||!Number.isSafeInteger(version)||version<1)throw new IntelligenceError('Invalid automation selection');
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const changed=await tx.automationEvent.updateMany({where:{id,organizationId:ctx.organizationId,version,state:'DEAD',replayCount:{lt:5}},data:{state:'PENDING',attempts:0,replayCount:{increment:1},version:{increment:1},availableAt:new Date(),finishedAt:null,lastErrorCode:null,leaseToken:null,leaseUntil:null}});
  if(!changed.count)throw new IntelligenceError('Failed automation changed, is unavailable, or reached its replay limit',409);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'AutomationEvent',entityId:id,action:'automation.replay_requested',details:{version}}});
  return {id,state:'PENDING',version:version+1};
 });
}
export async function pruneAutomationEvents(){
 return db.$executeRaw`WITH old AS (SELECT id FROM "AutomationEvent" WHERE state IN ('DONE','CANCELLED') AND "finishedAt"<NOW()-interval '30 days' ORDER BY "finishedAt" LIMIT 500 FOR UPDATE SKIP LOCKED) DELETE FROM "AutomationEvent" e USING old WHERE e.id=old.id`;
}
