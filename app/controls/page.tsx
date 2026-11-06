"use client";
import {useEffect,useMemo,useState} from "react";
import {validateObligation} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {CONTROL_KEY,CONTROL_FREQUENCIES,CONTROL_STATUSES,parseControls,validControl,controlCoverage,controlSummary} from "../../lib/controls.mjs";
import type {ControlRecord} from "../../lib/controls.mjs";
import ui from "../workbench/workbench.module.css";
import css from "./controls.module.css";
const ACTIONS_KEY="regpilot-demo-obligations-v1",DOCS_KEY="regpilot-document-library-v1";
type Item={id:string;title:string;owner?:string;status?:string;reviewDate?:string};
function blank():ControlRecord{return {id:"",title:"",purpose:"",owner:"",status:"Designed",frequency:"Annual",reviewDate:"",actionIds:[],documentIds:[]};}
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
const desc:Record<string,string>={"retired":"Retired","review-overdue":"Review date passed","broken-links":"Missing linked record","evidence-unconfirmed":"Evidence not confirmed","metadata-linked":"Current linked metadata","needs-review":"Review needed"};
export default function Controls(){
 const [ready,setReady]=useState(false),[records,setRecords]=useState<ControlRecord[]>([]);
 const [actions,setActions]=useState<Item[]>([]),[documents,setDocuments]=useState<Item[]>([]);
 const [selectedId,setSelectedId]=useState(""),[draft,setDraft]=useState<ControlRecord>(blank());
 const [creating,setCreating]=useState(false),[message,setMessage]=useState(""),[query,setQuery]=useState("");
 const [tab,setTab]=useState("all");
 useEffect(()=>{
  try{setRecords(parseControls(localStorage.getItem(CONTROL_KEY)||"[]"));}catch{}
  try{const x:unknown=JSON.parse(localStorage.getItem(ACTIONS_KEY)||"[]");if(Array.isArray(x))setActions(x.filter(validateObligation).map(x=>({id:x.id,title:x.title,owner:x.owner,status:x.status})));}catch{}
  try{const x:unknown=JSON.parse(localStorage.getItem(DOCS_KEY)||"[]");if(Array.isArray(x))setDocuments(x.filter(validDocumentMetadata).map(x=>({id:x.id,title:x.title,status:x.status,reviewDate:x.reviewDate})));}catch{}
  setReady(true);
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(CONTROL_KEY,JSON.stringify(records))}catch{setMessage("Browser storage is full. Cannot save controls.")}},[ready,records]);
 useEffect(()=>{if(!creating){const item=records.find(x=>x.id===selectedId);if(item)setDraft({...item,actionIds:[...item.actionIds],documentIds:[...item.documentIds]});}},[creating,selectedId,records]);
 const rows=useMemo(()=>controlCoverage(records,actions,documents,today()),[records,actions,documents]);
 const stats=useMemo(()=>controlSummary(rows),[rows]);
 const visible=rows.filter(r=>(tab==="all"||r.state===tab)&&[r.title,r.owner,r.purpose].join(" ").toLowerCase().includes(query.toLowerCase()));
 const current=rows.find(x=>x.id===selectedId);
 function startCreate(){setCreating(true);setSelectedId("");setDraft(blank());setMessage("");}
 function select(id:string){setCreating(false);setSelectedId(id);setMessage("");}
 function toggle(field:"actionIds"|"documentIds",id:string){setDraft(r=>({...r,[field]:r[field].includes(id)?r[field].filter(x=>x!==id):[...r[field],id]}))}
 function save(e:React.FormEvent){
  e.preventDefault();const record={...draft,id:draft.id||crypto.randomUUID(),title:draft.title.trim(),owner:draft.owner.trim(),purpose:draft.purpose.trim()};
  if(!validControl(record)){setMessage("Check title, owner, review date, description and linked records.");return}
  if(!records.some(x=>x.id===record.id)&&records.length>=300){setMessage("Demo limit reached (300 controls).");return}
  setRecords(all=>all.some(x=>x.id===record.id)?all.map(x=>x.id===record.id?record:x):[record,...all]);
  setSelectedId(record.id);setCreating(false);setMessage("Control metadata saved in this browser. Effectiveness has not been tested or approved.");
 }
 function retire(){if(!current||!window.confirm("Retire this control? It will remain visible in the register."))return;setRecords(all=>all.map(x=>x.id===current.id?{...x,status:"Retired"}:x));setMessage("Control marked Retired. Existing document links remain for reference.");}
 return <div className={ui.app}>
  <aside className={ui.sidebar}>
   <a href="/workbench" className={ui.logo}><span className={ui.logoMark}>R</span><span>RegPilot <b>AI</b><small>COMPLIANCE OPERATIONS</small></span></a>
   <div className={ui.sideCaption}>WORKSPACE</div>
   <nav className={ui.sideNav} aria-label="Navigation">
    <a href="/workbench">◉ &nbsp;Today's work</a><a href="/intelligence">✦ &nbsp;Regulatory intelligence</a>
    <a className={ui.active} href="/controls" aria-current="page">◇ &nbsp;Shared control library</a>
    <a href="/assurance">◈ &nbsp;Review centre</a><a href="/documents">▣ &nbsp;Documents</a><a href="/register">▤ &nbsp;Action register</a>
    <a href="/departments">⚙ &nbsp;Business setup</a>
   </nav>
   <div className={ui.sideFoot}><strong>Control mapping pilot</strong><p>Links multiple work items and documents. This is not continuous monitoring or a control effectiveness test.</p></div>
  </aside>
  <main className={ui.main}>
   <div className={ui.topbar}><span className={ui.crumb}>Workspace / Shared controls</span><div className={ui.topActions}><span className={ui.demo}>LOCAL DEMO</span><a href="/assurance" className={ui.profile}>Open review centre</a></div></div>
   <header className={css.hero}><div><span className={css.overline}>CONTROL LIBRARY / CROSS-FUNCTIONAL EVIDENCE</span><h1>One control.<br/><em>Multiple obligations.</em></h1><p>Connect a single review activity to multiple work items and documents, so the same evidence doesn't have to be duplicated.</p></div><button className={css.new} type="button" onClick={startCreate}>＋ Create control</button></header>
   <div className={ui.warning}><strong>Demo only.</strong> Controls and relationships are browser-local metadata. A linked document is not proof of effectiveness, and no automated assessment or approval takes place.</div>
   {message&&<p role="status" className={css.message}>{message}</p>}
   <section className={css.stats}>
    <div><span>Controls recorded</span><strong>{stats.total}</strong></div>
    <div><span>Recorded as operating</span><strong>{stats.active}</strong></div>
    <div><span>Review dates overdue</span><strong>{stats.reviewOverdue}</strong></div>
    <div><span>Unconfirmed evidence / links</span><strong>{stats.missingEvidence}</strong></div>
   </section>
   <div className={css.grid}>
    <section className={css.list}>
     <div className={css.listHead}><div><h2>Control register</h2><p>{visible.length} of {records.length} records</p></div></div>
     <div className={css.filters}><input aria-label="Search controls" placeholder="Search controls…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Control state filter" value={tab} onChange={e=>setTab(e.target.value)}><option value="all">All statuses</option>{Object.entries(desc).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></div>
     {visible.length===0?<p className={css.empty}>{ready?"No controls in this view. Create a control to start mapping records.":"Loading controls…"}</p>:visible.map(r=><button type="button" key={r.id} onClick={()=>select(r.id)} className={css.control+" "+(selectedId===r.id&&!creating?css.selected:"")} aria-pressed={selectedId===r.id&&!creating}>
       <span className={css.small}>{r.status} · {r.frequency}</span><strong>{r.title}</strong><span className={css.dim}>{r.owner} · {r.linkedActions} actions · {r.linkedDocuments} documents</span>
       <span className={css.state}>{desc[r.state]||r.state}</span>
      </button>)}
    </section>
    <section className={css.editor}>
     {!creating&&!current?<div className={css.empty}><h2>Choose a control</h2><p>Select an existing control or create one. Links can be reused across work items and documents.</p></div>:<>
      <div className={css.editorHead}><div><span className={css.overline}>{creating?"NEW CONTROL":"CONTROL DETAILS"}</span><h2>{creating?"Create a control":current?.title}</h2><p>Record the owner, intended activity, review cycle and referenced evidence.</p></div>{!creating&&current?.status!=="Retired"&&<button className={css.retire} type="button" onClick={retire}>Retire</button>}</div>
      <form onSubmit={save} className={css.form}>
       <label>Control title *<input required maxLength={160} value={draft.title} onChange={e=>setDraft(x=>({...x,title:e.target.value}))} placeholder="e.g. Supplier qualification review"/></label>
       <label>Owner *<input required maxLength={80} value={draft.owner} onChange={e=>setDraft(x=>({...x,owner:e.target.value}))} placeholder="e.g. Quality lead"/></label>
       <label className={css.full}>What does this control do?<textarea rows={3} maxLength={500} value={draft.purpose} onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))} placeholder="Describe the activity and the evidence it should produce."/></label>
       <label>Recorded state<select value={draft.status} onChange={e=>setDraft(x=>({...x,status:e.target.value as ControlRecord["status"]}))}>{CONTROL_STATUSES.map(x=><option key={x}>{x}</option>)}</select></label>
       <label>Review frequency<select value={draft.frequency} onChange={e=>setDraft(x=>({...x,frequency:e.target.value as ControlRecord["frequency"]}))}>{CONTROL_FREQUENCIES.map(x=><option key={x}>{x}</option>)}</select></label>
       <label className={css.full}>Next review date<input type="date" value={draft.reviewDate} onChange={e=>setDraft(x=>({...x,reviewDate:e.target.value}))}/></label>
       <fieldset className={css.full}><legend>Related work items <span>({draft.actionIds.length} linked)</span></legend><p>Connect any number of tasks to the same control.</p>
        <div className={css.checks}>{actions.length?actions.map(a=><label key={a.id}><input type="checkbox" checked={draft.actionIds.includes(a.id)} onChange={()=>toggle("actionIds",a.id)}/><span>{a.title}</span></label>):<p>No work items yet. <a href="/workbench">Create a task</a>.</p>}</div>
       </fieldset>
       <fieldset className={css.full}><legend>Referenced evidence <span>({draft.documentIds.length} linked)</span></legend><p>The file metadata is referenced, not duplicated. A reviewer must determine suitability.</p>
        <div className={css.checks}>{documents.length?documents.map(d=><label key={d.id}><input type="checkbox" checked={draft.documentIds.includes(d.id)} onChange={()=>toggle("documentIds",d.id)}/><span>{d.title} <small>({d.status})</small></span></label>):<p>No documents recorded. <a href="/documents">Add a document</a>.</p>}</div>
       </fieldset>
       <div className={css.full}><button type="submit" className={css.save}>{creating?"Create control":"Save control"}</button></div>
      </form>
      {current&&!creating&&<div className={css.hint}><strong>Metadata-based review</strong><p>{current.notes.length?current.notes.join(" · "):"This control has no metadata gaps detected. This does not establish operating effectiveness."}</p><p>Current approved document file flags: {current.approvedFileMetadata}. Linked work items: {current.linkedActions}.</p></div>}
     </>}
    </section>
   </div>
   <footer className={ui.footer}>RegPilot AI · Local control mapping prototype · No secure team access, audit-grade approval or verified compliance determination.</footer>
  </main>
 </div>;
}
