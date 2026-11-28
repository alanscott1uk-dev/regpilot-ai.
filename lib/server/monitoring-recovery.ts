import {Prisma,type WatchSchedule} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import type {MonitoringAttempt} from '../regulatory/source-coverage';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {resolveWorkspaceSource} from './publication-catalogue';
import {publicSourceKey} from './shared-source-fetch';
import {monitoringRuntimeActive} from './monitoring-runtime-status';

type WatchState=Pick<WatchSchedule,'enabled'|'leaseUntil'|'failureCode'|'lastOutcome'|'lastSuccessAt'|'nextCheckAt'>;
export function watchRecoveryState(w:WatchState,admin:boolean,now=new Date()){
 const checking=!!w.leaseUntil&&w.leaseUntil>now;
 const recoveryPending=w.enabled&&w.lastOutcome==='RECOVERY_QUEUED';
 const overdue=w.enabled&&w.nextCheckAt.getTime()<now.getTime()-3600000;
 const retryReason=!admin?'An administrator must request another attempt.':checking?'A source check is already running.':recoveryPending?'Another attempt is already queued.':!w.failureCode&&!overdue?'There is no failed or overdue check to retry.':null;
 const state=!w.enabled?(w.failureCode?'attention':'paused'):checking?'checking':recoveryPending?'recovery-queued':w.failureCode?'retry-scheduled':!monitoringRuntimeActive()?'awaiting-activation':overdue?'overdue':w.lastSuccessAt?'scheduled':'waiting-for-first-check';
 return {state,checking,recoveryPending,retryAvailable:retryReason===null,retryReason};
}

/** Saving configuration must not turn a failed collection into a successful one.
 * Existing incidents remain visible until an actual guarded worker completes. */
export function preserveWatchIncident(old:WatchSchedule|undefined|null,enabled:boolean){
 return {failureCode:old?.failureCode??null,...(old?.failureCode&&enabled?{lastOutcome:'RECOVERY_QUEUED'}:{})};
}

/** Each watch gets its own bounded history, so a noisy source cannot hide the
 * most recent attempts for another publication. Only fixed public status fields
 * leave the audit store; provider messages and tenant payloads are never returned. */
export async function watchAttemptHistory(tx:Prisma.TransactionClient,organizationId:string,watchIds:string[]){
 if(watchIds.length>120)throw new IntelligenceError('Monitoring history exceeds the supported workspace limit',503);
 const result=new Map<string,{history:MonitoringAttempt[];historyLimited:boolean}>();
 if(!watchIds.length)return result;
 const rows=await tx.$queryRaw<Array<{watchId:string;id:string;action:string;createdAt:Date;details:Prisma.JsonValue}>>`
  SELECT w.id AS "watchId",e.id,e.action,e."createdAt",e.details
  FROM "WatchSchedule" w JOIN LATERAL (
   SELECT id,action,"createdAt",details FROM "AuditEvent"
   WHERE "organizationId"=${organizationId}::uuid AND "entityType"='WatchSchedule' AND "entityId"=w.id::text
    AND action IN ('monitoring.check_failed','monitoring.check_completed','monitoring.check_deferred','monitoring.retry_requested','monitoring.schedule_saved','monitoring.schedule_paused')
   ORDER BY "createdAt" DESC,id DESC LIMIT 6
  ) e ON TRUE
  WHERE w."organizationId"=${organizationId}::uuid AND w.id IN (${Prisma.join(watchIds.map(id=>Prisma.sql`${id}::uuid`))})
  ORDER BY w.id,e."createdAt" DESC,e.id DESC`;
 const code=(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,39}$/.test(v)?v:null;
 for(const row of rows){
  const entry=result.get(row.watchId)??{history:[],historyLimited:false};
  if(entry.history.length===5){entry.historyLimited=true;result.set(row.watchId,entry);continue;}
  const d=row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details:{};
  entry.history.push({id:row.id,at:row.createdAt.toISOString(),action:row.action,outcome:code(d.outcome),failureCode:code(d.failureCode),attempt:typeof d.attempt==='number'&&Number.isInteger(d.attempt)&&d.attempt>=0&&d.attempt<=100?d.attempt:null,paused:typeof d.paused==='boolean'?d.paused:null});
  result.set(row.watchId,entry);
 }
 return result;
}

export async function retryWatch(ctx:AuthorizedContext,input:{sourceId:string;version:number}){
 if(!ADMIN.includes(ctx.role))throw new IntelligenceError('An administrator must request another attempt',403);
 if(typeof input.sourceId!=='string'||input.sourceId.length<3||input.sourceId.length>120||!Number.isInteger(input.version)||input.version<1)throw new IntelligenceError('Choose a source and the current monitoring version');
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const source=await resolveWorkspaceSource(tx,ctx.organizationId,input.sourceId);
  if(!source)throw new IntelligenceError('Choose a registered official source');
  if(source.refreshMode==='manual')throw new IntelligenceError('Use manual refresh in Official sources.',409);
  // The workspace transaction serialises configuration; Prisma's guarded write
  // exposes a concurrent worker claim as a retryable serialization conflict.
  const watch=await tx.watchSchedule.findUnique({where:{organizationId_sourceId:{organizationId:ctx.organizationId,sourceId:input.sourceId}}});
  if(!watch)throw new IntelligenceError('This publication does not have a monitoring schedule',404);
  const response=(row:WatchSchedule,reused:boolean)=>({id:row.id,version:row.version,reused,nextCheckAt:row.nextCheckAt.toISOString(),recoveryPending:true,monitoringConfigured:monitoringRuntimeActive()});
  // A lost response can be reconciled without requesting or charging for more work.
  if(watch.version===input.version+1&&watch.configuredById===ctx.userId&&watch.enabled&&watch.lastOutcome==='RECOVERY_QUEUED')return response(watch,true);
  if(watch.version!==input.version)throw new IntelligenceError('Monitoring changed. Refresh the saved state before retrying.',409);
  const state=watchRecoveryState(watch,true);
  if(state.recoveryPending)return response(watch,true);
  if(!state.retryAvailable)throw new IntelligenceError(state.retryReason||'Another attempt cannot be requested',409);
  const shared=await tx.publicSourceFetch.findUnique({where:{key:publicSourceKey(source)},select:{retryAt:true,leaseUntil:true}});
  // A tenant retry must not bypass a publisher's shared cooldown or active fetch.
  const nextCheckAt=new Date(Math.max(Date.now(),shared?.retryAt?.getTime()||0,shared?.leaseUntil?.getTime()||0));
  const changed=await tx.watchSchedule.update({where:{id:watch.id,version:input.version,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{enabled:true,configuredById:ctx.userId,version:{increment:1},nextCheckAt,leaseToken:null,leaseUntil:null,attempts:0,lastOutcome:'RECOVERY_QUEUED'}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:'monitoring.retry_requested',entityType:'WatchSchedule',entityId:watch.id,details:{sourceId:watch.sourceId,outcome:'RECOVERY_QUEUED',failureCode:watch.failureCode,previousVersion:watch.version,version:changed.version,nextCheckAt:nextCheckAt.toISOString(),previousAttempts:watch.attempts}}});
  return response(changed,false);
 });
}
