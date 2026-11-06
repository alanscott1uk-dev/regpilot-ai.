import {isValidDate,csvEscape} from "./obligations.mjs";
import {evidenceCoverage} from "./evidence-coverage.mjs";

/** Prioritisation only: not a determination of legal compliance, risk or evidence quality. */
export function operationalQueue(actions,documents,today,controls=[]) {
 const rows=evidenceCoverage(actions,documents,today,controls);
 return rows.map(row=>{
  const a=actions.find(x=>x.id===row.id);
  const due=isValidDate(a.due)&&isValidDate(today)?Math.round((Date.parse(a.due+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000):null;
  const closed=a.status==="Complete";
  const rationale=typeof a.completionRationale==="string"&&a.completionRationale.trim().length>=20;
  const exception=closed&&row.state!=="evidence-linked";
  const missingSource=!a.sourceUrl;
  let priority=0;
  if(!closed && due!==null && due<0) priority+=100;
  else if(!closed && due!==null && due<=7) priority+=70;
  else if(!closed && due!==null && due<=30) priority+=30;
  if(row.state==="missing")priority+=25;
  if(row.state==="review-expired")priority+=25;
  if(row.state==="attachment-unverified")priority+=20;
  if(row.state==="pending-review")priority+=12;
  if(exception)priority+=80;
  if(closed&&!exception)priority=-100;
  const nextStep=exception ? (rationale?"Review the documented completion exception":"Reopen and attach current supporting evidence or record an exception") :
   closed?"No action currently flagged in this demo":
   row.state==="missing"?"Link a supporting record to this action":
   row.state==="pending-review"?"Review the linked draft before relying on it":
   row.state==="review-expired"?"Recheck the linked document and update its review date":
   row.state==="attachment-unverified"?"Attach the referenced file and confirm its record":
   due!==null&&due<0?"Review the overdue task and agree the next step":
   "Review the action with its owner";
  const level=exception?"exception":!closed&&due!==null&&due<0?"overdue":
   !closed&&due!==null&&due<=7?"soon":closed?"complete":
   row.state==="missing"||row.state==="review-expired"?"evidence":"routine";
  return {...row,notes:a.notes||"",regulator:a.regulator||"Internal",sourceUrl:a.sourceUrl||"",sourceCheckedAt:a.sourceCheckedAt||"",completionRationale:a.completionRationale||"",daysRemaining:due,priority,nextStep,level,completionException:exception};
 }).sort((a,b)=>b.priority-a.priority||(a.due||"").localeCompare(b.due||""));
}
export function operationsSummary(rows) {
 return {total:rows.length,overdue:rows.filter(x=>x.level==="overdue").length,dueSoon:rows.filter(x=>x.level==="soon").length,exceptions:rows.filter(x=>x.completionException).length,needsEvidence:rows.filter(x=>x.status!=="Complete"&&x.state!=="evidence-linked").length,completed:rows.filter(x=>x.status==="Complete").length,needsAttention:rows.filter(x=>x.level!=="complete"&&x.level!=="routine").length};
}
export function exportOperationsCsv(rows) {
 const keys=["Title","Category","Owner","Due","Status","Triage","Evidence","Next step","Source link","Source checked","Completion exception"];
 const values=rows.map(r=>[r.title,r.regulator,r.owner,r.due,r.status,r.level,r.state,r.nextStep,r.sourceUrl,r.sourceCheckedAt,r.completionException?"Yes":"No"]);
 return [keys,...values].map(row=>row.map(csvEscape).join(",")).join("\r\n");
}
export const ACTIVITY_KEY="regpilot-demo-operational-events-v1";
export function addOperationalEvent(events,actionId,action,details,time=new Date().toISOString()) {
 const source=Array.isArray(events)?events:[];
 return [{id:globalThis.crypto?.randomUUID?.()||time+"-"+source.length,actionId:String(actionId).slice(0,80),action:String(action).slice(0,80),details:String(details).slice(0,240),timestamp:time},...source].slice(0,200);
}
export function validOperationalEvents(events) {
 return Array.isArray(events)&&events.length<=200&&events.every(e=>e&&typeof e.id==="string"&&typeof e.actionId==="string"&&typeof e.action==="string"&&typeof e.details==="string"&&typeof e.timestamp==="string"&&e.id.length<=120&&e.actionId.length<=80&&e.action.length<=80&&e.details.length<=240&&!Number.isNaN(Date.parse(e.timestamp)));
}
