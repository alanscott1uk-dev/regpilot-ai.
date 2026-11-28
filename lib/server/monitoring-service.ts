import {manualRefreshSource} from "../regulatory-sources.mjs";
import {claimFairWatch,releaseDispatchLease} from "./fair-dispatch";
import {SourceFetchDeferred} from "./shared-source-fetch";
import {timingSafeEqual} from "node:crypto";
import {Prisma,type WatchSchedule} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {createIntelligenceRun,IntelligenceError,transaction} from "./intelligence-service";
import {checkOfficialSource,type Loader} from "./regulatory-watch";
import {resolveWorkspaceSource} from "./publication-catalogue";
import {allowedEmail} from "../ai/security.mjs";
import {requireMember,ADMIN} from './workspace-member';
import {watchRecoveryState,watchAttemptHistory,preserveWatchIncident} from './monitoring-recovery';

export function monitoringEnabled(){return process.env.REGPILOT_MONITORING_ENABLED==="true";}
export function validMonitorSecret(request:Request){
  const secret=process.env.REGPILOT_MONITOR_SECRET||"",header=request.headers.get("authorization")||"";
  if(secret.length<32||secret.length>256||header.length>300)return false;
  const actual=Buffer.from(header),expected=Buffer.from("Bearer "+secret);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export async function configureWatch(ctx:AuthorizedContext,input:{sourceId:string;enabled:boolean;intervalHours:number;version:number}){
  if(!["OWNER","ADMIN"].includes(ctx.role))throw new IntelligenceError("An administrator must configure monitoring",403);
  if(typeof input.enabled!=="boolean"||![24,168].includes(input.intervalHours)||!Number.isInteger(input.version)||input.version<0)throw new IntelligenceError("Choose a recognised source, daily or weekly schedule and current version");
  return transaction(ctx,async tx=>{
    await requireMember(tx,ctx,ADMIN);
    if(!await resolveWorkspaceSource(tx,ctx.organizationId,input.sourceId))throw new IntelligenceError("Choose a registered official source");
    if(input.enabled&&manualRefreshSource(input.sourceId))throw new IntelligenceError("This publication uses manual refresh in Official sources.",409);
    const key={organizationId:ctx.organizationId,sourceId:input.sourceId};
    const old=await tx.watchSchedule.findUnique({where:{organizationId_sourceId:key}});
    if((old?.version||0)!==input.version)throw new IntelligenceError("Monitoring settings changed. Refresh first.",409);
    if(!old&&await tx.watchSchedule.count({where:{organizationId:ctx.organizationId}})>=120)throw new IntelligenceError('Maximum 120 monitored publications per organisation',429);
    const data={enabled:input.enabled,intervalHours:input.intervalHours,configuredById:ctx.userId,nextCheckAt:new Date(),leaseToken:null,leaseUntil:null,attempts:0,...preserveWatchIncident(old,input.enabled)};
    const row=await tx.watchSchedule.upsert({where:{organizationId_sourceId:key},create:{...key,...data},update:{...data,version:{increment:1}}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:input.enabled?"monitoring.schedule_saved":"monitoring.schedule_paused",entityType:"WatchSchedule",entityId:row.id,details:{sourceId:input.sourceId,intervalHours:input.intervalHours,version:row.version}}});
    return {id:row.id,version:row.version};
  });
}
export async function listWatches(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  const member=await requireMember(tx,ctx);
  const rows=await tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId},orderBy:{sourceId:"asc"},take:121,select:{id:true,sourceId:true,enabled:true,intervalHours:true,version:true,nextCheckAt:true,attempts:true,lastAttemptAt:true,lastSuccessAt:true,lastOutcome:true,failureCode:true,leaseUntil:true}});
  if(rows.length>120)throw new IntelligenceError('Monitoring exceeds the supported workspace limit',503);
  const history=await watchAttemptHistory(tx,ctx.organizationId,rows.map(row=>row.id));
  return rows.map(({leaseUntil,...r})=>({...r,...watchRecoveryState({...r,leaseUntil},ADMIN.includes(member.role)),...(history.get(r.id)??{history:[],historyLimited:false})}));
 });
}
// Atomic cross-worker claim. An expired lease is recoverable; tokens fence stale workers.
export async function claimWatch():Promise<WatchSchedule|null>{
  return claimFairWatch();
}
class LeaseLost extends Error {}
class PermissionLost extends Error {}
/** Admission is a single read, not an interactive transaction competing with
 * collection and maintenance for a reserved connection. Write transactions still
 * lock and recheck the lease and membership through assertLease below. */
async function checkLease(job:WatchSchedule){
  if(!monitoringEnabled())throw new LeaseLost();
  const rows=await db.$queryRaw<Array<{role:string|null;email:string|null}>>`
    SELECT m.role::text AS role,u.email FROM "WatchSchedule" w
    LEFT JOIN "Membership" m ON m."organizationId"=w."organizationId" AND m."userId"=w."configuredById"
    LEFT JOIN "User" u ON u.id=m."userId"
    WHERE w.id=${job.id}::uuid AND w."organizationId"=${job.organizationId}::uuid
     AND w."configuredById"=${job.configuredById}::uuid AND w.enabled=true
     AND w."leaseToken"=${job.leaseToken}::uuid AND w."leaseUntil">NOW()`;
  if(!rows.length)throw new LeaseLost();
  if(!rows[0].role||!['OWNER','ADMIN'].includes(rows[0].role)||!rows[0].email||!allowedEmail(rows[0].email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new PermissionLost();
}
async function assertLease(tx:Prisma.TransactionClient,job:WatchSchedule){
  if(!monitoringEnabled())throw new LeaseLost();
  const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "WatchSchedule" WHERE id=${job.id}::uuid AND "organizationId"=${job.organizationId}::uuid AND enabled=true AND "leaseToken"=${job.leaseToken}::uuid AND "leaseUntil">NOW() FOR UPDATE`;
  if(!rows.length)throw new LeaseLost();
  const members=await tx.$queryRaw<Array<{role:string;email:string}>>`SELECT m.role::text AS role,u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."organizationId"=${job.organizationId}::uuid AND m."userId"=${job.configuredById}::uuid FOR SHARE OF m,u`;
  if(!members.length||!["OWNER","ADMIN"].includes(members[0].role)||!allowedEmail(members[0].email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new PermissionLost();
}
async function finish(job:WatchSchedule,outcome:string,failureCode:string|null){
  return db.$transaction(async tx=>{
    const halted=!!failureCode&&(job.attempts>=3||failureCode==="PERMISSION_REVOKED");
    const changed=await tx.watchSchedule.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{
      leaseToken:null,leaseUntil:null,lastOutcome:outcome,failureCode,enabled:!halted,
      nextCheckAt:new Date(Date.now()+(failureCode?(job.attempts===1?5:30)*60000:outcome==="RECOVERY_BACKLOG"?60000:job.intervalHours*3600000)),
      ...(!failureCode?{lastSuccessAt:new Date(),attempts:0}:{})
    }});
    if(!changed.count)return "SUPERSEDED";
    await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:failureCode?"monitoring.check_failed":"monitoring.check_completed",entityType:"WatchSchedule",entityId:job.id,details:{sourceId:job.sourceId,outcome,failureCode,attempt:job.attempts,paused:halted}}});
    return halted?"ATTENTION":outcome;
  });
}
async function deferWatch(job:WatchSchedule,outcome:string,reason:string,retryAt:Date){
 return db.$transaction(async tx=>{
  const before=await tx.watchSchedule.findFirst({where:{id:job.id,organizationId:job.organizationId,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},select:{failureCode:true,lastOutcome:true}});
  if(!before)return 'SUPERSEDED';
  // A busy shared fetch is not evidence that the previous failed check recovered.
  const failureCode=['SOURCE_FETCH_BUSY','SOURCE_FETCH_SUPERSEDED'].includes(reason)&&before.failureCode?before.failureCode:reason;
  const changed=await tx.watchSchedule.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,attempts:Math.max(0,job.attempts-1),lastOutcome:outcome,failureCode,nextCheckAt:retryAt}});
  if(!changed.count)return 'SUPERSEDED';
  // Record transitions, not one duplicate audit row for every publisher retry.
  if(before.failureCode!==failureCode||before.lastOutcome!==outcome)await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:'monitoring.check_deferred',entityType:'WatchSchedule',entityId:job.id,details:{sourceId:job.sourceId,outcome,failureCode,attempt:job.attempts,paused:false,nextCheckAt:retryAt.toISOString()}}});
  return outcome;
 });
}
/**
 * Monitoring content changes create one owned investigation, not a compliance
 * determination. Exact source snapshot version is captured; human assessment
 * and downstream acceptance remain independent.
 */
async function queueChangedSourceReview(ctx:AuthorizedContext,job:WatchSchedule,snapshot:{id:string;contentHash:string;title:string;url:string},guard:(tx:Prisma.TransactionClient)=>Promise<void>){
 const key="source-review:"+snapshot.id;
 return transaction(ctx,async tx=>{
  await guard(tx);
  const current=await tx.regulatorySnapshot.findFirst({where:{id:snapshot.id,organizationId:ctx.organizationId,sourceId:job.sourceId,reviewStatus:"NEEDS_REVIEW"}});
  if(!current||current.contentHash!==snapshot.contentHash)return {created:false};
  const earlier=await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey:key}}});
  if(earlier)return {created:false};
  const reviewer=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}}});
  if(!reviewer||!["OWNER","ADMIN"].includes(reviewer.role))return {created:false};
  const owner=await tx.user.findUnique({where:{id:ctx.userId},select:{email:true}});
  if(!owner)return {created:false};
  const due=new Date(Date.now()+7*86400000);
  const item=await tx.obligation.create({data:{
   organizationId:ctx.organizationId,automationKey:key,assigneeId:ctx.userId,ownerName:owner.email,
   title:("Review changed publication: "+current.title).slice(0,160),
   category:"Regulatory source monitoring",dueDate:due,
   sourceUrl:current.url,sourceCheckedAt:new Date(),status:"OPEN",
   notes:"Published source text changed against the previously captured snapshot. Review the actual official text, assess jurisdiction, applicability and effective dates, and arrange independent source review. An observed text change is not automatically a legal change."
  }});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
   action:"monitoring.source_review_task_created",entityType:"Obligation",entityId:item.id,
   details:{sourceId:job.sourceId,snapshotId:current.id,contentHash:current.contentHash,scheduledById:job.configuredById}}});
  return {created:true};
 });
}
/** Reconcile persisted changed snapshots before fetching again. A worker can stop
 * after capture commits but before task creation; a cooldown/unchanged result must
 * not lose that work. The capture audit and hash prove a change, not a baseline. */
export async function reconcileSourceReviews(ctx:AuthorizedContext,job:WatchSchedule,guard:(tx:Prisma.TransactionClient)=>Promise<void>){
 const pending=await db.$queryRaw<Array<{id:string;contentHash:string;title:string;url:string}>>`
  SELECT DISTINCT s.id,s."contentHash",s.title,s.url,s."firstCapturedAt"
  FROM "RegulatorySnapshot" s JOIN "AuditEvent" e
   ON e."organizationId"=s."organizationId" AND e."entityId"=s.id::text
   AND e.action='regulatory.source_text_changed' AND e."entityType"='RegulatorySnapshot'
   AND e.details->>'hash'=s."contentHash" AND e.details->>'changedText'='true'
   AND e.details->>'previousHash' IS NOT NULL
  LEFT JOIN "Obligation" o ON o."organizationId"=s."organizationId" AND o."automationKey"='source-review:'||s.id::text
  WHERE s."organizationId"=${ctx.organizationId}::uuid AND s."sourceId"=${job.sourceId}
   AND s."reviewStatus"='NEEDS_REVIEW' AND o.id IS NULL
  ORDER BY s."firstCapturedAt",s.id LIMIT 11`;
 let created=0;
 for(const snapshot of pending.slice(0,10))if((await queueChangedSourceReview(ctx,job,snapshot,guard)).created)created++;
 return {created,backlog:pending.length>10};
}
export async function executeWatch(job:WatchSchedule,loader?:Loader){
  let stage:'LEASE'|'RECOVERY'|'FETCH'|'ANALYSIS'|'FINISH'='LEASE';
  try{
    if(manualRefreshSource(job.sourceId)){
      // Retire schedules created before this publication became manual. Preserve retrieval history.
      const changed=await db.watchSchedule.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},
        data:{enabled:false,leaseToken:null,leaseUntil:null,lastOutcome:'MANUAL_REFRESH',version:{increment:1}}});
      return changed.count?'MANUAL_REFRESH':'SUPERSEDED';
    }
    await checkLease(job);
    if(job.attempts>3)return await finish(job,"FAILED","INTERRUPTED_REPEATEDLY");
    const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"};
    const guard=(tx:Prisma.TransactionClient)=>assertLease(tx,job);
    stage='RECOVERY';
    const recovered=await reconcileSourceReviews(ctx,job,guard);
    stage='FETCH';
    const checked=await checkOfficialSource(ctx,job.sourceId,loader,guard);
    // The monitored publication may have changed; create an owned investigation only
    // for a *new content version*, never for the baseline, metadata or an outage.
    if(checked.state==="CONTENT_CHANGED"){
      const {id,contentHash,title,url}=checked.snapshot;
      if(typeof id!=="string"||typeof contentHash!=="string"||typeof title!=="string"||typeof url!=="string")
        throw new IntelligenceError("Changed official source snapshot is missing verified identity",503);
      await queueChangedSourceReview(ctx,job,{id,contentHash,title,url},guard);
    }
    // Checkpoint is already persisted. A retry reuses the snapshot and unique analysis.
    stage='ANALYSIS';
    if(await db.businessProfile.findUnique({where:{organizationId:job.organizationId}}))await createIntelligenceRun(ctx,checked.snapshot.id,guard);
    // Human review remains required; no paid AI, accepted legal decisions or outbound notifications.
    stage='FINISH';
    await checkLease(job);
    return await finish(job,recovered.backlog?"RECOVERY_BACKLOG":checked.state,null);
  }catch(error){
    if(error instanceof LeaseLost)return "SUPERSEDED";
    if(error instanceof SourceFetchDeferred){
      return await deferWatch(job,'SOURCE_DEFERRED',error.code,error.retryAt);
    }
    if(stage==='ANALYSIS'&&error instanceof IntelligenceError&&error.status===429){
      return await deferWatch(job,'ANALYSIS_DEFERRED','ANALYSIS_DEFERRED',new Date(Date.now()+3600000));
    }
    const databaseCode=error instanceof Prisma.PrismaClientKnownRequestError&&/^P\d{4}$/.test(error.code)?error.code:null;
    if(databaseCode==='P2028'||databaseCode==='P2024'){
      // Capacity/transaction timeouts are infrastructure incidents, not evidence
      // that the publication failed. Keep the schedule eligible for a later tick.
      console.warn('monitoring.database_deferred',{stage,code:databaseCode});
      return await deferWatch(job,'WORKER_DEFERRED','DATABASE_BUSY',new Date(Date.now()+60000));
    }
    const code=error instanceof PermissionLost?'PERMISSION_REVOKED':databaseCode?stage+'_'+databaseCode:stage+'_FAILED';
    // Fixed stage/code only: never log tenant identities, credentials or raw errors.
    console.warn('monitoring.check_failed',{stage,code});
    return await finish(job,"FAILED",code);
  }finally{await releaseDispatchLease("SOURCE",job);}
}
export async function runMonitoringBatch(limit=2,parallelism=1,admissionDeadline=Date.now()+20000){
  if(!monitoringEnabled())throw new IntelligenceError("Scheduled monitoring is disabled",503);
  if(!Number.isInteger(limit)||limit<1||limit>12||!Number.isInteger(parallelism)||parallelism<1||parallelism>3||!Number.isFinite(admissionDeadline))
    throw new IntelligenceError("Monitoring worker bounds invalid",400);
  const outcomes:Array<{index:number;outcome:string}>=[];
  // Reserve time for a bounded fetch and transactional completion before route timeout.
  const deadline=Math.min(admissionDeadline,Date.now()+20000);
  let claimed=0;
  async function worker(){
    while(monitoringEnabled()&&Date.now()<deadline&&claimed<limit){
      const index=claimed++;
      const job=await claimWatch();
      if(!job)return;
      const outcome=await executeWatch(job);
      outcomes.push({index,outcome});
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,parallelism)},()=>worker()));
  outcomes.sort((a,b)=>a.index-b.index);
  return {processed:outcomes.length,outcomes:outcomes.map(x=>x.outcome),limitReached:outcomes.length===limit,budgetExhausted:Date.now()>=deadline};
}
