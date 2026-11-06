"use client";
import {useEffect,useMemo,useState} from "react";
import {validateObligation,isValidDate} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {WORKSPACE_KEY,defaultWorkspace,parseWorkspace} from "../../lib/workspace-config.mjs";
import {operationalQueue,operationsSummary,exportOperationsCsv,ACTIVITY_KEY,addOperationalEvent,validOperationalEvents} from "../../lib/operational-triage.mjs";
import type {TriageRow,OperationalEvent} from "../../lib/operational-triage.mjs";
import ui from "./workbench.module.css";
type Status="Open"|"In progress"|"Complete";
type Action={id:string;title:string;regulator:string;owner:string;due:string;status:Status;notes:string;sourceUrl?:string;sourceCheckedAt?:string;completionRationale?:string};
type Draft={status:Status;owner:string;due:string;notes:string;sourceUrl:string;sourceCheckedAt:string;completionRationale:string};
const ACTIONS_KEY="regpilot-demo-obligations-v1";
const DOCUMENTS_KEY="regpilot-document-library-v1";
const sample:Action[]=[
 {id:"sample-1",title:"Review training records",regulator:"Internal",owner:"Quality lead",due:"2026-11-15",status:"Open",notes:"Fictional example, not a legal requirement"},
 {id:"sample-2",title:"Review supplier qualification procedure",regulator:"Internal",owner:"Operations lead",due:"2026-12-01",status:"In progress",notes:"Fictional example, not a legal requirement"}
];
const blank:Draft={status:"Open",owner:"",due:"",notes:"",sourceUrl:"",sourceCheckedAt:"",completionRationale:""};
const templates:Record<string,{title:string;regulator:string;notes:string}>={
 custom:{title:"",regulator:"Internal",notes:""},
 supplier:{title:"Review supplier onboarding evidence",regulator:"Suppliers",notes:"Confirm named owner, evidence needed and next review date. Template only; review applicable requirements."},
 training:{title:"Confirm staff training records are current",regulator:"Training",notes:"Identify required training, review records and document follow-up actions. Template only."},
 change:{title:"Assess a reported regulatory change",regulator:"Regulatory intelligence",notes:"Record primary source, applicability, review owner, business impact and required actions. Template only."},
 inspection:{title:"Prepare the next internal compliance review",regulator:"Internal audit",notes:"Identify review scope, supporting evidence, findings and corrective actions. Template only."}
};
function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function shortDate(s:string){if(!isValidDate(s))return "No date";return new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}
function safeSource(url:string){try{const p=new URL(url);return p.protocol==="https:"&&p.username===""&&p.password===""&&url.length<=500}catch{return false}}
const tone:Record<string,string>={exception:"Needs review",overdue:"Overdue",soon:"Due this week",evidence:"Evidence gap",routine:"On track",complete:"Recorded complete"};
function saveDownload(content:string,name:string,type:string){const link=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");a.href=link;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(link),1000);}
export default function Workbench(){
 const [ready,setReady]=useState(false);
 const [items,setItems]=useState<Action[]>([]);
 const [documents,setDocuments]=useState<unknown[]>([]);
 const [events,setEvents]=useState<OperationalEvent[]>([]);
 const [company,setCompany]=useState("Demo workspace");
 const [selectedId,setSelectedId]=useState("");
 const [draft,setDraft]=useState<Draft>(blank);
 const [filter,setFilter]=useState("priority");
 const [search,setSearch]=useState("");
 const [showCreate,setShowCreate]=useState(false);
 const [chosenTemplate,setChosenTemplate]=useState("custom");
 const [newAction,setNewAction]=useState({title:"",regulator:"Internal",owner:"",due:"",notes:""});
 const [message,setMessage]=useState("");
 const [showActivity,setShowActivity]=useState(false);
 useEffect(()=>{
  try{const raw=localStorage.getItem(ACTIONS_KEY);if(raw){const x:unknown=JSON.parse(raw);setItems(Array.isArray(x)?x.filter(validateObligation) as Action[]:sample);}else setItems(sample);}catch{setItems(sample);}
  try{const raw=localStorage.getItem(ACTIVITY_KEY);if(raw){const x:unknown=JSON.parse(raw);if(validOperationalEvents(x))setEvents(x);}}catch{}
  setReady(true);
  function refreshLinked(){
   try{const v=JSON.parse(localStorage.getItem(DOCUMENTS_KEY)||"[]");setDocuments(Array.isArray(v)?v.filter(validDocumentMetadata):[]);}catch{setDocuments([]);}
   try{const raw=localStorage.getItem(WORKSPACE_KEY);const v=raw?parseWorkspace(JSON.parse(raw)):defaultWorkspace();setCompany(v?.company||"Demo workspace");}catch{setCompany("Demo workspace");}
  }
  refreshLinked();
  window.addEventListener("focus",refreshLinked);window.addEventListener("storage",refreshLinked);
  return()=>{window.removeEventListener("focus",refreshLinked);window.removeEventListener("storage",refreshLinked)};
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(ACTIONS_KEY,JSON.stringify(items));}catch{setMessage("Browser storage is full; export your register immediately.");}},[items,ready]);
 useEffect(()=>{if(ready)try{localStorage.setItem(ACTIVITY_KEY,JSON.stringify(events));}catch{setMessage("Unable to save local history.");}},[events,ready]);
 useEffect(()=>{if(!selectedId&&items.length)setSelectedId(items[0].id);},[items,selectedId]);
 useEffect(()=>{
  const selected=items.find(x=>x.id===selectedId);
  if(selected)setDraft({status:selected.status,owner:selected.owner,due:selected.due,notes:selected.notes,sourceUrl:selected.sourceUrl||"",sourceCheckedAt:selected.sourceCheckedAt||"",completionRationale:selected.completionRationale||""});
 },[selectedId,items]);
 const today=localDate();
 const queue=useMemo(()=>operationalQueue(items,documents,today),[items,documents,today]);
 const stats=useMemo(()=>operationsSummary(queue),[queue]);
 const visible=useMemo(()=>queue.filter(x=>
  (filter==="all"||(filter==="priority"&&x.status!=="Complete"&&(x.level!=="routine"||x.state!=="evidence-linked"))||(filter==="week"&&x.status!=="Complete"&&x.daysRemaining!==null&&x.daysRemaining<=7)||(filter==="exceptions"&&x.completionException)||(filter==="complete"&&x.status==="Complete"))&&
  [x.title,x.owner,x.regulator].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[queue,filter,search]);
 const selected=queue.find(x=>x.id===selectedId);
 const selectedAction=items.find(x=>x.id===selectedId);
 function record(id:string,verb:string,details:string){setEvents(e=>addOperationalEvent(e,id,verb,details));}
 function chooseTemplate(key:string){const t=templates[key]||templates.custom;setChosenTemplate(key);setNewAction(x=>({...x,title:t.title,regulator:t.regulator,notes:t.notes}));}
 function create(e:React.FormEvent){
  e.preventDefault();const action:Action={id:crypto.randomUUID(),title:newAction.title.trim(),regulator:newAction.regulator.trim()||"Internal",owner:newAction.owner.trim(),due:newAction.due,status:"Open",notes:newAction.notes.trim()};
  if(!validateObligation(action)){setMessage("Check the title, owner, date and notes before saving.");return;}
  setItems(prev=>[action,...prev]);record(action.id,"Created",action.title);setSelectedId(action.id);setNewAction({title:"",regulator:"Internal",owner:"",due:"",notes:""});setChosenTemplate("custom");setShowCreate(false);setMessage("Action created. Next, link its supporting evidence.");
 }
 function update(e:React.FormEvent){
  e.preventDefault();if(!selectedAction||!selected)return;
  const amended:Action={...selectedAction,status:draft.status,owner:draft.owner.trim(),due:draft.due,notes:draft.notes.trim(),sourceUrl:draft.sourceUrl.trim(),sourceCheckedAt:draft.sourceCheckedAt,completionRationale:draft.completionRationale.trim()};
  if(amended.sourceUrl&&!safeSource(amended.sourceUrl)){setMessage("Source URL must be a valid HTTPS link.");return;}
  if(amended.sourceCheckedAt&&!amended.sourceUrl){setMessage("Add a source link before recording a source-check date.");return;}
  if(amended.status==="Complete"&&selected.state!=="evidence-linked"&&(amended.completionRationale||"").length<20){setMessage("This action has no current approved file recorded. To mark complete, record an exception rationale of at least 20 characters, or add evidence first.");return;}
  if(!validateObligation(amended)){setMessage("Review the owner, dates and field lengths.");return;}
  setItems(prev=>prev.map(x=>x.id===amended.id?amended:x));
  record(amended.id,"Updated",selectedAction.status!==amended.status?selectedAction.status+" → "+amended.status:"Owner, notes or source reviewed");
  setMessage("Saved in this browser. No formal sign-off or regulatory review has taken place.");
 }
 function csv(){saveDownload(exportOperationsCsv(queue),"regpilot-work-queue.csv","text/csv;charset=utf-8");setMessage("Work queue exported as CSV.");}
 function makeBackup(){saveDownload(JSON.stringify({format:"regpilot-workbench-demo",exportedAt:new Date().toISOString(),actions:items,events},null,2),"regpilot-demo-workbench-backup.json","application/json");setMessage("Local demonstration backup exported. Document file attachments are not included.");}
 return <div className={ui.app}>
  <aside className={ui.sidebar}>
   <a href="/workbench" className={ui.logo}><span className={ui.logoMark}>R</span><span>RegPilot <b>AI</b><small>COMPLIANCE OPERATIONS</small></span></a>
   <div className={ui.sideCaption}>WORKSPACE</div>
   <nav className={ui.sideNav} aria-label="Main navigation">
    <a className={ui.active} aria-current="page" href="/workbench">◉ &nbsp;Today&apos;s work</a>
    <a href="/register">▤ &nbsp;Action register</a>
    <a href="/documents">▣ &nbsp;Documents &amp; evidence</a>
    <a href="/evidence">◫ &nbsp;Evidence gaps</a>
    <a href="/regulatory-sources">◇ &nbsp;Regulatory sources</a>
    <a href="/departments">⚙ &nbsp;Business setup</a>
    <a href="/distribution">▥ &nbsp;Distribution</a>
   </nav>
   <div className={ui.sideFoot}><strong>Prototype workspace</strong><p>Records are local to this browser. Do not upload confidential business or personal data.</p></div>
  </aside>
  <main className={ui.main}>
   <div className={ui.topbar}><span className={ui.crumb}>Workspace / Daily operations</span><div className={ui.topActions}><span className={ui.demo}>DEMO ONLY</span><a href="/departments" className={ui.profile}>Business settings</a></div></div>
   <header className={ui.heading}>
    <div><div className={ui.overline}>YOUR COMPLIANCE CONTROL CENTRE</div><h1>Know what needs doing.</h1><p>Prioritised tasks, supporting evidence and next actions — without digging through spreadsheets.</p><div className={ui.company}>Workspace: <strong>{company}</strong></div></div>
    <button type="button" className={ui.primary} onClick={()=>{setShowCreate(x=>!x);setMessage("");}}>{showCreate?"Close new action":"＋ New action"}</button>
   </header>
   <div className={ui.warning} role="note"><strong>Demonstration, not a compliant live system.</strong> No authenticated users, shared database, verified regulatory intelligence or secure evidence repository. Use fictional records only.</div>
   {message&&<div className={ui.feedback} role="status">{message}<button onClick={()=>setMessage("")} aria-label="Dismiss notice">×</button></div>}
   {showCreate&&<section className={ui.createCard} aria-label="Create action"><div className={ui.sectionTop}><div><h2>Create a work item</h2><p>Use a starting template or define a task from scratch. Examples are not regulatory checklists.</p></div></div>
     <form onSubmit={create} className={ui.formGrid}>
      <label>Start from a template<select value={chosenTemplate} onChange={e=>chooseTemplate(e.target.value)}><option value="custom">Blank action</option><option value="supplier">Supplier onboarding review</option><option value="training">Staff training review</option><option value="change">Regulatory change assessment</option><option value="inspection">Internal compliance review</option></select></label>
      <label>Category<input maxLength={80} value={newAction.regulator} onChange={e=>setNewAction(x=>({...x,regulator:e.target.value}))}/></label>
      <label className={ui.full}>What needs to happen? *<input required maxLength={160} value={newAction.title} onChange={e=>setNewAction(x=>({...x,title:e.target.value}))} placeholder="e.g. Review supplier due diligence evidence"/></label>
      <label>Responsible owner *<input required maxLength={80} value={newAction.owner} onChange={e=>setNewAction(x=>({...x,owner:e.target.value}))} placeholder="Name or team"/></label>
      <label>Due date *<input required type="date" value={newAction.due} onChange={e=>setNewAction(x=>({...x,due:e.target.value}))}/></label>
      <label className={ui.full}>Context and expected next step<textarea rows={2} maxLength={500} value={newAction.notes} onChange={e=>setNewAction(x=>({...x,notes:e.target.value}))}/></label>
      <div className={ui.full}><button className={ui.primary} type="submit">Create action</button></div>
     </form>
    </section>}
   <div className={ui.stats}>
    <div><span>Open attention items</span><strong>{stats.needsAttention}</strong><small>Includes overdue, upcoming and evidence gaps</small></div>
    <div><span>Overdue</span><strong>{stats.overdue}</strong><small>Tasks requiring immediate review</small></div>
    <div><span>Evidence gaps</span><strong>{stats.needsEvidence}</strong><small>Open tasks with incomplete evidence records</small></div>
    <div><span>Completion exceptions</span><strong>{stats.exceptions}</strong><small>Marked complete without current recorded evidence</small></div>
   </div>
   <div className={ui.columns}>
    <section className={ui.queueCard} aria-label="Prioritised work">
     <div className={ui.sectionTop}><div><h2>Your work queue</h2><p>Sorted by urgency, due dates and recorded evidence.</p></div><button className={ui.smallButton} onClick={csv}>Export report</button></div>
     <div className={ui.filterBar}>
      <label className={ui.searchLabel}>Search actions<input aria-label="Search actions" placeholder="Search tasks or owners…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className={ui.filterLabel}>Show<select aria-label="Filter work" value={filter} onChange={e=>setFilter(e.target.value)}><option value="priority">Needs attention</option><option value="week">Overdue and next 7 days</option><option value="exceptions">Completion exceptions</option><option value="complete">Completed</option><option value="all">All actions</option></select></label>
     </div>
     <div className={ui.queueList}>{!ready?<p className={ui.empty}>Loading work queue…</p>:visible.length===0?<div className={ui.empty}><strong>No items in this view.</strong><p>Switch to all actions or create a new work item.</p></div>:visible.map(row=>
      <button type="button" key={row.id} className={ui.queueItem+" "+(selectedId===row.id?ui.selected:"")} onClick={()=>{setSelectedId(row.id);setMessage("");}} aria-pressed={selectedId===row.id}>
       <div className={ui.itemTop}><span className={ui.tag+" "+(ui[row.level]||"")}>{tone[row.level]||"Review"}</span><span className={ui.due}>{shortDate(row.due)}</span></div>
       <strong>{row.title}</strong><small>{row.regulator} · {row.owner}</small>
       <div className={ui.nextStep}>Next: {row.nextStep}</div>
      </button>)}</div>
     <div className={ui.queueFooter}>{visible.length} shown · {stats.total} total actions · <a href="/register">Advanced register &amp; backups</a></div>
    </section>
    <section className={ui.detailCard} aria-label="Selected action">
     {!selected?<div className={ui.empty}><h2>Select a work item</h2><p>Choose an item from the queue to see its owner, evidence and next step.</p></div>:<>
      <div className={ui.sectionTop}><div><span className={ui.tag+" "+(ui[selected.level]||"")}>{tone[selected.level]}</span><h2 className={ui.detailTitle}>{selected.title}</h2><p>{selected.regulator} · Due {shortDate(selected.due)}</p></div></div>
      <div className={ui.guidance}><span>RECOMMENDED NEXT STEP</span><strong>{selected.nextStep}</strong><p>Guidance based on the task register and document metadata, not a legal or AI determination.</p></div>
      <div className={ui.steps}>
       <div><span>1</span><strong>Check the task</strong><small>Confirm ownership, due date and current information.</small></div>
       <div><span>2</span><strong>Link evidence</strong><small>Attach the right record and review its status.</small></div>
       <div><span>3</span><strong>Record the outcome</strong><small>Update progress or document a completion exception.</small></div>
      </div>
      <div className={ui.evidenceBox}><div><strong>Evidence position</strong><p>{selected.linked} linked document(s) · {selected.verifiedAttachments} current approved record(s) marked as having a file</p><small>Document metadata has not been independently checked.</small></div><a href={"/documents?obligationId="+encodeURIComponent(selected.id)} className={ui.secondary}>Add / link evidence</a></div>
      <form onSubmit={update} className={ui.editor}>
       <h3>Update work item</h3>
       <div className={ui.formGrid}>
        <label>Progress<select value={draft.status} onChange={e=>setDraft(x=>({...x,status:e.target.value as Status}))}><option>Open</option><option>In progress</option><option>Complete</option></select></label>
        <label>Responsible owner<input required maxLength={80} value={draft.owner} onChange={e=>setDraft(x=>({...x,owner:e.target.value}))}/></label>
        <label>Due date<input required type="date" value={draft.due} onChange={e=>setDraft(x=>({...x,due:e.target.value}))}/></label>
        <label>Source reviewed on<input type="date" value={draft.sourceCheckedAt} onChange={e=>setDraft(x=>({...x,sourceCheckedAt:e.target.value}))}/></label>
        <label className={ui.full}>Reference / primary source (HTTPS link)<input maxLength={500} type="url" placeholder="https://…" value={draft.sourceUrl} onChange={e=>setDraft(x=>({...x,sourceUrl:e.target.value}))}/></label>
        <label className={ui.full}>Notes / actions taken<textarea maxLength={500} rows={3} value={draft.notes} onChange={e=>setDraft(x=>({...x,notes:e.target.value}))}/></label>
        {draft.status==="Complete"&&selected.state!=="evidence-linked"&&<label className={ui.full}>Completion exception rationale *<textarea rows={3} maxLength={500} minLength={20} required value={draft.completionRationale} onChange={e=>setDraft(x=>({...x,completionRationale:e.target.value}))} placeholder="Explain why this was closed without a current approved supporting file (at least 20 characters)."/></label>}
        <div className={ui.full}><button className={ui.primary} type="submit">Save changes</button>{selected.sourceUrl&&safeSource(selected.sourceUrl)&&<a target="_blank" rel="noopener noreferrer" className={ui.sourceLink} href={selected.sourceUrl}>Open recorded source ↗</a>}</div>
       </div>
      </form>
     </>}
    </section>
   </div>
   <section className={ui.bottomCard}>
    <div className={ui.sectionTop}><div><h2>Activity &amp; oversight</h2><p>Browser-local change notes. These are not a verified or tamper-proof audit trail.</p></div><div className={ui.inlineActions}><button onClick={()=>setShowActivity(v=>!v)} className={ui.smallButton}>{showActivity?"Hide activity":"Show activity"}</button><button onClick={makeBackup} className={ui.smallButton}>Download local backup</button></div></div>
    {showActivity&&<div className={ui.activity}>{events.length?events.slice(0,20).map(x=><div key={x.id}><strong>{x.action}</strong><span>{x.details}</span><time>{new Date(x.timestamp).toLocaleString("en-GB")}</time></div>):<p>No local changes recorded yet.</p>}</div>}
   </section>
   <footer className={ui.footer}>RegPilot AI · Product demonstration · Secure team accounts, cloud document storage and verified regulatory feeds remain to be built.</footer>
  </main>
 </div>;
}
