import {reviewState} from "./document-review.mjs";

/** Demo-only evidence triage. Not a legal assessment or formal approval. */
export function evidenceCoverage(actions,documents,today,controls=[]){
 const safeActions=Array.isArray(actions)?actions:[];
 const safeDocuments=Array.isArray(documents)?documents:[];
 const activeControls=Array.isArray(controls)?controls.filter(c=>c&&c.status==="In operation"&&Array.isArray(c.actionIds)&&Array.isArray(c.documentIds)):[];
 return safeActions.filter(a=>a&&typeof a.id==="string"&&typeof a.title==="string").map(action=>{
  const reusedIds=new Set(activeControls.filter(c=>c.actionIds.includes(action.id)).flatMap(c=>c.documentIds));
  const linked=safeDocuments.filter(d=>d&&d.status!=="Archived"&&(d.obligationId===action.id||reusedIds.has(d.id)));
  const approved=linked.filter(d=>d.status==="Approved");
  const current=approved.filter(d=>reviewState(d,today)==="current"||reviewState(d,today)==="due-soon");
  const attached=current.filter(d=>d.hasAttachment===true);
  const state=attached.length?"evidence-linked":current.length?"attachment-unverified":approved.length?"review-expired":linked.length?"pending-review":"missing";
  return {id:action.id,title:action.title,owner:action.owner||"Unassigned",due:action.due||"",status:action.status||"Open",linked:linked.length,verifiedAttachments:attached.length,state};
 });
}
export function evidenceCoverageSummary(rows){
 return rows.reduce((out,row)=>{out.total++;out[row.state]=(out[row.state]||0)+1;return out;},{total:0});
}
