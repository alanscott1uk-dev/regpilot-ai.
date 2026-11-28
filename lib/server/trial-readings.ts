import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {trialResult} from '../capability-trials';
import {verifiedObservation} from './connector-observation';
import {IntelligenceError} from './intelligence-service';

export const trialReading=z.object({step:z.string(),id:z.uuid(),connectorId:z.uuid(),hash:z.string(),collectedAt:z.string(),exportId:z.uuid().nullable()});
export function trialConnector(product?:string){
 return product==='DAILYMED_LABEL'?{provider:'DAILYMED_LABEL' as const}:product?{provider:'PIPEDREAM_READ' as const,repository:'pipedream_read:'+product.replace('/',':')}:undefined;
}
export async function trialReadings(tx:Prisma.TransactionClient,org:string,actor:string,start:Date,stop:Date,track:string,results:z.infer<typeof trialResult>[],product?:string){
 const out:z.infer<typeof trialReading>[]=[];
 for(const r of results){
  if(!r.runId)continue;
  if(track!=='operator_pilot'||!['connect-first','find-failure','export-reading'].includes(r.step)||r.evidenceId)throw new IntelligenceError('Choose one supported source reading for the operator task.',400);
  const connector=trialConnector(product);
  const recorded=await tx.connectorRun.findFirst({where:{organizationId:org,id:r.runId,connector,capturedAt:{gte:start,lte:stop}}});
  const obs=verifiedObservation(recorded);
  if(!recorded||!obs||!obs.checks.length)throw new IntelligenceError('Select a verified reading collected during this trial in this workspace.',409);
  if(r.step==='connect-first'){
   const config=await tx.auditEvent.findFirst({where:{organizationId:org,actorId:actor,entityType:'EvidenceConnector',entityId:recorded.connectorId,action:'connector.configured',
    createdAt:{gte:start,lte:recorded.capturedAt},details:{path:['version'],equals:recorded.configVersion}}});
   if(!config)throw new IntelligenceError('The participant must set up this configuration during the trial.',409);
  }
  if(r.step==='find-failure'&&!obs.checks.some(x=>x.status==='FAIL'))throw new IntelligenceError('Select a reading with an observed failed check.',409);
  const exported=r.step==='export-reading'?await tx.auditEvent.findFirst({where:{organizationId:org,entityType:'Obligation',actorId:actor,action:'connector.reading_exported',
   createdAt:{gte:start,lte:stop},AND:[{details:{path:['runId'],equals:recorded.id}},{details:{path:['resultHash'],equals:recorded.resultHash}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true}}):null;
  if(r.step==='export-reading'&&!exported)throw new IntelligenceError('Export this task reading from your own account before stopping the timer.',409);
  out.push({step:r.step,id:recorded.id,connectorId:recorded.connectorId,hash:recorded.resultHash,collectedAt:recorded.capturedAt.toISOString(),exportId:exported?.id??null});
 }
 return out;
}
