"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {validateObligation} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {parseChangeReviews,CHANGE_REVIEW_KEY} from "../../lib/change-triage.mjs";
import {parseControls,CONTROL_KEY} from "../../lib/controls.mjs";
import type {ControlRecord} from "../../lib/controls.mjs";
import {ACTIVITY_KEY,validOperationalEvents} from "../../lib/operational-triage.mjs";
import {defaultWorkspace,parseWorkspace,WORKSPACE_KEY} from "../../lib/workspace-config.mjs";
import {assembleAssurance,printableAssurance,serializeAssurance} from "../../lib/assurance-pack.mjs";
import type {AssuranceFinding,AssuranceSnapshot} from "../../lib/assurance-pack.mjs";
import type {OperationalEvent} from "../../lib/operational-triage.mjs";
import type {ChangeReview} from "../../lib/change-triage.mjs";
import ui from "../workbench/workbench.module.css";
import css from "./assurance.module.css";
const ACTIONS_KEY="regpilot-demo-obligations-v1", DOCUMENTS_KEY="regpilot-document-library-v1";
type AppState={company:string;actions:any[];documents:any[];controls:ControlRecord[];reviews:ChangeReview[];events:OperationalEvent[];sources:any[];sourcesLoaded:boolean};
type View="findings"|"actions"|"documents"|"controls"|"decisions"|"activity";
const views:ReadonlyArray<{id:View;label:string}>= [
 {id:"findings",label:"Attention centre"},{id:"actions",label:"Evidence matrix"},{id:"documents",label:"Document checks"},
 {id:"controls",label:"Shared controls"},{id:"decisions",label:"Source decisions"},{id:"activity",label:"Local activity"}
];
const notes:Record<string,string>={"follow-up":"Follow up","review":"Review","organise":"Organise"};
const evidence:Record<string,string>={"evidence-linked":"Approved file metadata recorded","review-expired":"Linked review date expired",
 "attachment-unverified":"File not recorded","pending-review":"Awaiting review","missing":"No linked document"};
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function download(content:string,filename:string,type:string){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function loadLocal():Omit<AppState,"sources"|"sourcesLoaded">{
 const read=(key:string):unknown=>{try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return []}};
 const rawActions=read(ACTIONS_KEY);const rawDocs=read(DOCUMENTS_KEY);const rawEvents=read(ACTIVITY_KEY);
 let company="Demo workspace";
 try{const raw=localStorage.getItem(WORKSPACE_KEY);const parsed=raw?parseWorkspace(JSON.parse(raw)):defaultWorkspace();company=parsed?.company||company}catch{}
 return {company,
  actions:Array.isArray(rawActions)?rawActions.filter(validateObligation).slice(0,1000):[],
  documents:Array.isArray(rawDocs)?rawDocs.filter(validDocumentMetadata).slice(0,1000):[],
  controls:parseControls(localStorage.getItem(CONTROL_KEY)||"[]"),
  reviews:parseChangeReviews(localStorage.getItem(CHANGE_REVIEW_KEY)||"[]"),
  events:validOperationalEvents(rawEvents)?rawEvents:[]};
}
export default function Assurance(){
 const [state,setState]=useState<AppState>({company:"Demo workspace",actions:[],documents:[],controls:[],reviews:[],events:[],sources:[],sourcesLoaded:false});
 const [ready,setReady]=useState(false);
 const [loading,setLoading]=useState(false);
 const [sourceError,setSourceError]=useState("");
 const [message,setMessage]=useState("");
 const [view,setView]=useState<View>("findings");
 const [severity,setSeverity]=useState("all");
 const [query,setQuery]=useState("");
 const refresh=useCallback(()=>{
  setState(old=>({...old,...loadLocal()}));setReady(true);
 },[]);
 useEffect(()=>{refresh();window.addEventListener("focus",refresh);window.addEventListener("storage",refresh);return()=>{window.removeEventListener("focus",refresh);window.removeEventListener("storage",refresh)}},[refresh]);
 const fetchSources=useCallback(async()=>{
  setLoading(true);setSourceError("");
  try{
   const r=await fetch("/api/regulatory-sources",{cache:"no-store"});
   if(!r.ok)throw new Error("Official source check unavailable");
   const json:unknown=await r.json();
   if(!json||typeof json!=="object"||!("results" in json)||!Array.isArray(json.results))throw new Error("Invalid source result");
   const results=(json as {results:unknown[]}).results;
   setState(s=>({...s,sources:results,sourcesLoaded:true}));
  }catch{setSourceError("Official source check unavailable. Existing decisions are shown but source versions cannot be independently compared.");setState(s=>({...s,sources:[],sourcesLoaded:false}))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void fetchSources()},[fetchSources]);
 const snapshot=useMemo(()=>assembleAssurance(state,today()),[state]);
 const {summary}=snapshot;
 const visibleFindings=useMemo(()=>snapshot.findings.filter(f=>(severity==="all"||f.severity===severity)&&[f.title,f.kind,f.group,f.detail].join(" ").toLowerCase().includes(query.trim().toLowerCase())),[snapshot,query,severity]);
 function exportPack(kind:"json"|"html"){
  try{
   const filename="regpilot-demo-review-"+snapshot.reviewDate;
   if(kind==="html")download(printableAssurance(snapshot),filename+".html","text/html;charset=utf-8");
   else download(serializeAssurance(snapshot),filename+".json","application/json");
   setMessage("Review pack saved locally. It contains metadata only; file attachments, formal approvals and verified audit history are not included.");
  }catch{setMessage("Could not generate review pack.");}
 }
 function filterClick(label:string){setView("findings");setSeverity(label);setQuery("");}
 const score=summary.coveragePercent;
 return <div className={ui.app}>
  <aside className={ui.sidebar}>
   <a className={ui.logo} href="/workbench"><span className={ui.logoMark}>R</span><span>RegPilot <b>AI</b><small>INTELLIGENCE &amp; OPERATIONS</small></span></a>
   <div className={ui.sideCaption}>WORKSPACE</div>
   <nav className={ui.sideNav} aria-label="Navigation">
    <a href="/workbench">◉ &nbsp;Today's work</a><a href="/intelligence">✦ &nbsp;Regulatory intelligence</a>
    <a href="/controls">◇ &nbsp;Shared control library</a><a href="/traceability">✧ &nbsp;Traceability explorer</a><a href="/documents">▣ &nbsp;Documents &amp; evidence</a><a href="/evidence">◫ &nbsp;Evidence gaps</a>
    <a className={ui.active} href="/assurance" aria-current="page">◈ &nbsp;Review centre</a>
    <a href="/register">▤ &nbsp;Action register</a><a href="/departments">⚙ &nbsp;Business setup</a>
   </nav>
   <div className={ui.sideFoot}><strong>Review, don't assume.</strong><p>This report is designed for preparation and discussion, not a certification or audit opinion.</p></div>
  </aside>
  <main className={ui.main}>
   <div className={ui.topbar}><span className={ui.crumb}>Workspace / Evidence review</span><div className={ui.topActions}><span className={ui.demo}>DEMO ONLY</span><a href="/workbench" className={ui.profile}>Back to command centre</a></div></div>
   <header className={css.hero}>
    <div className={css.heroText}><span className={css.eyebrow}>REGPILOT / REVIEW CENTRE</span><h1>Every action.<br/><em>Accounted for.</em></h1><p>A clear, traceable view of tasks, document references, source decisions and the gaps that still need human attention.</p>
     <div className={css.tags}><span>✦ Owner accountability</span><span>◈ Evidence matrix</span><span>↗ Exportable review pack</span></div>
    </div>
    <div className={css.heroActions}>
     <span className={css.exportLabel}>EXPORT YOUR REVIEW</span>
     <button type="button" className={css.exportMain} onClick={()=>exportPack("html")} disabled={!ready}>Download printable report ↗</button>
     <button type="button" className={css.exportSecondary} onClick={()=>exportPack("json")} disabled={!ready}>Download structured JSON</button>
     <p>Both exports are local demonstration snapshots. They do not include actual file attachments.</p>
    </div>
   </header>
   <div className={ui.warning}><strong>Important distinction:</strong> This is an evidence-organisation report, not a compliance score, legal opinion or inspection certificate. Document approval and attachments are recorded as browser metadata, not independently verified. Use fictional or non-sensitive data only.</div>
   {sourceError&&<div className={css.sourceWarn} role="status">{sourceError}<button type="button" onClick={()=>void fetchSources()} disabled={loading}>Retry source check</button></div>}
   {message&&<div className={ui.feedback} role="status">{message}<button onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}
   <div className={css.kpis}>
    <button type="button" className={css.kpi} onClick={()=>filterClick("follow-up")}><span>NEEDS FOLLOW-UP</span><strong>{summary.followUp}</strong><small>Overdue work and unsupported completions</small></button>
    <button type="button" className={css.kpi} onClick={()=>filterClick("review")}><span>NEEDS REVIEW</span><strong>{summary.review}</strong><small>Evidence, documents and source decisions</small></button>
    <button type="button" className={css.kpi} onClick={()=>filterClick("organise")}><span>RECORDS TO ORGANISE</span><strong>{summary.organise}</strong><small>Documents not linked to a task</small></button>
    <div className={css.coverage}><span>RECORDED FILE COVERAGE</span><strong>{score===null?"—":score+"%"}</strong><small>{summary.confirmedAttachmentMetadata} of {summary.actions} work items with current approved attachment metadata</small></div>
   </div>
   <div className={css.controlBar}><div><span className={css.eyebrow}>LIVE WORKSPACE SNAPSHOT</span><h2>{state.company}</h2><p>{snapshot.reviewDate} · {summary.actions} actions · {summary.documents} documents · {summary.controls} controls · {summary.sourceDecisions} manual source decisions</p></div>
    <div className={css.refreshActions}><a className={css.softButton} style={{textDecoration:"none"}} href="/traceability">Explore traceability ↗</a><button className={css.softButton} type="button" onClick={()=>{refresh();setMessage("Local workspace refreshed.");}}>↻ Refresh workspace</button><button className={css.softButton} type="button" disabled={loading} onClick={()=>void fetchSources()}>{loading?"Checking…":"↻ Check official metadata"}</button></div>
   </div>
   <section className={css.reviewPanel} aria-label="Review workspace">
    <div className={css.tabStrip} role="group" aria-label="Review views">{views.map(t=><button type="button" key={t.id} className={view===t.id?css.tabActive:css.tab} onClick={()=>setView(t.id)}>{t.label}</button>)}</div>
    {view==="findings"&&<>
     <div className={css.panelHead}><div><h2>Items to resolve</h2><p>Ordered by follow-up, review and record organisation. These are heuristic signals, not risk ratings.</p></div><div className={css.filters}><input aria-label="Search findings" placeholder="Search findings…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Severity filter" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">All findings</option><option value="follow-up">Follow up</option><option value="review">Needs review</option><option value="organise">Organise</option></select></div></div>
     {!ready?<p className={css.empty}>Loading records…</p>:visibleFindings.length===0?<p className={css.empty}>No matching items in this view. This is not a declaration of compliance.</p>:
      <div className={css.issueList}>{visibleFindings.map((f:AssuranceFinding)=><article key={f.key} className={css.issue}>
       <span className={css.issueIcon+" "+(f.severity==="follow-up"?css.red:f.severity==="review"?css.purple:css.teal)}>{f.severity==="follow-up"?"!":f.severity==="review"?"◇":"↔"}</span>
       <div><div className={css.issueMeta}><span>{notes[f.severity]}</span><span>{f.group} · {f.kind}</span></div><h3>{f.title}</h3><p>{f.detail}</p></div>
       <a href={f.href}>Review item ↗</a>
      </article>)}</div>}
    </>}
    {view==="actions"&&<><div className={css.panelHead}><div><h2>Action-to-evidence matrix</h2><p>See status, ownership and recorded evidence together. All statuses are manually entered.</p></div><a className={css.textLink} href="/workbench">Manage tasks ↗</a></div>
     <div className={css.tableScroll}><table className={css.table}><thead><tr><th>Work item</th><th>Owner</th><th>Due</th><th>Progress</th><th>Evidence position</th><th></th></tr></thead><tbody>
      {snapshot.actions.length===0?<tr><td colSpan={6}>No work items have been recorded.</td></tr>:snapshot.actions.map(a=><tr key={a.id}><td><strong>{a.title}</strong><small>{a.regulator}</small></td><td>{a.owner}</td><td>{a.due}</td><td>{a.status}</td><td>{evidence[a.evidenceState]||a.evidenceState}{a.completionException?" · Completion exception":""}</td><td><a href={"/workbench?item="+encodeURIComponent(a.id)}>Open ↗</a></td></tr>)}
     </tbody></table></div>
    </>}
    {view==="documents"&&<><div className={css.panelHead}><div><h2>Document review position</h2><p>Review date, status, attachment flag and task links.</p></div><a className={css.textLink} href="/documents">Open documents ↗</a></div>
      <div className={css.tableScroll}><table className={css.table}><thead><tr><th>Document</th><th>Owner</th><th>Review date</th><th>Recorded status</th><th>File flag</th><th>Task link</th></tr></thead><tbody>
       {snapshot.documents.length===0?<tr><td colSpan={6}>No documents recorded.</td></tr>:snapshot.documents.map(d=><tr key={d.id}><td><strong>{d.title}</strong><small>{d.category} · v{d.version||"—"}</small></td><td>{d.owner||"Not assigned"}</td><td>{d.reviewDate||"Not set"}<small>{d.reviewState}</small></td><td>{d.status}</td><td>{d.hasAttachment?"Recorded":"Not recorded"}</td><td>{d.linked?"Linked":"Unlinked / missing"}</td></tr>)}
      </tbody></table></div>
    </>}
    {view==="controls"&&<><div className={css.panelHead}><div><h2>Shared control coverage</h2><p>Controls link multiple work items to a common record of evidence. Metadata alone does not prove effectiveness.</p></div><a className={css.textLink} href="/controls">Manage controls ↗</a></div>
      <div className={css.tableScroll}><table className={css.table}><thead><tr><th>Control</th><th>Owner</th><th>Recorded state</th><th>Task links</th><th>Document links</th><th>Evidence metadata</th></tr></thead><tbody>
       {snapshot.controls.length===0?<tr><td colSpan={6}>No shared controls recorded yet.</td></tr>:snapshot.controls.map(c=><tr key={c.id}><td><strong>{c.title}</strong><small>{c.frequency} · Review {c.reviewDate||"not scheduled"}</small></td><td>{c.owner}</td><td>{c.state}</td><td>{c.linkedActions}</td><td>{c.linkedDocuments}</td><td>{c.approvedFileMetadata} recorded approved files</td></tr>)}
      </tbody></table></div>
    </>}
    {view==="decisions"&&<><div className={css.panelHead}><div><h2>Manual regulatory decisions</h2><p>Recorded source-version decisions, not AI interpretations or a complete legislation register.</p></div><a className={css.textLink} href="/intelligence">Open intelligence ↗</a></div>
      {!state.sourcesLoaded&&<p className={css.warningTiny}>Official source metadata is unavailable; older decisions cannot be compared with current source versions.</p>}
      <div className={css.tableScroll}><table className={css.table}><thead><tr><th>Source / decision</th><th>Impact</th><th>Owner</th><th>Source version</th><th>Work item</th></tr></thead><tbody>
       {snapshot.sourceDecisions.length===0?<tr><td colSpan={5}>No manual source decisions recorded.</td></tr>:snapshot.sourceDecisions.map(r=><tr key={r.key}><td><strong>{r.sourceTitle||r.key}</strong><small>{r.status} · {r.notes}</small></td><td>{r.impact}</td><td>{r.owner||"—"}</td><td>{r.versionState==="not-checked"?"Not checked":r.versionState}</td><td>{r.actionId?"Linked action":"None linked"}</td></tr>)}
      </tbody></table></div>
    </>}
    {view==="activity"&&<><div className={css.panelHead}><div><h2>Local change history</h2><p>Useful context for a demo review. Not tamper-evident or an authenticated audit log.</p></div></div>
     <div className={css.activityList}>{snapshot.activity.length===0?<p className={css.empty}>No local activity records saved.</p>:snapshot.activity.map((e,i)=><div key={i}><strong>{e.action}</strong><span>{e.details}</span><small>{new Date(e.timestamp).toLocaleString("en-GB")}</small></div>)}</div>
    </>}
   </section>
   <section className={css.bottom}><div><span className={css.eyebrow}>WHAT THIS DOESN'T DO</span><h2>Evidence-aware, not audit-certified.</h2><p>Actual file verification, independent approvals, source text analysis, tenant access controls and a durable audit trail require the secure backend. The report is designed to make missing information visible, not hide uncertainty.</p></div><a href="/documents">Organise evidence ↗</a></section>
   <footer className={ui.footer}>RegPilot AI · Demonstration review centre · Downloaded reports are not compliance certifications or formal audit evidence.</footer>
  </main>
 </div>;
}
