import {isValidDate} from "./obligations.mjs";
import {operationalQueue} from "./operational-triage.mjs";
import {reviewState} from "./document-review.mjs";
import {reviewKey,safeOfficialSource} from "./change-triage.mjs";
import {controlCoverage} from "./controls.mjs";

const severityRank={"follow-up":0,"review":1,"organise":2};
const str=value=>typeof value==="string"?value:"";
const esc=value=>str(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const link=value=>{try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password?value:""}catch{return ""}};
export const ASSURANCE_PACK_VERSION=1;

/** This is a demonstration record-coverage summary, not assurance, inspection readiness or a legal conclusion. */
export function assembleAssurance({company="",actions=[],documents=[],controls=[],reviews=[],sources=[],events=[]},today){
 if(!isValidDate(today))throw new Error("Invalid review date");
 const taskRows=operationalQueue(actions,documents,today,controls);
 const controlRows=controlCoverage(controls,actions,documents,today);
 const controlDocs=new Set(controlRows.filter(c=>c.status!=="Retired").flatMap(c=>c.documentIds));
 const ids=new Set(actions.map(a=>a.id));
 const docRows=documents.map(d=>{
  const state=d.status==="Archived"?"archived":reviewState(d,today);
  return {id:str(d.id),title:str(d.title),category:str(d.category),owner:str(d.owner),version:str(d.version),status:str(d.status),reviewDate:str(d.reviewDate),reviewState:state,
   obligationId:str(d.obligationId),linked:(!!d.obligationId&&ids.has(d.obligationId))||controlDocs.has(d.id),hasAttachment:d.hasAttachment===true};
 });
 const supportedSources=sources.filter(s=>safeOfficialSource(s)&&s.status==="available"&&(s.revisionAt||s.updatedAt));
 const reviewsOut=reviews.map(r=>{
  const s=supportedSources.find(x=>reviewKey(x)===r.key);
  const known=supportedSources.some(x=>r.key.startsWith(x.id+"::"));
  return {key:r.key,status:r.status,impact:r.impact,owner:r.owner,notes:r.notes,due:r.due,updatedAt:r.updatedAt,actionId:r.actionId||"",
    sourceTitle:s?.title||"",sourceUrl:link(s?.url||""),versionState:s?"current":known?"superseded":"not-checked"};
 });
 const findings=[];
 const add=(key,group,kind,title,detail,href,severity="review")=>findings.push({key,group,kind,title,detail,href,severity});
 for(const a of taskRows){
  if(a.completionException)add("exception:"+a.id,"Actions","Completion exception",a.title,
    a.completionRationale?"Completion rationale recorded, but evidence remains unconfirmed.":"Marked complete without current approved attachment metadata.","/workbench?item="+encodeURIComponent(a.id),"follow-up");
  if(a.status!=="Complete"&&a.daysRemaining!==null&&a.daysRemaining<0)add("overdue:"+a.id,"Actions","Overdue",a.title,"Owner: "+a.owner+" · Due "+a.due,"/workbench?item="+encodeURIComponent(a.id),"follow-up");
  if(a.status!=="Complete"&&a.state!=="evidence-linked")add("evidence:"+a.id,"Evidence","Evidence not confirmed",a.title,
    a.nextStep+" · Linked records: "+a.linked,"/documents?obligationId="+encodeURIComponent(a.id),"review");
 }
 for(const d of docRows){
  if(d.status!=="Archived"&&d.reviewState==="overdue")add("doc-review:"+d.id,"Documents","Document review overdue",d.title,
    "Review date "+(d.reviewDate||"not recorded")+" · Version "+(d.version||"unspecified"),"/documents","review");
  if(d.status==="Approved"&&!d.hasAttachment)add("doc-file:"+d.id,"Documents","File not recorded",d.title,
    "Marked Approved, but no file-attachment flag is recorded.","/documents","review");
  if(d.status!=="Archived"&&!d.linked&&!controlDocs.has(d.id))add("doc-link:"+d.id,"Documents","Record not linked to action",d.title,
    "Document has no valid linked task; this is an organisation signal, not necessarily a compliance gap.","/documents","organise");
 }
 for(const c of controlRows){
  if(c.state==="review-overdue")add("control-date:"+c.id,"Controls","Control review overdue",c.title,"Owner: "+c.owner+" · Due "+c.reviewDate,"/controls","review");
  else if(c.state==="broken-links")add("control-link:"+c.id,"Controls","Broken control links",c.title,"Some linked task or document records are missing.","/controls","review");
  else if(c.state==="evidence-unconfirmed")add("control-evidence:"+c.id,"Controls","Control evidence unconfirmed",c.title,"No current approved attached document metadata recorded.","/controls","review");
 }
 for(const r of reviewsOut){
  if(r.versionState==="superseded")add("source-old:"+r.key,"Regulatory intelligence","Previous source version",r.sourceTitle||r.key,
    "Earlier human decision needs re-review against the currently available source metadata.","/intelligence","review");
  if(r.status==="action-required"&&!r.actionId)add("source-task:"+r.key,"Regulatory intelligence","Action not created",r.sourceTitle||r.key,
    "Human review recorded action required, but no linked task was created.","/intelligence","review");
 }
 findings.sort((a,b)=>(severityRank[a.severity]??3)-(severityRank[b.severity]??3)||a.title.localeCompare(b.title));
 const relevant=taskRows.filter(a=>a.state==="evidence-linked").length;
 return {
  format:"regpilot-assurance-demo",version:ASSURANCE_PACK_VERSION,reviewDate:today,company:str(company).slice(0,120)||"Demo organisation",
  sourceCoverage:"Official-source comparison limited to the currently fetched GOV.UK catalogue; source data is not comprehensive.",
  generatedAt:new Date().toISOString(),
  summary:{
   actions:taskRows.length,documents:docRows.length,controls:controlRows.length,sourceDecisions:reviewsOut.length,sourceChecksAvailable:supportedSources.length,
   findings:findings.length,followUp:findings.filter(f=>f.severity==="follow-up").length,review:findings.filter(f=>f.severity==="review").length,organise:findings.filter(f=>f.severity==="organise").length,
   overdueActions:taskRows.filter(a=>a.status!=="Complete"&&a.daysRemaining!==null&&a.daysRemaining<0).length,
   completionExceptions:taskRows.filter(a=>a.completionException).length,confirmedAttachmentMetadata:relevant,
   coveragePercent:taskRows.length?Math.round(relevant/taskRows.length*100):null,
   unlinkedDocuments:docRows.filter(d=>d.status!=="Archived"&&!d.linked).length
  },
  actions:taskRows.map(a=>({id:a.id,title:a.title,owner:a.owner,due:a.due,status:a.status,regulator:a.regulator,notes:a.notes,sourceUrl:link(a.sourceUrl),sourceCheckedAt:a.sourceCheckedAt,
   evidenceState:a.state,linkedDocuments:a.linked,attachmentMetadata:a.verifiedAttachments,completionException:a.completionException,completionRationale:a.completionRationale,nextStep:a.nextStep})),
  documents:docRows,controls:controlRows.map(c=>({id:c.id,title:c.title,owner:c.owner,status:c.status,frequency:c.frequency,reviewDate:c.reviewDate,state:c.state,notes:c.notes,linkedActions:c.linkedActions,linkedDocuments:c.linkedDocuments,approvedFileMetadata:c.approvedFileMetadata})),sourceDecisions:reviewsOut,
  activity:events.slice(0,200).map(e=>({actionId:str(e.actionId),action:str(e.action),details:str(e.details),timestamp:str(e.timestamp)})),
  findings
 };
}

export function serializeAssurance(snapshot){
 if(!snapshot||snapshot.format!=="regpilot-assurance-demo"||snapshot.version!==ASSURANCE_PACK_VERSION)throw new Error("Unsupported report");
 return JSON.stringify(snapshot,null,2);
}

/** HTML export contains escaped text only; HTTPS source links are restricted to validated URLs. */
export function printableAssurance(snapshot){
 if(!snapshot||snapshot.format!=="regpilot-assurance-demo"||snapshot.version!==ASSURANCE_PACK_VERSION)throw new Error("Unsupported report");
 const s=snapshot.summary;
 const row=(cells)=>"<tr>"+cells.map(v=>"<td>"+esc(v)+"</td>").join("")+"</tr>";
 const table=(headers,rows)=>"<table><thead><tr>"+headers.map(h=>"<th>"+esc(h)+"</th>").join("")+"</tr></thead><tbody>"+(rows.length?rows.join(""):'<tr><td colspan="'+headers.length+'">No records in this section</td></tr>')+"</tbody></table>";
 const findings=table(["Attention","Type","Record","Reason"],snapshot.findings.map(f=>row([f.severity,f.kind,f.title,f.detail])));
 const tasks=table(["Action","Owner","Due","Status","Evidence metadata","Next step"],snapshot.actions.map(a=>row([a.title,a.owner,a.due,a.status,a.evidenceState,a.nextStep])));
 const docs=table(["Document","Category","Owner","Status","Review","File metadata","Linked action"],snapshot.documents.map(d=>row([d.title,d.category,d.owner,d.status,d.reviewState,d.hasAttachment?"Recorded":"Not recorded",d.linked?"Yes":"No"])));
 const controls=table(["Control","Owner","State","Action links","Document links","Recorded approved files"],(snapshot.controls||[]).map(c=>row([c.title,c.owner,c.state,String(c.linkedActions),String(c.linkedDocuments),String(c.approvedFileMetadata)])));
 const changes=table(["Source decision","Impact","Owner","Status","Source version"],snapshot.sourceDecisions.map(r=>row([r.sourceTitle||r.key,r.impact,r.owner,r.status,r.versionState])));
 const foot="<p class='foot'>Report generated from a single browser workspace. No actual attached files, signatures, evidence hashes, data protection attestation or formal approval records are included. This is not an inspection certificate, audit opinion or legal compliance determination.</p>";
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RegPilot — demo review pack</title><style>'
 +'body{font:14px/1.6 Arial,sans-serif;color:#1c2540;max-width:1140px;margin:auto;padding:34px;background:#fff}header{border-bottom:3px solid #6752ce;padding-bottom:20px;margin-bottom:25px}.badge{color:#654fc1;font-weight:800;letter-spacing:1px;font-size:11px}h1{font-size:31px;margin:6px 0}h2{margin:28px 0 12px;font-size:20px}p{max-width:820px}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metric{padding:14px;border:1px solid #ddd7f1;border-radius:10px;min-width:110px}.metric strong{font-size:23px;display:block}.metric span{font-size:11px;color:#69708a}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e8eaf0;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f3f0fc;color:#4d4193}.notice{padding:13px 16px;background:#fff8ea;border:1px solid #f1dab0}.foot{margin-top:25px;color:#66728a;font-size:12px}@media print{body{padding:0}table{page-break-inside:auto}tr{page-break-inside:avoid}}'
 +'</style></head><body><header><div class="badge">REGPILOT AI / DEMONSTRATION REVIEW PACK</div><h1>'+esc(snapshot.company)+'</h1><p>Snapshot date: '+esc(snapshot.reviewDate)+' · Generated: '+esc(snapshot.generatedAt)+'</p></header>'
 +'<p class="notice"><strong>Not a compliance verdict.</strong> Indicators represent browser-local task and document metadata only. '+esc(snapshot.sourceCoverage)+'</p>'
 +'<div class="metrics">'+[["Actions",s.actions],["Documents",s.documents],["Follow-ups",s.followUp],["Review items",s.review],["Organisation items",s.organise]].map(([label,value])=>'<div class="metric"><strong>'+esc(String(value))+'</strong><span>'+esc(label)+'</span></div>').join("")+'</div>'
 +'<h2>Review findings</h2>'+findings+'<h2>Work items</h2>'+tasks+'<h2>Document register</h2>'+docs+'<h2>Shared control matrix</h2>'+controls+'<h2>Regulatory source decisions</h2>'+changes+foot+'</body></html>';
}
