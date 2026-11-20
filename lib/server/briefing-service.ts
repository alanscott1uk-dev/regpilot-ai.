import {db} from "./db";
import {assuranceCoverage} from './assurance-coverage';
import {ADMIN,requireMember} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {REGULATORY_SOURCES} from "../regulatory-sources.mjs";
import {prepareComplianceBrief} from "../operational-brief.mjs";
import {recordedWorkCompletions,workspaceLink} from './workspace-journey';
import {monitoringRuntimeActive} from './monitoring-runtime-status';

/** A bounded, read-only executive briefing from one organisation's persisted data. */
export async function fetchOperationalBrief(ctx:AuthorizedContext){
 const now=new Date(),since=new Date(now.getTime()-7*86400000),nextWeek=new Date(now.getTime()+7*86400000);
 const baseNames=new Map(REGULATORY_SOURCES.map(s=>[s.id,s.title]));
 const data=await db.$transaction(async tx=>{
  const member=await requireMember(tx,ctx);
  const [events,snapshots,watches,connectors,tasks,registered,completions]=await Promise.all([
   tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,action:"regulatory.source_text_changed",createdAt:{gte:since}},
     orderBy:{createdAt:"desc"},take:50,select:{entityId:true,createdAt:true}}),
   tx.$queryRaw<Array<{id:string;sourceId:string;title:string;url:string;firstCapturedAt:Date;lastCheckedAt:Date;reviewStatus:string}>>`
    SELECT * FROM (SELECT DISTINCT ON ("sourceId") id,"sourceId",title,url,"firstCapturedAt","lastCheckedAt","reviewStatus"::text
    FROM "RegulatorySnapshot" WHERE "organizationId"=${ctx.organizationId}::uuid ORDER BY "sourceId","firstCapturedAt" DESC,id DESC) latest
    ORDER BY "firstCapturedAt" DESC,id DESC LIMIT 151`,
   tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId},
     orderBy:{nextCheckAt:"asc"},take:121,
     select:{sourceId:true,enabled:true,nextCheckAt:true,lastSuccessAt:true,failureCode:true,lastOutcome:true}}),
   tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId},
     orderBy:{createdAt:"desc"},take:21,
     select:{id:true,provider:true,repository:true,enabled:true,lastSuccessAt:true,failureCode:true}}),
   tx.obligation.findMany({where:{organizationId:ctx.organizationId,status:{not:"COMPLETE"},dueDate:{lte:nextWeek}},
     orderBy:[{dueDate:"asc"},{id:"asc"}],take:101,
     select:{id:true,title:true,status:true,ownerName:true,dueDate:true}}),
   tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},take:200,select:{sourceId:true,title:true}}),
   recordedWorkCompletions(tx,ctx,since,now)
  ]);
  const details=events.length?await tx.regulatorySnapshot.findMany({
   where:{organizationId:ctx.organizationId,id:{in:events.map(e=>e.entityId)}},
   select:{id:true,sourceId:true,title:true,url:true,reviewStatus:true}
  }):[];
  const coverage=ADMIN.includes(member.role)?await assuranceCoverage(tx,ctx.organizationId,now):null;
  return {coverage,events,snapshots,watches,connectors,tasks,registered,details,completions};
 },{isolationLevel:"RepeatableRead",timeout:12000});
 for(const s of data.registered)baseNames.set(s.sourceId,s.title);
 const byId=new Map(data.details.map(s=>[s.id,s]));
 const changes=data.events.flatMap(e=>{
  const r=byId.get(e.entityId);return r?[{id:r.id,sourceId:r.sourceId,title:r.title,sourceUrl:r.url,
    detectedAt:e.createdAt.toISOString(),reviewStatus:r.reviewStatus}]:[];
 });
 const brief=prepareComplianceBrief({
  changes,
  snapshots:data.snapshots.slice(0,150).map(s=>({id:s.id,sourceId:s.sourceId,title:s.title,reviewStatus:s.reviewStatus,
    capturedAt:s.firstCapturedAt.toISOString(),checkedAt:s.lastCheckedAt.toISOString()})),
  watches:data.watches.map(w=>({...w,title:baseNames.get(w.sourceId)||w.sourceId,
    nextCheckAt:w.nextCheckAt.toISOString(),lastSuccessAt:w.lastSuccessAt?.toISOString()||null,
    active:monitoringRuntimeActive()})),
  connectors:data.connectors.map(c=>({...c,target:c.repository.slice(0,110),lastSuccessAt:c.lastSuccessAt?.toISOString()||null})),
  tasks:data.tasks.map(t=>({...t,dueDate:t.dueDate.toISOString()}))
 },now.toISOString());
 const scoped=<T extends {href:string}>(items:T[])=>items.map(item=>{const url=new URL(item.href,'https://workspace.invalid');url.searchParams.set('organizationId',ctx.organizationId);return {...item,href:url.pathname+url.search};});
 return {...brief,coverage:data.coverage,organizationId:ctx.organizationId,summary:{...brief.summary,completedWork:data.completions.records.length},
  changes:scoped(brief.changes),pending:scoped(brief.pending),collections:scoped(brief.collections),connectors:scoped(brief.connectors),
  tasks:brief.tasks.map(task=>({...task,href:workspaceLink(ctx.organizationId,'/team/work',{taskId:task.id})})),
  completedWork:data.completions.records,completionRecordsUnavailable:data.completions.unavailable,
  completionScope:'Validated saved completion decisions from this seven-day period for tasks still marked complete. These frozen records describe proof at completion; this read does not re-check stored bytes or establish continuing compliance. Use completed-work reviews to inspect subsequent changes.',
  limits:{snapshotHistoryLimited:data.snapshots.length>150,
   scheduledSourcesLimited:data.watches.length>120,connectorsLimited:data.connectors.length>20,tasksLimited:data.tasks.length>100,completionRecordsLimited:data.completions.limited},
  notice:"Operational records are bounded and require independent regulatory and evidence review."};
}
