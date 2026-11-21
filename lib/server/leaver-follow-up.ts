import type {Prisma,EvidenceConnector,ConnectorRun} from "@prisma/client";
import {observationCurrent,type Observation} from "../connectors/observation";

export async function leaverTask(tx:Prisma.TransactionClient,organizationId:string,connectorId:string|null){
  if(!connectorId)return false;
  return Boolean(await tx.evidenceConnector.findFirst({where:{organizationId,id:connectorId,provider:"WORKFORCE_LEAVER"},select:{id:true}}));
}
export async function settleLeaverFollowUp(tx:Prisma.TransactionClient,job:EvidenceConnector,run:ConnectorRun,observation:Observation){
  const latest=await tx.connectorRun.findFirst({where:{organizationId:job.organizationId,connectorId:job.id},orderBy:[{capturedAt:"desc"},{id:"desc"}],select:{id:true}});
  if(latest?.id!==run.id)return "SUPERSEDED";
  const fresh=observationCurrent(run,job,true)&&observationCurrent({configVersion:run.configVersion,capturedAt:new Date(observation.capturedAt)},job,true);
  const ids=["hr-leaver","jira-remediation","entra-identity","entra-disabled"];
  if(!fresh||job.eventRevision!==job.collectedEventRevision||run.outcome!=="OBSERVED"||observation.engine!=="bamboo-entra-jira-leaver-1.0.0"||
    !ids.every(id=>observation.checks.some(c=>c.id===id&&c.status==="PASS")))return "UNRESOLVED";
  const tasks=await tx.obligation.findMany({where:{organizationId:job.organizationId,connectorId:job.id,category:"Automated evidence follow-up",status:{not:"COMPLETE"}},select:{id:true}});
  for(const task of tasks){
    const completedAt=new Date();
    await tx.obligation.update({where:{id:task.id},data:{status:"COMPLETE",completedAt,completionException:false,completionRationale:"Matched termination, completed Jira issue and fresh disabled directory account. Evidence "+run.id}});
    await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,entityType:"Obligation",entityId:task.id,action:"connector.leaver_verified",details:{connectorId:job.id,runId:run.id,configVersion:run.configVersion,resultHash:run.resultHash,sourceCapturedAt:observation.capturedAt,sourceUrl:observation.sourceUrl}}});
  }
  return "VERIFIED";
}
