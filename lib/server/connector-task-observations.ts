import {Prisma, type ConnectorRun} from '@prisma/client';
import {hashValue} from '../regulatory/intelligence';
import {workUuid} from '../work-hub.mjs';
import {verifiedObservation} from './connector-observation';

const entityType='ConnectorTaskEvidence';
const action='connector.task_observation';
type TaskScope={id:string;organizationId:string;connectorId:string;controlId:string};
type RunProof=Pick<ConnectorRun,'id'|'resultHash'|'signalHash'|'configVersion'>;

function receiptId(task:TaskScope,runId:string){
 const h=hashValue({purpose:'connector-task-observation-v1',...task,runId});
 return [h.slice(0,8),h.slice(8,12),'8'+h.slice(13,16),'a'+h.slice(17,20),h.slice(20,32)].join('-');
}

/** Effects, receipt and queue acknowledgement share one database transaction. */
export async function recordTaskObservation(tx:Prisma.TransactionClient,actorId:string,task:TaskScope,run:RunProof,changed:boolean){
 await tx.auditEvent.createMany({data:[{
  id:receiptId(task,run.id),organizationId:task.organizationId,actorId,action,entityType,entityId:task.id,
  details:{runId:run.id,connectorId:task.connectorId,controlId:task.controlId,configVersion:run.configVersion,
   resultHash:run.resultHash,signalHash:run.signalHash,changed}
 }],skipDuplicates:true});
}

function proofReference(task:TaskScope,{id,details}:{id:string;details:Prisma.JsonValue}){
 if(!details||typeof details!=='object'||Array.isArray(details)||!workUuid(details.runId)||
  details.connectorId!==task.connectorId||details.controlId!==task.controlId||receiptId(task,details.runId)!==id)return null;
 return {runId:details.runId,configVersion:details.configVersion,resultHash:details.resultHash,
  signalHash:details.signalHash,changed:details.changed===true};
}

export async function taskIncludesRun(tx:Prisma.TransactionClient,task:TaskScope,run:RunProof){
 const row=await tx.auditEvent.findFirst({where:{id:receiptId(task,run.id),organizationId:task.organizationId,
  action,entityType,entityId:task.id},select:{id:true,details:true}});
 const ref=row&&proofReference(task,row);
 return !!ref&&ref.runId===run.id&&ref.resultHash===run.resultHash&&ref.signalHash===run.signalHash&&ref.configVersion===run.configVersion;
}

export async function taskObservations(tx:Prisma.TransactionClient,task:TaskScope){
 const receipts=await tx.auditEvent.findMany({
  where:{organizationId:task.organizationId,entityType,entityId:task.id,action},
  orderBy:[{createdAt:'desc'},{id:'desc'}],take:21,select:{id:true,details:true}
 });
 const page=receipts.slice(0,20);
 const refs=page.map(row=>proofReference(task,row));
 const runIds=refs.flatMap(ref=>ref?[ref.runId]:[]);
 const runs=runIds.length?await tx.connectorRun.findMany({where:{organizationId:task.organizationId,
  connectorId:task.connectorId,id:{in:runIds}},select:{id:true,result:true,resultHash:true,signalHash:true,
  outcome:true,configVersion:true,capturedAt:true}}):[];
 const byId=new Map(runs.map(run=>[run.id,run]));
 const comparisons=runIds.length?await tx.auditEvent.findMany({where:{organizationId:task.organizationId,
  entityType:'ConnectorRun',entityId:{in:runIds},action:'connector.compared'},select:{entityId:true,details:true}}):[];
 const byRun=new Map(comparisons.map(row=>[row.entityId,row.details]));
 const items=refs.flatMap(ref=>{
  const run=ref&&byId.get(ref.runId);
  if(!ref||!run||ref.resultHash!==run.resultHash||ref.signalHash!==run.signalHash||ref.configVersion!==run.configVersion)return [];
  const observation=verifiedObservation(run);
  if(!observation)return [];
  const exceptions=observation.checks.filter(check=>check.status!=='PASS');
  const compared=byRun.get(run.id);
  const changes=ref.changed&&compared&&typeof compared==='object'&&!Array.isArray(compared)&&
   compared.connectorId===task.connectorId&&compared.resultHash===run.resultHash&&Array.isArray(compared.checks)
   ?compared.checks.flatMap(c=>c&&typeof c==='object'&&!Array.isArray(c)&&typeof c.label==='string'&&
    typeof c.before==='string'&&typeof c.after==='string'?[{label:c.label,before:c.before,after:c.after}]:[]):[];
  return [{changeCount:changes.length,changes:changes.slice(0,5),runId:run.id,capturedAt:run.capturedAt,engine:observation.engine,changed:ref.changed,
   checkCount:observation.checks.length,exceptionCount:exceptions.length,
   exceptions:exceptions.slice(0,5).map(({label,status,nextStep})=>({label,status,nextStep}))}];
 });
 return {items,unavailable:page.length-items.length,hasEarlier:receipts.length>page.length};
}
