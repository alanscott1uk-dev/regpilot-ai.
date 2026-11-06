"use client";
import {useEffect,useMemo,useState} from "react";
import {validateObligation,isValidDate} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {parseControls,CONTROL_KEY} from "../../lib/controls.mjs";
import type {ControlRecord} from "../../lib/controls.mjs";
import {WORKSPACE_KEY,defaultWorkspace,parseWorkspace} from "../../lib/workspace-config.mjs";
import {operationalQueue,operationsSummary,exportOperationsCsv,ACTIVITY_KEY,addOperationalEvent,validOperationalEvents} from "../../lib/operational-triage.mjs";
import type {TriageRow,OperationalEvent} from "../../lib/operational-triage.mjs";
import {reviewSummary,parseChangeReviews,CHANGE_REVIEW_KEY} from "../../lib/change-triage.mjs";
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
 const [controls,setControls]=useState<ControlRecord[]>([]);
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
 const [sourcePulse,setSourcePulse]=useState<{available:number;awaiting:number;checkedAt:string}|null>(null);
 const [sourcePulseError,setSourcePulseError]=useState(false);
 useEffect(()=>{
  try{const raw=localStorage.getItem(ACTIONS_KEY);if(raw){const x:unknown=JSON.parse(raw);setItems(Array.isArray(x)?x.filter(validateObligation) as Action[]:sample);}else setItems(sample);}catch{setItems(sample);}
  try{const raw=localStorage.getItem(ACTIVITY_KEY);if(raw){const x:unknown=JSON.parse(raw);if(validOperationalEvents(x))setEvents(x);}}catch{}
  setReady(true);
  function refreshLinked(){
   try{const v=JSON.parse(localStorage.getItem(DOCUMENTS_KEY)||"[]");setDocuments(Array.isArray(v)?v.filter(validDocumentMetadata):[]);}catch{setDocuments([]);}
   try{setControls(parseControls(localStorage.getItem(CONTROL_KEY)||"[]"));}catch{setControls([]);}
   try{const raw=localStorage.getItem(WORKSPACE_KEY);const v=raw?parseWorkspace(JSON.parse(raw)):defaultWorkspace();setCompany(v?.company||"Demo workspace");}catch{setCompany("Demo workspace");}
  }
  refreshLinked();
  window.addEventListener("focus",refreshLinked);window.addEventListener("storage",refreshLinked);
  return()=>{window.removeEventListener("focus",refreshLinked);window.removeEventListener("storage",refreshLinked)};
 },[]);
 useEffect(()=>{
  let active=true;
  async function check(){
   try{
    const res=await fetch("/api/regulatory-sources",{cache:"no-store"});
    if(!res.ok)throw new Error("Unavailable");
    const payload:unknown=await res.json();
    if(!payload||typeof payload!=="object"||!("results" in payload)||!Array.isArray(payload.results)||!("checkedAt" in payload)||typeof payload.checkedAt!=="string")throw new Error("Invalid");
    const snapshot=reviewSummary(payload.results,parseChangeReviews(localStorage.getItem(CHANGE_REVIEW_KEY)||"[]"));
    if(active){setSourcePulse({available:snapshot.sources,awaiting:snapshot.awaiting,checkedAt:payload.checkedAt});setSourcePulseError(false);}
   }catch{if(active)setSourcePulseError(true);}
  }
  void check();
  return()=>{active=false};
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(ACTIONS_KEY,JSON.stringify(items));}catch{setMessage("Browser storage is full; export your register immediately.");}},[items,ready]);
 useEffect(()=>{if(ready)try{localStorage.setItem(ACTIVITY_KEY,JSON.stringify(events));}catch{setMessage("Unable to save local history.");}},[events,ready]);
 useEffect(()=>{if(!selectedId&&items.length)setSelectedId(items[0].id);},[items,selectedId]);
 useEffect(()=>{if(!ready)return;const requested=new URLSearchParams(window.location.search).get("item");if(requested&&items.some(x=>x.id===requested))setSelectedId(requested);},[ready]);
 useEffect(()=>{
  const selected=items.find(x=>x.id===selectedId);
  if(selected)setDraft({status:selected.status,owner:selected.owner,due:selected.due,notes:selected.notes,sourceUrl:selected.sourceUrl||"",sourceCheckedAt:selected.sourceCheckedAt||"",completionRationale:selected.completionRationale||""});
 },[selectedId,items]);
 const today=localDate();
 const queue=useMemo(()=>operationalQueue(items,documents,today,controls),[items,documents,controls,today]);
 const stats=useMemo(()=>operationsSummary(queue),[queue]);
 const visible=useMemo(()=>queue.filter(x=>
  (filter==="all"||(filter==="priority"&&x.status!=="Complete"&&(x.level!=="routine"||x.state!=="evidence-linked"))||(filter==="week"&&x.status!=="Complete"&&x.daysRemaining!==null&&x.daysRemaining<=7)||(filter==="exceptions"&&x.completionException)||(filter==="evidence"&&x.status!=="Complete"&&x.state!=="evidence-linked")||(filter==="complete"&&x.status==="Complete"))&&
  [x.title,x.owner,x.regulator].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[queue,filter,search]);
 const evidenceLinked=queue.filter(x=>x.state==="evidence-linked").length;
 const evidenceRate=queue.length?Math.round(evidenceLinked/queue.length*100):0;
 const recommended=queue.find(x=>x.status!=="Complete"||x.completionException);
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
    <a href="/evidence">◫ &nbsp;Evidence gaps</a><a href="/controls">◇ &nbsp;Shared control library</a><a href="/assurance">◈ &nbsp;Review centre</a>
    <a href="/intelligence">✦ &nbsp;Regulatory intelligence</a><a href="/regulatory-sources">◇ &nbsp;Official source catalogue</a>
    <a href="/departments">⚙ &nbsp;Business setup</a>
    <a href="/distribution">▥ &nbsp;Distribution</a>
   </nav>
   <div className={ui.sideFoot}><strong>Prototype workspace</strong><p>Records are local to this browser. Do not upload confidential business or personal data.</p></div>
  </aside>
  <main className={ui.main}>
   <div className={ui.topbar}><span className={ui.crumb}>Workspace / Daily operations</span><div className={ui.topActions}><span className={ui.demo}>DEMO ONLY</span><a href="/departments" className={ui.profile}>Business settings</a></div></div>
   <header className={ui.premiumHero}>
    <div className={ui.heroCopy}>
     <div className={ui.heroEyebrow}><span className={ui.statusDot}/> REGPILOT CONTROL CENTRE <span className={ui.heroDivider}>/</span> DEMONSTRATION</div>
     <h1>Compliance, <em>without the chaos.</em></h1>
     <p>One clear picture of what matters, what needs evidence and what your team should do next.</p>
     <div className={ui.heroButtons}>
      <button type="button" className={ui.heroPrimary} onClick={()=>{setShowCreate(x=>!x);setMessage("");}}>{showCreate?"Close action form":"＋ Create an action"} <span>↗</span></button>
      <a className={ui.heroGhost} href="/intelligence">Review regulatory updates <span>↗</span></a>
     </div>
     <div className={ui.heroTrust}><span>✦ Guided work</span><span>◈ Evidence connected</span><span>◉ Clear ownership</span></div>
    </div>
    <div className={ui.heroPulse}>
     <div className={ui.pulseTop}><span>OPERATIONAL SIGNAL</span><span className={ui.livePill}>● LOCAL DEMO</span></div>
     <div className={ui.pulseMiddle}>
      <div className={ui.pulseRing} style={{background:"conic-gradient(#a794ff "+evidenceRate+"%, rgba(255,255,255,.12) "+evidenceRate+"%)"}}>
       <div className={ui.pulseInside}><strong>{evidenceRate}%</strong><small>of actions have current approved file metadata</small></div>
      </div>
      <div className={ui.pulseLegend}>
       <div><strong>{evidenceLinked}</strong><span>File-linked</span></div>
       <div><strong>{Math.max(0,queue.length-evidenceLinked)}</strong><span>Not confirmed</span></div>
       <div><strong>{queue.length}</strong><span>Total tasks</span></div>
      </div>
     </div>
     <div className={ui.pulseFoot}>Calculated from browser records, <strong>not</strong> a compliance score or verification.</div>
    </div>
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
   <section className={ui.quickStart} aria-label="Guided setup">
    <div className={ui.quickHead}><div><span>GET STARTED</span><h2>Your first four steps</h2><p>Follow this path to experience the demo from start to review. Each step shows where your records are used.</p></div><span className={ui.quickCount}>{(items.length>0?1:0)+(documents.length>0?1:0)+(controls.length>0?1:0)} / 3 RECORDING STEPS</span></div>
    <div className={ui.quickGrid}>
     <button type="button" className={ui.quickStep} onClick={()=>{setShowCreate(true);setMessage("Enter a task title, responsible owner and due date in the form above.");}}><span className={ui.quickNum}>01</span><strong>Record a task</strong><small>{items.length?"Work items recorded":"Name the work and its owner"}</small><span className={ui.quickIcon}>{items.length?"✓":"→"}</span></button>
     <a href="/documents" className={ui.quickStep}><span className={ui.quickNum}>02</span><strong>Add supporting evidence</strong><small>{documents.length?"Document records present":"Record or attach a demo file"}</small><span className={ui.quickIcon}>{documents.length?"✓":"→"}</span></a>
     <a href="/controls" className={ui.quickStep}><span className={ui.quickNum}>03</span><strong>Connect a control</strong><small>{controls.length?"Shared control recorded":"Reuse evidence across tasks"}</small><span className={ui.quickIcon}>{controls.length?"✓":"→"}</span></a>
     <a href="/assurance" className={ui.quickStep}><span className={ui.quickNum}>04</span><strong>Review the gaps</strong><small>Export a review pack (not a certificate)</small><span className={ui.quickIcon}>→</span></a>
    </div>
   </section>
   <div className={ui.dashboardSectionTitle}><div><span>OVERVIEW</span><h2>Today at a glance</h2></div><a href="/evidence">Explore evidence gaps ↗</a></div>
   <div className={ui.stats}>
    <div><span>Open attention items</span><strong>{stats.needsAttention}</strong><small>Includes overdue, upcoming and evidence gaps</small></div>
    <div><span>Overdue</span><strong>{stats.overdue}</strong><small>Tasks requiring immediate review</small></div>
    <div><span>Evidence gaps</span><strong>{stats.needsEvidence}</strong><small>Open tasks with incomplete evidence records</small></div>
    <div><span>Completion exceptions</span><strong>{stats.exceptions}</strong><small>Marked complete without current recorded evidence</small></div>
   </div>
   <section className={ui.actionStrip} aria-label="Suggested next steps">
    <div className={ui.recommendation}>
     <span className={ui.stripIcon}>✧</span>
     <div><span className={ui.stripOverline}>NEXT BEST MOVE</span><strong>{recommended?recommended.nextStep:"Your open work queue has no flagged tasks"}</strong><small>{recommended?recommended.title+" · "+recommended.owner:"Review new obligations and supporting records as they arise."}</small></div>
     {recommended&&<button type="button" onClick={()=>{setSelectedId(recommended.id);setFilter("all");setMessage("Selected the suggested work item below.");}}>Open action <span>↗</span></button>}
    </div>
    <div className={ui.regulatorySignal}>
     <span className={ui.stripIcon}>◈</span>
     <div><span className={ui.stripOverline}>OFFICIAL SOURCE WATCH</span><strong>{sourcePulse?sourcePulse.awaiting+" of "+sourcePulse.available+" sources need manual triage":sourcePulseError?"Source check unavailable":"Checking official sources…"}</strong><small>{sourcePulse?"Metadata checked "+new Date(sourcePulse.checkedAt).toLocaleDateString("en-GB"):"Limited MHRA / Home Office pilot feed · no background monitoring"}</small></div>
     <a href="/intelligence">Open inbox <span>↗</span></a>
    </div>
   </section>
   <div className={ui.columns}>
    <section className={ui.queueCard} aria-label="Prioritised work">
     <div className={ui.sectionTop}><div><h2>Prioritised work</h2><p>Real tasks. Clear owners. The next step already surfaced.</p></div><button className={ui.smallButton} onClick={csv}>Export report</button></div>
     <div className={ui.filterBar}>
      <label className={ui.searchLabel}>Search actions<input aria-label="Search actions" placeholder="Search tasks or owners…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className={ui.filterLabel}>Show<select aria-label="Filter work" value={filter} onChange={e=>setFilter(e.target.value)}><option value="priority">Needs attention</option><option value="week">Overdue and next 7 days</option><option value="exceptions">Completion exceptions</option><option value="evidence">Evidence gaps</option><option value="complete">Completed</option><option value="all">All actions</option></select></label>
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
       <h3>Make progress</h3>
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
