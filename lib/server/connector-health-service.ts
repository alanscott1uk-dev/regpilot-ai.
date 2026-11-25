import {connectionDirectory, directoryCsv, filterDirectory} from './connector-directory';
import {connectorHistoryPageSize} from '../connectors/capacity';
import type {ConnectionFilter} from '../connectors/health-filters';
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

export async function connectionEvidence(tx:Prisma.TransactionClient,org:string,ids:readonly string[]){
  const records=await tx.evidenceConnector.findMany({where:{organizationId:org,id:{in:[...ids]}},orderBy:[{createdAt:"desc"},{id:"asc"}],
    select:{organizationId:true,configuredById:true,controlId:true,id:true,provider:true,repository:true,branch:true,version:true,enabled:true,intervalHours:true,failureCode:true,lastSuccessAt:true,eventRevision:true,collectedEventRevision:true,
      control:{select:{id:true,title:true,enabled:true,owner:{select:{email:true}}}},controlLinks:{where:{organizationId:org,control:{enabled:true}},take:20,select:{control:{select:{id:true,title:true}}}},
      tasks:{where:{organizationId:org,status:{not:"COMPLETE"}},orderBy:[{dueDate:"asc"},{id:"asc"}],take:5,select:{id:true,title:true,ownerName:true}},
      runs:{orderBy:[{capturedAt:"desc"},{id:"desc"}],take:1,select:{id:true,configVersion:true,result:true,resultHash:true,signalHash:true,capturedAt:true,outcome:true}}}});
  const rows=await Promise.all(records.map(async r=>{
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
      findings:[...checks].sort((a,b)=>Number(a.status==="PASS")-Number(b.status==="PASS")).slice(0,8),
      history:events.map(e=>{const details=e.details as Record<string,unknown>|null;return {id:e.id,at:e.createdAt.toISOString(),action:e.action,
        code:typeof details?.code==="string"?details.code:null,outcome:typeof details?.outcome==="string"?details.outcome:null};})};
  }));
  return connectorHealth(rows);
}

type HealthQuery = {q?: string; filter?: ConnectionFilter; page?: number};

export async function getConnectorHealth(ctx:AuthorizedContext, query: HealthQuery = {}) {
  const result = await db.$transaction(async tx => {
    await requireMember(tx, ctx);
    const directory = await connectionDirectory(tx, ctx.organizationId);
    const {matches, counts} = filterDirectory(directory, query.q || '', query.filter || 'all');
    const pages = Math.max(1, Math.ceil(matches.length / connectorHistoryPageSize));
    const page = Math.min(query.page || 1, pages);
    const start = (page - 1) * connectorHistoryPageSize;
    const ids = matches.slice(start, start + connectorHistoryPageSize).map(row => row.id);
    const detail = await connectionEvidence(tx, ctx.organizationId, ids);
    return {...detail, organizationId: ctx.organizationId, configured: directory.length, matched: matches.length,
      countsByFilter: counts, page, pages, pageSize: connectorHistoryPageSize, listLimitReached: pages > 1};
  }, {isolationLevel: "RepeatableRead", timeout: 12000});
  return {...result, providerCircuits: await providerGateHealth([...new Set(result.items.map(r => r.provider))])};
}

export async function exportConnectorHealth(ctx: AuthorizedContext, query: HealthQuery) {
  return db.$transaction(async tx => {
    await requireMember(tx, ctx);
    const directory = await connectionDirectory(tx, ctx.organizationId);
    const {matches} = filterDirectory(directory, query.q || '', query.filter || 'all');
    return {organizationId: ctx.organizationId, rows: matches.length, csv: directoryCsv(ctx.organizationId, matches)};
  }, {isolationLevel: "RepeatableRead", timeout: 12000});
}
