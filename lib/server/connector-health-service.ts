import type {Prisma} from "@prisma/client";
import {calibrationStillCurrent} from './logger-calibration';
import {verifiedObservation} from "./connector-observation";
import {db} from "./db";
import {providerGateHealth} from "./provider-gate";
import {requireMember} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {connectorProviderEnabled} from "./connector-flags";
import {connectorHealth} from "../connectors/health-dashboard.mjs";
import {connectorLabel} from "../connectors/observation";

export async function connectionEvidence(tx:Prisma.TransactionClient,org:string,includeChecks=false){
  const records=await tx.evidenceConnector.findMany({where:{organizationId:org},orderBy:[{createdAt:"desc"},{id:"asc"}],take:21,
    select:{organizationId:true,configuredById:true,controlId:true,id:true,provider:true,repository:true,branch:true,version:true,enabled:true,intervalHours:true,failureCode:true,lastSuccessAt:true,eventRevision:true,collectedEventRevision:true,
      control:{select:{id:true,title:true,enabled:true,owner:{select:{email:true}}}},controlLinks:{where:{organizationId:org,control:{enabled:true}},take:20,select:{control:{select:{id:true,title:true}}}},
      tasks:{where:{organizationId:org,status:{not:"COMPLETE"}},orderBy:[{dueDate:"asc"},{id:"asc"}],take:5,select:{id:true,title:true,ownerName:true}},
      runs:{orderBy:[{capturedAt:"desc"},{id:"desc"}],take:1,select:{id:true,configVersion:true,result:true,resultHash:true,signalHash:true,capturedAt:true,outcome:true}}}});
  const rows=await Promise.all(records.slice(0,20).map(async r=>{
    const run=r.runs[0],observation=verifiedObservation(run),checks=observation?.checks||[];
    const calibrationCurrent=r.provider!=='UBIBOT'||await calibrationStillCurrent(tx,r,observation);
    const events=await tx.auditEvent.findMany({where:{organizationId:org,entityType:"EvidenceConnector",entityId:r.id,action:{in:[
      "connector.configured","connector.evidence_collected","connector.collection_failed","connector.disconnected","connector.recovery_requested"]}},
      orderBy:[{createdAt:"desc"},{id:"desc"}],take:8,select:{id:true,createdAt:true,action:true,details:true}});
    return {id:r.id,provider:r.provider,target:connectorLabel(r),scope:{repository:r.repository,branch:r.branch},owner:r.control.owner.email,
      version:r.version,enabled:r.enabled,intervalHours:r.intervalHours,failureCode:r.failureCode,providerAvailable:connectorProviderEnabled(r.provider),
      pendingEvent:r.eventRevision!==r.collectedEventRevision,lastSuccessAt:r.lastSuccessAt?.toISOString(),lastCapturedAt:run?.capturedAt.toISOString(),
      sourceCapturedAt:observation?.capturedAt,sourceUrl:observation?.sourceUrl,runId:run?.id,resultHash:observation?run.resultHash:null,
      controls:[...(r.control.enabled?[{id:r.control.id,title:r.control.title}]:[]),...r.controlLinks.map(l=>l.control)],openTasks:r.tasks,
      observedVersion:run?.configVersion,integrityValid:!!observation&&calibrationCurrent,lastOutcome:run?.outcome,checksSeen:checks.length,
      checksFailed:checks.filter(c=>c.status==="FAIL").length,checksUnknown:checks.filter(c=>c.status==="UNKNOWN").length,
      findings:includeChecks?[...checks].sort((a,b)=>Number(a.status==="PASS")-Number(b.status==="PASS")).slice(0,8):[],
      history:events.map(e=>{const details=e.details as Record<string,unknown>|null;return {id:e.id,at:e.createdAt.toISOString(),action:e.action,
        code:typeof details?.code==="string"?details.code:null,outcome:typeof details?.outcome==="string"?details.outcome:null};})};
  }));
  return {...connectorHealth(rows),listLimitReached:records.length>20};
}
export async function getConnectorHealth(ctx:AuthorizedContext){
  const result=await db.$transaction(async tx=>{
    await requireMember(tx,ctx);return connectionEvidence(tx,ctx.organizationId);
  },{isolationLevel:"RepeatableRead",timeout:12000});
  return {...result,providerCircuits:await providerGateHealth([...new Set(result.items.map(r=>r.provider))])};
}
