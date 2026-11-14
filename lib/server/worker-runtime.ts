import {Prisma} from '@prisma/client';
import {db} from './db';
import {workspaceConfigured} from './ai-auth';
import {executeScheduledTick} from '../cron-tick.mjs';
import {monitoringEnabled,runMonitoringBatch} from './monitoring-service';
import {connectorsEnabled,runConnectorBatch} from './connector-service';
import {runReviewBatch} from './control-service';
import {pruneWebhookReceipts} from './connector-webhooks';

export const workerEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_WORKER_ENABLED==='true'&&process.env.REGPILOT_AUTOMATION_ENABLED==='true';
const LEASE_MS=180000,STALE_MS=90*60000;
type TickResult=Awaited<ReturnType<typeof executeScheduledTick>>;
export function workerSlotCount(){
 const raw=process.env.REGPILOT_WORKER_SLOTS??'1';
 if(!/^[1-8]$/.test(raw))throw Error('Invalid worker capacity');
 return Number(raw);
}
export async function claimWorker(invocationKey:string,slot=0){
 if(!/^github:\d{1,20}:\d{1,5}$/.test(invocationKey))throw Error('Invalid worker invocation');
 const capacity=workerSlotCount();
 if(!Number.isInteger(slot)||slot<0||slot>=capacity)throw Error('Invalid worker slot');
 // Preserve historical single-slot invocation keys during an eventual rollout.
 const key=slot===0?invocationKey:invocationKey+':slot:'+slot;
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(710241114)`;
  const now=new Date();
  await tx.workerRun.updateMany({where:{state:'RUNNING',leaseUntil:{lte:now}},data:{state:'INTERRUPTED',finishedAt:now}});
  const earlier=await tx.workerRun.findUnique({where:{invocationKey:key}});
  if(earlier)return {kind:'reused' as const,run:earlier};
  // Reduced capacity drains retired slots before admitting replacement work.
  const running=await tx.workerRun.findFirst({where:{OR:[{slot},{slot:{gte:capacity}}],state:'RUNNING',leaseUntil:{gt:now}}});
  if(running)return {kind:'busy' as const,run:running};
  const run=await tx.workerRun.create({data:{invocationKey:key,slot,leaseUntil:new Date(now.getTime()+LEASE_MS),codeCommit:process.env.VERCEL_GIT_COMMIT_SHA||null}});
  // Operational metadata only; bound retention while preserving all live leases.
  await tx.workerRun.deleteMany({where:{startedAt:{lt:new Date(now.getTime()-30*86400000)},state:{not:'RUNNING'}}});
  return {kind:'claimed' as const,run};
 },{timeout:10000});
}
export async function runPrivateWorker(invocationKey:string,execute?:()=>Promise<TickResult>,slot=0){
 if(!workerEnabled())return {status:503,body:{ok:false,state:'disabled'}};
 const claim=await claimWorker(invocationKey,slot);
 if(claim.kind==='busy')return {status:409,body:{ok:false,state:'busy'}};
 if(claim.kind==='reused')return {status:claim.run.state==='COMPLETED'?200:claim.run.state==='RUNNING'?409:503,body:{ok:claim.run.state==='COMPLETED',state:claim.run.state.toLowerCase(),reused:true}};
 let result:TickResult;
 // Stop admitting new provider work early enough to finish bounded reads and writes.
 const admissionDeadline=Date.now()+20000;
 try{
  if(slot===0)await pruneWebhookReceipts();
  result=await (execute?execute():executeScheduledTick({
   ...(monitoringEnabled()?{sources:()=>runMonitoringBatch(12,3,admissionDeadline)}:{}),
   ...(connectorsEnabled()?{connectors:()=>runConnectorBatch(4,2,admissionDeadline)}:{}),
   // One slot owns recurring review generation. Collection slots share fair queues.
   ...(slot===0?{controlReviews:()=>runReviewBatch(admissionDeadline)}:{})
  }));
 }catch{const failed={state:'failed' as const,processed:0,attention:1};result={ok:false,modules:{sources:failed,connectors:failed,controlReviews:failed}};}
 const state=result.ok?'COMPLETED':'FAILED';
 const finished=await db.workerRun.updateMany({where:{id:claim.run.id,state:'RUNNING',leaseUntil:{gt:new Date()}},data:{state,finishedAt:new Date(),summary:result as unknown as Prisma.InputJsonValue}});
 if(finished.count!==1)return {status:503,body:{ok:false,state:'interrupted'}};
 return {status:result.ok?200:503,body:{...result,state:state.toLowerCase(),reused:false}};
}
/** Deliberately excludes tenant, provider target, credentials and task details. */
export async function workerHealth(){
 if(!workerEnabled())return {state:'disabled',ok:false};
 const capacity=workerSlotCount();
 const [runs,success]=await Promise.all([
  Promise.all(Array.from({length:capacity},(_,slot)=>db.workerRun.findFirst({where:{slot},orderBy:{startedAt:'desc'},select:{slot:true,state:true,startedAt:true,finishedAt:true,leaseUntil:true}}))),
  db.workerRun.findFirst({where:{state:'COMPLETED'},orderBy:{finishedAt:'desc'},select:{finishedAt:true}})
 ]);
 const now=Date.now();
 const slots=runs.map((run,slot)=>({slot,state:!run||now-run.startedAt.getTime()>STALE_MS?'stale':run.state==='RUNNING'?(run.leaseUntil.getTime()>now?'running':'interrupted'):run.state.toLowerCase()}));
 const unhealthy=slots.find(s=>!['completed','running'].includes(s.state));
 const state=unhealthy?.state||(slots.some(s=>s.state==='running')?'running':'completed');
 const latest=runs.filter(r=>r!==null).sort((a,b)=>b.startedAt.getTime()-a.startedAt.getTime())[0];
 return {ok:!unhealthy,state,capacity,slots,cadenceMinutes:30,staleAfterMinutes:90,lastStartedAt:latest?.startedAt.toISOString()||null,lastFinishedAt:latest?.finishedAt?.toISOString()||null,lastSuccessfulAt:success?.finishedAt?.toISOString()||null};
}
