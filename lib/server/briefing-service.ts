import {db} from "./db";
import {requireMember} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {REGULATORY_SOURCES} from "../regulatory-sources.mjs";
import {prepareComplianceBrief} from "../operational-brief.mjs";

/** A bounded, read-only executive briefing from one organisation's persisted data. */
export async function fetchOperationalBrief(ctx:AuthorizedContext){
 const now=new Date(),since=new Date(now.getTime()-7*86400000),nextWeek=new Date(now.getTime()+7*86400000);
 const baseNames=new Map(REGULATORY_SOURCES.map(s=>[s.id,s.title]));
 const data=await db.$transaction(async tx=>{
  await requireMember(tx,ctx);
  const [events,snapshots,watches,connectors,tasks,registered]=await Promise.all([
   tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,action:"regulatory.source_text_changed",createdAt:{gte:since}},
     orderBy:{createdAt:"desc"},take:50,select:{entityId:true,createdAt:true}}),
   tx.regulatorySnapshot.findMany({where:{organizationId:ctx.organizationId},
     orderBy:[{firstCapturedAt:"desc"},{id:"desc"}],take:150,
     select:{id:true,sourceId:true,title:true,url:true,firstCapturedAt:true,lastCheckedAt:true,reviewStatus:true}}),
   tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId},
     orderBy:{nextCheckAt:"asc"},take:121,
     select:{sourceId:true,enabled:true,nextCheckAt:true,lastSuccessAt:true,failureCode:true}}),
   tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId},
     orderBy:{createdAt:"desc"},take:21,
     select:{id:true,provider:true,repository:true,enabled:true,lastSuccessAt:true,failureCode:true}}),
   tx.obligation.findMany({where:{organizationId:ctx.organizationId,status:{not:"COMPLETE"},dueDate:{lte:nextWeek}},
     orderBy:[{dueDate:"asc"},{id:"asc"}],take:101,
     select:{id:true,title:true,status:true,ownerName:true,dueDate:true}}),
   tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},take:200,select:{sourceId:true,title:true}})
  ]);
  const details=events.length?await tx.regulatorySnapshot.findMany({
   where:{organizationId:ctx.organizationId,id:{in:events.map(e=>e.entityId)}},
   select:{id:true,sourceId:true,title:true,url:true,reviewStatus:true}
  }):[];
  return {events,snapshots,watches,connectors,tasks,registered,details};
 },{isolationLevel:"RepeatableRead",timeout:12000});
 for(const s of data.registered)baseNames.set(s.sourceId,s.title);
 const byId=new Map(data.details.map(s=>[s.id,s]));
 const changes=data.events.flatMap(e=>{
  const r=byId.get(e.entityId);return r?[{id:r.id,sourceId:r.sourceId,title:r.title,sourceUrl:r.url,
    detectedAt:e.createdAt.toISOString(),reviewStatus:r.reviewStatus}]:[];
 });
 const brief=prepareComplianceBrief({
  changes,
  snapshots:data.snapshots.map(s=>({id:s.id,sourceId:s.sourceId,title:s.title,reviewStatus:s.reviewStatus,
    capturedAt:s.firstCapturedAt.toISOString(),checkedAt:s.lastCheckedAt.toISOString()})),
  watches:data.watches.map(w=>({...w,title:baseNames.get(w.sourceId)||w.sourceId,
    nextCheckAt:w.nextCheckAt.toISOString(),lastSuccessAt:w.lastSuccessAt?.toISOString()||null,
    active:process.env.REGPILOT_MONITORING_ENABLED==="true"&&process.env.REGPILOT_CRON_ENABLED==="true"&&process.env.REGPILOT_AUTOMATION_ENABLED==="true"})),
  connectors:data.connectors.map(c=>({...c,target:c.repository.slice(0,110),lastSuccessAt:c.lastSuccessAt?.toISOString()||null})),
  tasks:data.tasks.map(t=>({...t,dueDate:t.dueDate.toISOString()}))
 },now.toISOString());
 return {...brief,limits:{snapshotHistoryLimited:data.snapshots.length===150,
   scheduledSourcesLimited:data.watches.length>120,connectorsLimited:data.connectors.length>20,tasksLimited:data.tasks.length>100},
  notice:"Operational records are bounded and require independent regulatory and evidence review."};
}
