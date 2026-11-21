import {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {REGULATORY_SOURCES,manualRefreshSource} from "../regulatory-sources.mjs";
import type {SourceCoverage} from "../regulatory/source-coverage";
import {watchRecoveryState,watchAttemptHistory} from './monitoring-recovery';
import {monitoringRuntimeActive} from './monitoring-runtime-status';
export async function sourceCoverage(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 const member=await requireMember(tx,ctx);
 const extra=await tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},select:{sourceId:true},orderBy:{title:"asc"},take:200});
 const ids=[...new Set([...REGULATORY_SOURCES.map(s=>s.id),...extra.map(s=>s.sourceId)])];
 // Latest per source, independent of the history screen's 60-version page.
 const rows=await tx.$queryRaw<Array<{sourceId:string;id:string;reviewStatus:string;lastCheckedAt:Date}>>`SELECT DISTINCT ON ("sourceId") "sourceId",id,"reviewStatus"::text,"lastCheckedAt" FROM "RegulatorySnapshot" WHERE "organizationId"=${ctx.organizationId}::uuid AND "sourceId" IN (${Prisma.join(ids)}) ORDER BY "sourceId","firstCapturedAt" DESC,id DESC`;
 const watches=await tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId,sourceId:{in:ids}},take:121,select:{id:true,sourceId:true,version:true,enabled:true,intervalHours:true,failureCode:true,nextCheckAt:true,lastSuccessAt:true,lastOutcome:true,attempts:true,lastAttemptAt:true,leaseUntil:true}});
 if(watches.length>120)throw new IntelligenceError('Monitoring exceeds the supported workspace limit',503);
 const history=await watchAttemptHistory(tx,ctx.organizationId,watches.map(w=>w.id));
 const snapshots=new Map(rows.map(r=>[r.sourceId,r])),schedules=new Map(watches.map(w=>[w.sourceId,w]));
 const manualChecks=new Map<string,{id:string;at:string;by:string}>();
 for(const sourceId of ids.filter(manualRefreshSource)){
  const event=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType:'RegulatorySource',entityId:sourceId,action:'regulatory.manual_check'},
    orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,createdAt:true,actor:{select:{email:true}}}});
  if(event)manualChecks.set(sourceId,{id:event.id,at:event.createdAt.toISOString(),by:event.actor.email});
 }
 const labels:Record<string,string>={'attention':'Collection needs attention','paused':'Paused','checking':'Check in progress','recovery-queued':'Retry queued — awaiting a completed check','retry-scheduled':'Collection needs attention','awaiting-activation':'Awaiting activation','overdue':'Schedule overdue','waiting-for-first-check':'Waiting for first scheduled check','scheduled':'Scheduled'};
 return ids.map(sourceId=>{
  const r=snapshots.get(sourceId),w=manualRefreshSource(sourceId)?undefined:schedules.get(sourceId),state=w?watchRecoveryState(w,ADMIN.includes(member.role)):null;
  return {sourceId,snapshotId:r?.id||null,reviewStatus:r?.reviewStatus||null,lastCheckedAt:r?.lastCheckedAt.toISOString()||null,
   reviewHref:'/team/sources?'+new URLSearchParams({organizationId:ctx.organizationId,sourceId}).toString(),
   schedule:w?{version:w.version,enabled:w.enabled,intervalHours:w.intervalHours,failureCode:w.failureCode,nextCheckAt:w.nextCheckAt.toISOString(),lastSuccessAt:w.lastSuccessAt?.toISOString()||null,lastOutcome:w.lastOutcome,attempts:w.attempts,active:monitoringRuntimeActive(),lastAttemptAt:w.lastAttemptAt?.toISOString()||null,...state!,...(history.get(w.id)??{history:[],historyLimited:false})}:null,
   ...(manualRefreshSource(sourceId)?{manualCheck:manualChecks.get(sourceId)??null}:{}),
   monitoring:manualRefreshSource(sourceId)?'Manual refresh':state?labels[state.state]:'Not scheduled'} satisfies SourceCoverage;
 });
 });}
