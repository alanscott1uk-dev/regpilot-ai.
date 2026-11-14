// Operational briefing: facts from persisted tenant records, never AI legal interpretation.
const safe=v=>Array.isArray(v)?v:[];
const date=v=>{const n=Date.parse(v||"");return Number.isFinite(n)?n:null};
const clean=v=>typeof v==="string"?v.trim():"";
const csv=v=>{const s=String(v??"");const n=/^[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+n.replace(/"/g,'""')+'"';};
export function prepareComplianceBrief(inputs,now=new Date().toISOString()){
 const nowMs=date(now);if(nowMs===null)throw new Error("Invalid reporting date");
 const weekAgo=nowMs-7*86400000,soon=nowMs+7*86400000;
 const changes=safe(inputs?.changes).filter(x=>{
  return clean(x.id)&&clean(x.sourceId)&&clean(x.title)&&date(x.detectedAt)!==null&&date(x.detectedAt)>=weekAgo&&date(x.detectedAt)<=nowMs;
 }).slice(0,50).map(x=>({id:x.id,sourceId:x.sourceId,title:x.title,sourceUrl:clean(x.sourceUrl),
  detectedAt:x.detectedAt,status:clean(x.reviewStatus)||"NEEDS_REVIEW",summary:"Publication text changed; legal significance unassessed",
  href:"/team/sources?sourceId="+encodeURIComponent(x.sourceId)}));
 const latest=new Map();
 for(const row of safe(inputs?.snapshots).filter(x=>clean(x.sourceId)&&date(x.capturedAt)!==null).sort((a,b)=>date(b.capturedAt)-date(a.capturedAt))){
  if(!latest.has(row.sourceId))latest.set(row.sourceId,row);
 }
 const pending=[...latest.values()].filter(x=>x.reviewStatus==="NEEDS_REVIEW").slice(0,60).map(x=>({id:x.id,sourceId:x.sourceId,title:x.title,checkedAt:x.checkedAt||x.capturedAt,href:"/team/sources?sourceId="+encodeURIComponent(x.sourceId)}));
 const collections=safe(inputs?.watches).filter(w=>clean(w.sourceId)).map(w=>{
  const due=date(w.nextCheckAt),failed=!!w.failureCode,overdue=!!w.enabled&&due!==null&&due<nowMs-3600000;
  return {sourceId:w.sourceId,title:w.title||w.sourceId,status:failed?"failed":!w.enabled?"paused":w.active===false?"inactive":overdue?"overdue":!w.lastSuccessAt?"never-checked":"scheduled",
   failureCode:failed?String(w.failureCode):null,lastSuccessAt:w.lastSuccessAt||null,href:"/team/sources?sourceId="+encodeURIComponent(w.sourceId)};
 }).filter(x=>["failed","inactive","overdue","never-checked"].includes(x.status)).slice(0,60);
 const connectors=safe(inputs?.connectors).filter(c=>clean(c.id)).map(c=>({
  id:c.id,provider:clean(c.provider),target:clean(c.target),status:c.failureCode?"failed":!c.enabled?"paused":!c.lastSuccessAt?"never-verified":"recorded",
  lastSuccessAt:c.lastSuccessAt||null,href:"/team/operations?view=connections"
 })).filter(c=>["failed","never-verified"].includes(c.status)).slice(0,20);
 const tasks=safe(inputs?.tasks).filter(t=>clean(t.id)&&clean(t.title)&&t.status!=="COMPLETE"&&date(t.dueDate)!==null&&date(t.dueDate)<=soon)
  .sort((a,b)=>date(a.dueDate)-date(b.dueDate)).slice(0,100).map(t=>({
   id:t.id,title:t.title,owner:clean(t.ownerName)||"Unassigned",dueDate:t.dueDate,
   overdue:date(t.dueDate)<nowMs-86400000,status:t.status,href:"/team?taskId="+encodeURIComponent(t.id)
  }));
 return {format:"regpilot-operational-brief-v1",generatedAt:now,windowStart:new Date(weekAgo).toISOString(),windowEnd:now,
  summary:{changedPublications:changes.length,awaitingReview:pending.length,sourceCheckIssues:collections.length,connectorIssues:connectors.length,dueWork:tasks.length,overdueWork:tasks.filter(t=>t.overdue).length},
  changes,pending,collections,connectors,tasks,
  limitations:["A changed publication text is not necessarily a legal change.","A successful connection is not a compliance certification.","Only recorded, in-scope tenant data is included, with bounded history and task samples.","Tasks have recorded operational due dates, not legally established deadlines."]};
}
export function exportBriefCsv(brief){
 const header=["Type","Title","Status","Owner","Observed or due","Action URL"];
 const rows=[
  ...safe(brief.changes).map(x=>["Publication changed",x.title,x.status,"",x.detectedAt,x.href]),
  ...safe(brief.pending).map(x=>["Awaiting review",x.title,"NEEDS_REVIEW","",x.checkedAt,x.href]),
  ...safe(brief.collections).map(x=>["Source watch",x.title,x.status,"",x.lastSuccessAt,x.href]),
  ...safe(brief.connectors).map(x=>["Connector",x.provider+" "+x.target,x.status,"",x.lastSuccessAt,x.href]),
  ...safe(brief.tasks).map(x=>["Team task",x.title,x.status,x.owner,x.dueDate,x.href])
 ];
 return [header,...rows].map(r=>r.map(csv).join(",")).join("\r\n");
}
