import {Prisma} from '@prisma/client';
import {db} from './db';
import {workspaceConfigured} from './ai-auth';
import {executeScheduledTick} from '../cron-tick.mjs';
import {monitoringEnabled,runMonitoringBatch} from './monitoring-service';
import {connectorsEnabled,runConnectorBatch} from './connector-service';
import {runReviewBatch} from './control-service';

export const workerEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_WORKER_ENABLED==='true'&&process.env.REGPILOT_AUTOMATION_ENABLED==='true';
const LEASE_MS=180000,STALE_MS=90*60000;
type TickResult=Awaited<ReturnType<typeof executeScheduledTick>>;
export async function claimWorker(invocationKey:string){
 if(!/^github:\d{1,20}:\d{1,5}$/.test(invocationKey))throw Error('Invalid worker invocation');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(710241114)`;
  const now=new Date();
  await tx.workerRun.updateMany({where:{state:'RUNNING',leaseUntil:{lte:now}},data:{state:'INTERRUPTED',finishedAt:now}});
  const earlier=await tx.workerRun.findUnique({where:{invocationKey}});
  if(earlier)return {kind:'reused' as const,run:earlier};
  const running=await tx.workerRun.findFirst({where:{state:'RUNNING',leaseUntil:{gt:now}}});
  if(running)return {kind:'busy' as const,run:running};
  const run=await tx.workerRun.create({data:{invocationKey,leaseUntil:new Date(now.getTime()+LEASE_MS),codeCommit:process.env.VERCEL_GIT_COMMIT_SHA||null}});
  // Operational metadata only; bound retention while preserving all live leases.
  await tx.workerRun.deleteMany({where:{startedAt:{lt:new Date(now.getTime()-30*86400000)},state:{not:'RUNNING'}}});
  return {kind:'claimed' as const,run};
 },{timeout:10000});
}
export async function runPrivateWorker(invocationKey:string,execute?:()=>Promise<TickResult>){
 if(!workerEnabled())return {status:503,body:{ok:false,state:'disabled'}};
 const claim=await claimWorker(invocationKey);
 if(claim.kind==='busy')return {status:409,body:{ok:false,state:'busy'}};
 if(claim.kind==='reused')return {status:claim.run.state==='COMPLETED'?200:claim.run.state==='RUNNING'?409:503,body:{ok:claim.run.state==='COMPLETED',state:claim.run.state.toLowerCase(),reused:true}};
 let result:TickResult;
 try{
  result=await (execute?execute():executeScheduledTick({
   ...(monitoringEnabled()?{sources:()=>runMonitoringBatch(12,3)}:{}),
   ...(connectorsEnabled()?{connectors:()=>runConnectorBatch(4,2)}:{}),
   controlReviews:runReviewBatch
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
 const [latest,success]=await Promise.all([
  db.workerRun.findFirst({orderBy:{startedAt:'desc'},select:{state:true,startedAt:true,finishedAt:true,leaseUntil:true}}),
  db.workerRun.findFirst({where:{state:'COMPLETED'},orderBy:{finishedAt:'desc'},select:{finishedAt:true}})
 ]);
 const now=Date.now(),stale=!latest||now-latest.startedAt.getTime()>STALE_MS;
 const state=stale?'stale':latest.state==='RUNNING'?(latest.leaseUntil.getTime()>now?'running':'interrupted'):latest.state.toLowerCase();
 return {ok:state==='completed'||state==='running',state,cadenceMinutes:30,staleAfterMinutes:90,lastStartedAt:latest?.startedAt.toISOString()||null,lastFinishedAt:latest?.finishedAt?.toISOString()||null,lastSuccessfulAt:success?.finishedAt?.toISOString()||null};
}
