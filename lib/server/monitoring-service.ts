import {randomUUID,timingSafeEqual} from "node:crypto";
import {Prisma,type WatchSchedule} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {createIntelligenceRun,IntelligenceError,transaction} from "./intelligence-service";
import {checkOfficialSource,type Loader} from "./regulatory-watch";
import {loadOfficialSource} from "./ai-sources";
import {resolveWorkspaceSource} from "./publication-catalogue";
import {allowedEmail} from "../ai/security.mjs";

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
    const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}}});
    if(!member||!["OWNER","ADMIN"].includes(member.role))throw new IntelligenceError("Your administration access changed",403);
    if(!await resolveWorkspaceSource(tx,ctx.organizationId,input.sourceId))throw new IntelligenceError("Choose a registered official source");
    const key={organizationId:ctx.organizationId,sourceId:input.sourceId};
    const old=await tx.watchSchedule.findUnique({where:{organizationId_sourceId:key}});
    if((old?.version||0)!==input.version)throw new IntelligenceError("Monitoring settings changed. Refresh first.",409);
    const data={enabled:input.enabled,intervalHours:input.intervalHours,configuredById:ctx.userId,nextCheckAt:new Date(),leaseToken:null,leaseUntil:null,attempts:0,failureCode:null};
    const row=await tx.watchSchedule.upsert({where:{organizationId_sourceId:key},create:{...key,...data},update:{...data,version:{increment:1}}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:input.enabled?"monitoring.schedule_saved":"monitoring.schedule_paused",entityType:"WatchSchedule",entityId:row.id,details:{sourceId:input.sourceId,intervalHours:input.intervalHours,version:row.version}}});
    return {id:row.id,version:row.version};
  });
}
export async function listWatches(ctx:AuthorizedContext){
  const rows=await db.watchSchedule.findMany({where:{organizationId:ctx.organizationId},orderBy:{sourceId:"asc"},select:{id:true,sourceId:true,enabled:true,intervalHours:true,version:true,nextCheckAt:true,attempts:true,lastAttemptAt:true,lastSuccessAt:true,lastOutcome:true,failureCode:true,leaseUntil:true}});
  return rows.map(({leaseUntil,...r})=>({...r,state:!r.enabled?(r.failureCode?"attention":"paused"):!monitoringEnabled()?"awaiting-activation":leaseUntil&&leaseUntil.getTime()>Date.now()?"checking":r.failureCode?"retry-scheduled":r.nextCheckAt.getTime()<Date.now()-3600000?"overdue":r.lastSuccessAt?"scheduled":"waiting-for-first-check"}));
}
// Atomic cross-worker claim. An expired lease is recoverable; tokens fence stale workers.
export async function claimWatch():Promise<WatchSchedule|null>{
  const token=randomUUID();
  const rows=await db.$queryRaw<WatchSchedule[]>`
    WITH due AS (
      SELECT id FROM "WatchSchedule" WHERE enabled=true AND "nextCheckAt"<=NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW())
      ORDER BY "nextCheckAt",id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "WatchSchedule" w SET "leaseToken"=${token}::uuid,
      "leaseUntil"=NOW()+interval '90 seconds',"lastAttemptAt"=NOW(),attempts=w.attempts+1,"updatedAt"=NOW()
      FROM due WHERE w.id=due.id RETURNING w.*`;
  return rows[0]||null;
}
class LeaseLost extends Error {}
class PermissionLost extends Error {}
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
      nextCheckAt:new Date(Date.now()+(failureCode?(job.attempts===1?5:30)*60000:job.intervalHours*3600000)),
      ...(!failureCode?{lastSuccessAt:new Date(),attempts:0}:{})
    }});
    if(!changed.count)return "SUPERSEDED";
    await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:failureCode?"monitoring.check_failed":"monitoring.check_completed",entityType:"WatchSchedule",entityId:job.id,details:{sourceId:job.sourceId,outcome,failureCode,attempt:job.attempts,paused:halted}}});
    return halted?"ATTENTION":outcome;
  });
}
/**
 * Monitoring content changes create one owned investigation, not a compliance
 * determination. Exact source snapshot version is captured; human assessment
 * and downstream acceptance remain independent.
 */
async function queueChangedSourceReview(ctx:AuthorizedContext,job:WatchSchedule,snapshot:{id:string;contentHash:string;title:string;url:string},guard:(tx:Prisma.TransactionClient)=>Promise<void>){
 const key="source-review:"+snapshot.id;
 return db.$transaction(async tx=>{
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
 },{isolationLevel:"Serializable",maxWait:3500,timeout:10000});
}
export async function executeWatch(job:WatchSchedule,loader?:Loader){
  try{
    await db.$transaction(tx=>assertLease(tx,job));
    if(job.attempts>3)return await finish(job,"FAILED","INTERRUPTED_REPEATEDLY");
    const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"};
    const guard=(tx:Prisma.TransactionClient)=>assertLease(tx,job);
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
    if(await db.businessProfile.findUnique({where:{organizationId:job.organizationId}}))await createIntelligenceRun(ctx,checked.snapshot.id,guard);
    // No AI, no accepted decisions, no task creation or notification side effects here.
    await db.$transaction(tx=>assertLease(tx,job));
    return await finish(job,checked.state,null);
  }catch(error){
    if(error instanceof LeaseLost)return "SUPERSEDED";
    return await finish(job,"FAILED",error instanceof PermissionLost?"PERMISSION_REVOKED":"CHECK_OR_ANALYSIS_FAILED");
  }
}
export async function runMonitoringBatch(limit=2,parallelism=1){
  if(!monitoringEnabled())throw new IntelligenceError("Scheduled monitoring is disabled",503);
  if(!Number.isInteger(limit)||limit<1||limit>12||!Number.isInteger(parallelism)||parallelism<1||parallelism>3)
    throw new IntelligenceError("Monitoring worker bounds invalid",400);
  const outcomes:Array<{index:number;outcome:string}>=[];
  const deadline=Date.now()+45000;
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
  return {processed:outcomes.length,outcomes:outcomes.map(x=>x.outcome),limitReached:outcomes.length===limit};
}
