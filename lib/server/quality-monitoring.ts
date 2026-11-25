import type {ConnectorRun,Prisma} from '@prisma/client';
import {z} from 'zod';
import {hashValue} from '../regulatory/intelligence';
import {observationCurrent} from '../connectors/observation';
import {isTemperatureLogger} from '../connectors/record-catalogue';
import {verifiedObservation} from './connector-observation';
import {connectorProviderEnabled} from './connector-flags';
import {connectorScopeHash} from './connector-verification';
import {loggerReadingCurrent} from './logger-calibration';
import {taskIncludesRun} from './connector-task-observations';
import {IntelligenceError} from './intelligence-service';

type Tx = Prisma.TransactionClient;
type Source = {runId:string;checkId:string};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.object({runId:z.uuid(),checkId:z.string(),connectorId:z.uuid(),controlId:z.uuid(),
  controlTitle:z.string(),scopeHash:digest,resultHash:digest,signalHash:digest,configVersion:z.number().int().positive(),
  engine:z.string(),label:z.string(),observed:z.string(),capturedAt:z.iso.datetime(),sourceUrl:z.url(),taskId:z.uuid().nullable()});
const collected = z.object({runId:z.uuid(),scopeHash:digest,resultHash:digest,configVersion:z.number().int().positive()});
const eventName = 'quality.monitoring_linked';

async function hasCollection(tx:Tx, org:string, connectorId:string, scopeHash:string, run:{id:string;resultHash:string;configVersion:number}) {
  const event = await tx.auditEvent.findFirst({where:{organizationId:org,entityType:'EvidenceConnector',entityId:connectorId,
    action:'connector.evidence_collected',details:{path:['runId'],equals:run.id}},select:{details:true}});
  const e = collected.safeParse(event?.details);
  return e.success && e.data.scopeHash===scopeHash && e.data.resultHash===run.resultHash && e.data.configVersion===run.configVersion;
}

async function sourceTask(tx:Tx, org:string, controlId:string, run:ConnectorRun) {
  const ref = await tx.auditEvent.findFirst({where:{organizationId:org,entityType:'ConnectorTaskEvidence',action:'connector.task_observation',
    AND:[{details:{path:['runId'],equals:run.id}},{details:{path:['controlId'],equals:controlId}}]},select:{entityId:true}});
  return ref && await taskIncludesRun(tx,{id:ref.entityId,organizationId:org,connectorId:run.connectorId,controlId:controlId},run) ? ref.entityId : null;
}

export async function failedMonitor(tx:Tx, org:string, selection:Source) {
  const run = await tx.connectorRun.findFirst({where:{organizationId:org,id:selection.runId},include:{connector:{include:{control:{select:{title:true}}}}}});
  if(!run) throw new IntelligenceError('This monitoring receipt was not found in this workspace',404);
  const scopeHash = connectorScopeHash(run.connector);
  const observation = verifiedObservation(run), check = observation?.checks.find(item=>item.id===selection.checkId);
  if(!observation || !check || check.status!=='FAIL' || !await hasCollection(tx,org,run.connectorId,scopeHash,run))
    throw new IntelligenceError('Choose a verified failure from the same monitored target and control',409);
  const taskId = await sourceTask(tx,org,run.connector.controlId,run);
  return {runId:run.id,checkId:check.id,connectorId:run.connectorId,controlId:run.connector.controlId,controlTitle:run.connector.control.title,
    scopeHash,resultHash:run.resultHash,signalHash:run.signalHash,configVersion:run.configVersion,engine:observation.engine,
    label:check.label,observed:check.observed,capturedAt:run.capturedAt.toISOString(),sourceUrl:check.sourceUrl||observation.sourceUrl,taskId};
}

export const monitoringKey=(org:string, selection:Source)=>hashValue({org,runId:selection.runId,checkId:selection.checkId});
export async function caseForMonitor(tx:Tx, org:string, selection:Source) {
  return tx.auditEvent.findFirst({where:{organizationId:org,entityType:'QualityCase',action:eventName,
    details:{path:['key'],equals:monitoringKey(org,selection)}},select:{entityId:true}});
}

export async function caseMonitoring(tx:Tx, org:string, caseId:string) {
  const event=await tx.auditEvent.findFirst({where:{organizationId:org,entityType:'QualityCase',entityId:caseId,action:eventName},select:{details:true}});
  if(!event) return null;
  const {source:savedSource,sourceHash,key}=z.object({source:sourceSchema,sourceHash:digest,key:digest}).parse(event.details);
  if(hashValue(savedSource)!==sourceHash || monitoringKey(org,savedSource)!==key) throw new IntelligenceError('The linked monitoring receipt failed verification',409);
  const source={...savedSource};
  const original=await tx.connectorRun.findFirst({where:{organizationId:org,id:source.runId,connectorId:source.connectorId}});
  const originalCheck=verifiedObservation(original)?.checks.find(check=>check.id===source.checkId);
  if(!original || originalCheck?.status!=='FAIL' || original.resultHash!==source.resultHash || original.signalHash!==source.signalHash)
    throw new IntelligenceError('The original failed observation could not be verified',409);
  if(!source.taskId)source.taskId=await sourceTask(tx,org,source.controlId,original);
  const newest=await tx.connectorRun.findFirst({where:{organizationId:org,connectorId:source.connectorId},
    orderBy:[{capturedAt:'desc'},{id:'desc'}],include:{connector:true}});
  const reading=verifiedObservation(newest), check=reading?.checks.find(item=>item.id===source.checkId);
  if(!newest || !reading || !check || reading.engine!==source.engine || newest.capturedAt<=original.capturedAt ||
     connectorScopeHash(newest.connector)!==source.scopeHash || !await hasCollection(tx,org,source.connectorId,source.scopeHash,newest))
    return {source,latest:null};
  const fresh=connectorProviderEnabled(newest.connector.provider) && observationCurrent(newest,newest.connector,true) &&
    (!isTemperatureLogger(newest.connector.provider) || await loggerReadingCurrent(tx,newest.connector,reading));
  return {source,latest:{runId:newest.id,resultHash:newest.resultHash,capturedAt:newest.capturedAt.toISOString(),
    status:check.status,observed:check.observed,fresh}};
}
