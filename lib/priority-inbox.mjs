// A factual next-action queue for the authenticated operations workspace.
// No legal-risk scoring or inferred compliance verdicts: order by observable deadlines,
// declined/expired reviews and collection failures. Every item links to a human decision.
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value.slice(0, 10) + "T00:00:00Z")) ? value.slice(0, 10) : "";
const short = value => day(value) ? new Date(day(value) + "T12:00:00Z").toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}) : "date not recorded";
const safe = list => Array.isArray(list) ? list : [];
const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

export function priorityInbox(workspace, today = new Date().toISOString().slice(0,10)) {
 const org = encodeURIComponent(typeof workspace?.organizationId === "string" ? workspace.organizationId : "");
 const rows = [];
 const tasks = safe(workspace?.tasks);
 const sources = safe(workspace?.sourceImpact?.tasks);
 const reviewedTaskIds = new Set();
 const add = (id, kind, weight, title, detail, href, due = "") => {
  if (typeof title !== "string" || !title.trim()) return;
  rows.push({id,kind,weight,title:title.trim(),detail,href,due:day(due)});
 };
 for (const source of sources) {
  if (typeof source?.taskId !== "string" || typeof source?.title !== "string") continue;
  reviewedTaskIds.add(source.taskId);
  add("source:"+source.taskId,"Source changed",110,source.title,"A previously accepted requirement refers to an earlier source version. Reassess applicability before relying on the decision.","/team/intelligence");
 }
 for (const task of tasks) {
  if (typeof task?.id !== "string" || typeof task?.title !== "string" || !task.title.trim() || task.status === "COMPLETE") continue;
  const due = day(task.dueDate);
  const isOverdue = !!due && due < today;
  const isSoon = !!due && due <= new Date(Date.parse(today+"T00:00:00Z")+7*86400000).toISOString().slice(0,10);
  if (reviewedTaskIds.has(task.id)) continue;
  const prefix = task.connectorId ? "Evidence follow-up" : task.controlId ? "Control review" : "Team task";
  const detail = (isOverdue ? "Overdue since " : isSoon ? "Due " : "Due ") + short(due) + " · Owner: " + (task.ownerName || "Unassigned");
  add("task:"+task.id,isOverdue?"Overdue task":isSoon?"Due soon":prefix,isOverdue?100:isSoon?65:30,task.title,detail,"/team?taskId="+encodeURIComponent(task.id),due);
 }
 for (const connector of safe(workspace?.connectors)) {
  if (typeof connector?.id !== "string") continue;
  if (connector.failureCode) add("connector:"+connector.id,"Collection failed",96,"Investigate failed evidence collection","A connected source reported a collection failure. Previous observations cannot stand in for a fresh check.","/team/operations?view=connections");
  else if (connector.stale) add("connector:"+connector.id,"Observation stale",85,"Refresh connected evidence","The latest observation is stale or the provider is inactive. Review configuration and request collection if permitted.","/team/operations?view=connections");
 }
 for (const assessment of safe(workspace?.assessments)) {
  if (typeof assessment?.id !== "string") continue;
  const due=day(assessment.validUntil);
  add("assurance:"+assessment.id,due&&due<today?"Review expired":"Review due",due&&due<today?94:67,
    assessment.obligation?.title || "Evidence decision needs review",
    "Previously accepted evidence must be checked again by a reviewer · Review date "+short(due),
    "/team/assurance?organizationId="+org+"&taskId="+encodeURIComponent(assessment.obligationId || ""),due);
 }
 if(count(workspace?.summary?.evidencePending)) add("evidence","Evidence review",82,
  count(workspace.summary.evidencePending)+" clean file(s) await approval",
  "A separate reviewer must verify evidence before it can support accepted assessments.","/team/evidence");
 if(count(workspace?.summary?.monitoringAttention)) add("monitor","Monitoring",81,
  count(workspace.summary.monitoringAttention)+" scheduled source check(s) need attention",
  "Review missed or failed source-watch checks; an unavailable source is not evidence of no change.","/team/sources");
 if(count(workspace?.summary?.policyReading)) add("policy","My assigned policies",78,
  count(workspace.summary.policyReading)+" policy acknowledgement(s) outstanding",
  "Read the published version and record your own acknowledgement.","/team/people");
 if(count(workspace?.summary?.vendorReviewsDue)) add("vendor","Supplier review",73,
  count(workspace.summary.vendorReviewsDue)+" supplier review(s) due in seven days",
  "Check the current company register context, conditions and supporting evidence.","/team/vendors");
 rows.sort((a,b)=> b.weight-a.weight || (a.due||"9999").localeCompare(b.due||"9999") || a.id.localeCompare(b.id));
 return {items:rows,urgent:rows.filter(x=>x.weight>=80).length,unresolved:rows.length,
  shownTaskLimit:!!workspace?.taskLimitReached,generatedAt:workspace?.generatedAt||null};
}

export function firstRunSteps(workspace) {
 if (!workspace) return [];
 const steps=[];
 if (!safe(workspace.controls).length) steps.push({key:"controls",label:"Set up your first control",detail:"Name an owner, evidence expectations and review frequency.",tab:"controls"});
 if (!safe(workspace.evidence).length) steps.push({key:"evidence",label:"Add existing evidence",detail:"Upload a non-sensitive document to your private pilot vault.",href:"/team/evidence"});
 if (!safe(workspace.imports).length) steps.push({key:"programme",label:"Turn policies into a programme",detail:"Extract a proposed control list and independently review it.",tab:"programme"});
 if (!safe(workspace.connectors).length) steps.push({key:"connections",label:"Connect evidence sources",detail:"Choose a permitted read-only collector when services are enabled.",tab:"connections"});
 return steps;
}
