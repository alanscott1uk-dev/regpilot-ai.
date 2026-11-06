import {isValidDate,csvEscape} from "./obligations.mjs";
import {reviewState} from "./document-review.mjs";
import {safeOfficialSource,reviewKey} from "./change-triage.mjs";

const DAY=86_400_000;
const diffDays=(today,date)=>Math.round((Date.parse(today+"T00:00:00Z")-Date.parse(date+"T00:00:00Z"))/DAY);
const priority={critical:0,review:1,organise:2};
const issue=(code,severity,title,detail,href)=>({code,severity,title,detail,href});
const val=v=>typeof v==="string"?v:"";
const isVerifiedRecord=(d,today)=>d?.status==="Approved"&&d?.hasAttachment===true&&["current","due-soon"].includes(reviewState(d,today));
const externalUrl=url=>{try{const u=new URL(url);return u.protocol==="https:"&&!u.username&&!u.password&&u.href.length<=500?u.href:""}catch{return ""}};

/** Demo-only traceability: source links and document states are user-provided metadata, never evidence of legal compliance. */
export function buildTraceabilityGraph({actions=[],controls=[],documents=[],reviews=[],sources=[]},today){
 if(!isValidDate(today))throw new Error("Invalid review date");
 const safeActions=Array.isArray(actions)?actions.filter(a=>a&&typeof a.id==="string"&&typeof a.title==="string"):[];
 const safeDocs=Array.isArray(documents)?documents.filter(d=>d&&typeof d.id==="string"&&typeof d.title==="string"):[];
 const safeControls=Array.isArray(controls)?controls.filter(c=>c&&typeof c.id==="string"&&Array.isArray(c.actionIds)&&Array.isArray(c.documentIds)):[];
 const safeReviews=Array.isArray(reviews)?reviews:[];
 const safeSources=Array.isArray(sources)?sources.filter(s=>safeOfficialSource(s)&&s.status==="available"&&(s.revisionAt||s.updatedAt)):[];
 const documentMap=new Map(safeDocs.map(d=>[d.id,d]));
 const actionIds=new Set(safeActions.map(a=>a.id));
 const issues=[];
 const rows=safeActions.map(action=>{
  const href="/workbench?item="+encodeURIComponent(action.id);
  const linkedControls=safeControls.filter(c=>c.status!=="Retired"&&c.actionIds.includes(action.id));
  const operating=linkedControls.filter(c=>c.status==="In operation");
  const direct=safeDocs.filter(d=>d.status!=="Archived"&&d.obligationId===action.id);
  const ids=new Set(operating.flatMap(c=>c.documentIds));
  const linked=[...new Map([...direct,...safeDocs.filter(d=>ids.has(d.id)&&d.status!=="Archived")].map(d=>[d.id,d])).values()];
  const sourceUrl=externalUrl(action.sourceUrl||"");
  const checked=val(action.sourceCheckedAt);
  const sourceState=!sourceUrl?"not-recorded":!isValidDate(checked)?"date-not-recorded":diffDays(today,checked)<0?"future-check-date":diffDays(today,checked)>90?"check-over-90-days":"user-recorded";
  const decisions=safeReviews.filter(r=>r?.actionId===action.id).map(r=>{
   const source=safeSources.find(s=>reviewKey(s)===r.key);
   const known=safeSources.some(s=>r.key?.startsWith(s.id+"::"));
   return {key:val(r.key),status:val(r.status),updatedAt:val(r.updatedAt),version:source?"current-metadata":known?"newer-source-metadata":"not-checkable"};
  });
  const evidence=linked.map(d=>{
   const directLink=d.obligationId===action.id;
   const via=operating.filter(c=>c.documentIds.includes(d.id)).map(c=>({id:c.id,title:val(c.title)}));
   return {id:d.id,title:val(d.title),status:val(d.status),reviewDate:val(d.reviewDate),reviewState:reviewState(d,today),
    hasAttachment:d.hasAttachment===true,recordedCurrent:isVerifiedRecord(d,today),
    linkMethod:directLink&&via.length?"Direct + shared control":directLink?"Direct":"Shared control",
    controlNames:via.map(c=>c.title)};
  });
  const currentFiles=evidence.filter(d=>d.recordedCurrent);
  const gaps=[];
  if(!sourceUrl)gaps.push(issue("no-source","organise","No source reference recorded","This may be an internal task. Add a source only when one is relevant.",href));
  else if(sourceState==="date-not-recorded")gaps.push(issue("source-date","review","Source-check date absent","Record when someone last checked the reference; this does not verify the law.",href));
  else if(sourceState==="future-check-date")gaps.push(issue("source-future","review","Source check date is in the future","Check the entered date before relying on its review history.",href));
  else if(sourceState==="check-over-90-days")gaps.push(issue("source-age","review","Source-check record is over 90 days old","Revisit the original reference and record the result. This is not evidence that the law changed.",href));
  if(!linkedControls.length)gaps.push(issue("no-control","organise","No shared control mapped","You can associate a control when this task forms part of a repeatable process.","/controls"));
  else if(!operating.length)gaps.push(issue("no-operating-control","review","No mapped control recorded as operating","Only controls recorded as in operation can supply reusable evidence metadata.","/controls"));
  if(!evidence.length)gaps.push(issue("no-evidence","review","No supporting document linked","Connect a supporting record directly or through an operating shared control.","/documents?obligationId="+encodeURIComponent(action.id)));
  else {
   if(!currentFiles.length)gaps.push(issue("no-current-file","review","No current approved attachment recorded","Linked records are insufficiently reviewed, expired or lack an attachment flag.","/documents?obligationId="+encodeURIComponent(action.id)));
   if(evidence.some(d=>d.reviewState==="overdue"))gaps.push(issue("expired-file","review","Linked document review date has passed","The previous review date is past; check the document with its owner.","/documents"));
   if(evidence.some(d=>d.reviewState==="unscheduled"))gaps.push(issue("unscheduled-file","organise","A linked document has no review date","Record a date if the document requires periodic review.","/documents"));
  }
  if(action.status==="Complete"&&!currentFiles.length)gaps.push(issue("unsupported-completion","critical","Completed task lacks current supporting file metadata","Review the recorded completion or document an authorised exception. No legal conclusion is implied.",href));
  if(action.status!=="Complete"&&isValidDate(action.due)&&action.due<today)gaps.push(issue("overdue-action","critical","Action is overdue","Responsible owner: "+val(action.owner)+". Review the due date and next step.",href));
  for(const decision of decisions){if(decision.version==="newer-source-metadata")gaps.push(issue("changed-source-metadata","review","Linked source metadata has a newer version","Reassess the previous human decision. A metadata change is not necessarily a legal change.","/intelligence"));}
  const row={id:action.id,title:val(action.title),owner:val(action.owner),due:val(action.due),status:val(action.status),
   regulator:val(action.regulator),source:{url:sourceUrl,checkedAt:checked,state:sourceState},
   controls:linkedControls.map(c=>({id:c.id,title:val(c.title),status:val(c.status),reviewDate:val(c.reviewDate)})),
   evidence,decisions,links:{controls:linkedControls.length,documents:evidence.length,currentFileMetadata:currentFiles.length},
   gaps:gaps.sort((a,b)=>priority[a.severity]-priority[b.severity]),attention:gaps.some(g=>g.severity==="critical")?"follow-up":gaps.some(g=>g.severity==="review")?"review":gaps.length?"organise":"no-metadata-gaps"};
  for(const gap of row.gaps)issues.push({...gap,actionId:row.id,actionTitle:row.title});
  return row;
 });
 const integrity=[];
 const push=(code,title,detail,href)=>integrity.push({code,title,detail,href});
 const duplicate=(items,name)=>{const seen=new Set();for(const x of items){if(seen.has(x.id))push("duplicate-"+name,"Duplicate "+name+" identifier",val(x.id),"/assurance");seen.add(x.id)}};
 duplicate(safeActions,"action");duplicate(safeDocs,"document");duplicate(safeControls,"control");
 for(const control of safeControls.filter(c=>c.status!=="Retired")){
  const missingActions=control.actionIds.filter(id=>!actionIds.has(id));
  const missingDocs=control.documentIds.filter(id=>!documentMap.has(id));
  if(missingActions.length||missingDocs.length)push("broken-control","Broken control links",val(control.title)+" · "+missingActions.length+" missing actions, "+missingDocs.length+" missing documents","/controls");
 }
 for(const r of safeReviews){
  if(r?.actionId&&!actionIds.has(r.actionId))push("orphan-review-action","Regulatory decision linked to missing task",val(r.key),"/intelligence");
  if(r?.actionId&&r.status==="not-applicable")push("conflicting-review-decision","Source decision and linked action conflict",val(r.key)+" is marked not applicable but has a linked task","/intelligence");
 }
 for(const doc of safeDocs.filter(d=>d.status!=="Archived"&&d.obligationId&&!actionIds.has(d.obligationId))){
  push("orphan-document","Document linked to missing task",val(doc.title),"/documents");
 }
 issues.sort((a,b)=>priority[a.severity]-priority[b.severity]||a.actionTitle.localeCompare(b.actionTitle));
 const summary={
  actions:rows.length,linkedSources:rows.filter(x=>x.source.url).length,
  mappedControls:rows.filter(x=>x.controls.length>0).length,
  withCurrentFileMetadata:rows.filter(x=>x.links.currentFileMetadata>0).length,
  critical:rows.filter(x=>x.attention==="follow-up").length,
  review:rows.filter(x=>x.attention==="review").length,
  organise:rows.filter(x=>x.attention==="organise").length,
  metadataIssues:issues.length,integrityIssues:integrity.length
 };
 return {format:"regpilot-traceability-demo",version:1,reviewDate:today,summary,rows,issues,integrity,
  disclaimer:"Traceability is based on browser-local metadata. Links do not prove source authenticity, regulatory applicability, control effectiveness, document contents or legal compliance."};
}
export function exportTraceabilityCsv(graph){
 if(graph?.format!=="regpilot-traceability-demo"||!Array.isArray(graph.rows))throw new Error("Invalid graph");
 const header=["Task","Owner","Due","Status","Recorded source","Source check state","Mapped controls","Documents","Current approved attachment flags","Attention","Flags"];
 const data=graph.rows.map(r=>[r.title,r.owner,r.due,r.status,r.source.url,r.source.state,r.controls.map(c=>c.title).join("; "),r.evidence.map(d=>d.title).join("; "),r.links.currentFileMetadata,r.attention,r.gaps.map(g=>g.title).join("; ")]);
 return [header,...data].map(a=>a.map(csvEscape).join(",")).join("\r\n");
}
