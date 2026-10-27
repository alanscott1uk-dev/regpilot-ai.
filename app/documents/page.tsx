"use client";
import {useEffect,useMemo,useState} from "react";
import styles from "../dashboard.module.css";
import {DOCUMENT_CATEGORIES,validDocumentMetadata} from "../../lib/document-categories.mjs";
import {saveDemoCertificateFile,readDemoCertificateFile,deleteDemoCertificateFile} from "../../lib/demo-certificate-files.mjs";
import {WORKSPACE_KEY,defaultWorkspace,parseWorkspace} from "../../lib/workspace-config.mjs";
import type {DocumentMetadata} from "../../lib/document-categories.mjs";
import {reviewState,documentReviewSummary} from "../../lib/document-review.mjs";
import {DOCUMENT_ACTIVITY_KEY,addDocumentEvent,validDocumentEvents} from "../../lib/document-activity.mjs";
import type {DocumentEvent} from "../../lib/document-activity.mjs";
const KEY="regpilot-document-library-v1";
const OBLIGATIONS_KEY="regpilot-demo-obligations-v1";
type ObligationChoice={id:string;title:string};
const example:DocumentMetadata[]=[{id:"doc-example-1",title:"Example quality procedure",category:"Policies & SOPs",department:"Quality Assurance",owner:"Quality lead",version:"1.0",reviewDate:"2026-12-01",status:"Draft"}];
export default function Documents(){
 const [items,setItems]=useState<DocumentMetadata[]>(example);
 const [ready,setReady]=useState(false);
 const [events,setEvents]=useState<DocumentEvent[]>([]);
 const [showHistory,setShowHistory]=useState(false);
 const [obligations,setObligations]=useState<ObligationChoice[]>([]);
 const [obligationId,setObligationId]=useState("");
 const [departments,setDepartments]=useState<string[]>(defaultWorkspace().departments);
 const [title,setTitle]=useState(""),[category,setCategory]=useState("Policies & SOPs"),[department,setDepartment]=useState(""),[owner,setOwner]=useState(""),[version,setVersion]=useState("1.0"),[reviewDate,setReviewDate]=useState("");
 const [search,setSearch]=useState(""),[filter,setFilter]=useState("All"),[message,setMessage]=useState("");
 const [attachment,setAttachment]=useState<File|null>(null);
 const [reviewFilter,setReviewFilter]=useState("All review dates");
 useEffect(()=>{
  try{const obligationsRaw=localStorage.getItem(OBLIGATIONS_KEY);if(obligationsRaw){const parsed:unknown=JSON.parse(obligationsRaw);if(Array.isArray(parsed))setObligations(parsed.filter((x):x is ObligationChoice=>!!x&&typeof x.id==="string"&&typeof x.title==="string").map(x=>({id:x.id,title:x.title})));}
  const historyRaw=localStorage.getItem(DOCUMENT_ACTIVITY_KEY);if(historyRaw){const history:unknown=JSON.parse(historyRaw);if(validDocumentEvents(history))setEvents(history);}
  const raw=localStorage.getItem(KEY);if(raw){const parsed:unknown=JSON.parse(raw);if(Array.isArray(parsed))setItems(parsed.filter(validDocumentMetadata).slice(0,1000) as DocumentMetadata[]);}
  const profile=localStorage.getItem(WORKSPACE_KEY);if(profile){const config=parseWorkspace(JSON.parse(profile));if(config)setDepartments(config.departments);}
  }catch{}
  setReady(true);
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify(items))}catch{setMessage("Unable to save document metadata.")}},[items,ready]);
 useEffect(()=>{if(ready)try{localStorage.setItem(DOCUMENT_ACTIVITY_KEY,JSON.stringify(events))}catch{setMessage("Unable to save local activity history.")}},[events,ready]);
 const today=new Date();const todayString=[today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-");
 const summary=documentReviewSummary(items,todayString);
 const visible=items.filter(x=>(filter==="All"||x.category===filter)&&(reviewFilter==="All review dates"||reviewState(x,todayString)===reviewFilter)&&[x.title,x.category,x.department,x.owner].join(" ").toLowerCase().includes(search.toLowerCase()));
 async function add(e:React.FormEvent){
  e.preventDefault();
  const entry:DocumentMetadata={id:crypto.randomUUID(),title:title.trim(),category,department:department.trim(),owner:owner.trim(),version:version.trim(),reviewDate,status:"Draft",obligationId:obligationId||undefined};
  if(!validDocumentMetadata(entry)){setMessage("Check the document metadata.");return;}
  if(attachment){try{await saveDemoCertificateFile("document-"+entry.id,attachment)}catch(e){setMessage(e instanceof Error?e.message:"File rejected");return;}}
  setItems(x=>[entry,...x]);setEvents(x=>addDocumentEvent(x,entry.id,"Document created",entry.title));setTitle("");setDepartment("");setOwner("");setVersion("1.0");setReviewDate("");setObligationId("");setAttachment(null);setMessage(attachment?"Demo document and file saved locally.":"Document metadata saved without an attachment.");
 }
 async function download(id:string){try{const stored=await readDemoCertificateFile("document-"+id);if(!stored){setMessage("No attachment stored for this document.");return;}const url=URL.createObjectURL(stored.blob);const a=document.createElement("a");a.href=url;a.download=stored.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setMessage("Unable to read local attachment.");}}
 async function remove(id:string){if(!window.confirm("Delete document metadata and its local attachment?"))return;try{await deleteDemoCertificateFile("document-"+id);setItems(x=>x.filter(v=>v.id!==id));setEvents(x=>addDocumentEvent(x,id,"Document deleted"));setMessage("Document removed.");}catch{setMessage("Unable to delete local attachment.");}}
 return <main className={styles.shell}>
 <header className={styles.top}><div className={styles.brand}><span className={styles.mark}>R</span>RegPilot <span style={{color:"#3159df"}}>AI</span></div><span className={styles.pill}>DEMO WORKSPACE</span></header>
 <a href="/" style={{fontSize:13,color:"#3159df"}}>← Compliance dashboard</a>
 <div style={{marginTop:24}}><div className={styles.eyebrow}>Document control / All sectors</div><h1 className={styles.heading}>Document library</h1><p className={styles.sub}>Manage policies, certifications, permits and supporting evidence.</p></div>
 <div className={styles.notice}><strong>Demo only.</strong> Files are stored in this browser's IndexedDB, not encrypted, backed up or shared. Use fictional or non-sensitive files only. An Approved label is not a formal compliance approval.</div>
 <section className={styles.stats}>{[["Documents",items.length],["Draft",items.filter(x=>x.status==="Draft").length],["In review",items.filter(x=>x.status==="In review").length],["Overdue reviews",summary.overdue||0]].map(([label,count])=><div className={styles.stat} key={label}><div className={styles.statLabel}>{label}</div><div className={styles.statNumber}>{count}</div></div>)}</section>
 <section className={styles.panel} style={{marginBottom:18}}><h2 className={styles.panelTitle}>Add documentation</h2><form className={styles.form} onSubmit={e=>{void add(e)}}>
 <label className={styles.label}>Document title *<input required className={styles.field} maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label className={styles.label}>Category<select className={styles.field} value={category} onChange={e=>setCategory(e.target.value)}>{DOCUMENT_CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></label>
 <label className={styles.label}>Department<input className={styles.field} list="document-departments" maxLength={80} value={department} onChange={e=>setDepartment(e.target.value)}/><datalist id="document-departments">{departments.map(x=><option key={x} value={x}/>)}</datalist></label>
 <label className={styles.label}>Owner<input className={styles.field} maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label>
 <label className={styles.label}>Version<input className={styles.field} maxLength={30} value={version} onChange={e=>setVersion(e.target.value)}/></label>
 <label className={styles.label}>Review / expiry date<input className={styles.field} type="date" value={reviewDate} onChange={e=>setReviewDate(e.target.value)}/></label>
 <label className={styles.label+" "+styles.wide}>Related compliance obligation<select className={styles.field} value={obligationId} onChange={e=>setObligationId(e.target.value)}><option value="">Not linked</option>{obligations.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
 <label className={styles.label+" "+styles.wide}>Attach file (PDF, PNG, JPEG, max 2 MB)<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className={styles.field} onChange={e=>setAttachment(e.target.files?.[0]||null)}/></label>
 <div><button className={styles.button}>Save document</button></div></form></section>
 <section className={styles.panel}><h2 className={styles.panelTitle}>Document register</h2><div className={styles.toolbar}><input className={styles.field+" "+styles.search} aria-label="Search documents" placeholder="Search documents" value={search} onChange={e=>setSearch(e.target.value)}/><select className={styles.field+" "+styles.filter} aria-label="Filter review dates" value={reviewFilter} onChange={e=>setReviewFilter(e.target.value)}>{["All review dates","overdue","due-soon","current","unscheduled","archived"].map(x=><option key={x} value={x}>{x}</option>)}</select><select className={styles.field+" "+styles.filter} aria-label="Filter document category" value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{DOCUMENT_CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></div>
 <div className={styles.list}>{visible.map(x=><article className={styles.item} key={x.id}><div><span className={styles.category}>{x.category}</span><div className={styles.itemTitle}>{x.title}</div><div className={styles.meta}>{x.department||"Unassigned"} · {x.owner||"No owner"} · Version {x.version||"—"} · Review {x.reviewDate||"Not set"} · {reviewState(x,todayString)}</div>{x.obligationId&&<div className={styles.meta}>Linked action: {obligations.find(o=>o.id===x.obligationId)?.title||"Action unavailable on this device"}</div>}</div><div className={styles.actions}><select aria-label={"Status for "+x.title} className={styles.field+" "+styles.status} value={x.status} onChange={e=>{const next=e.target.value as DocumentMetadata["status"];setItems(v=>v.map(d=>d.id===x.id?{...d,status:next}:d));setEvents(v=>addDocumentEvent(v,x.id,"Status changed",x.status+" → "+next));}}>{["Draft","In review","Approved","Archived"].map(v=><option key={v}>{v}</option>)}</select><button className={styles.button+" "+styles.outline} type="button" onClick={()=>void download(x.id)}>Download</button><button className={styles.delete} type="button" onClick={()=>void remove(x.id)}>Delete</button></div></article>)}</div>
 {ready&&visible.length===0&&<p className={styles.empty}>No matching documents.</p>}
 {message&&<p role="status" className={styles.meta}>{message}</p>}</section>
 <section className={styles.panel} style={{marginTop:18}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><h2 className={styles.panelTitle} style={{margin:0}}>Document activity</h2><button type="button" className={styles.button+" "+styles.outline} onClick={()=>setShowHistory(x=>!x)}>{showHistory?"Hide history":"Show history"}</button></div>{showHistory&&<div className={styles.list} style={{marginTop:15}}>{events.length===0?<p className={styles.meta}>No local activity recorded yet.</p>:events.slice(0,40).map(e=><div key={e.id} style={{padding:"10px 0",borderBottom:"1px solid #e1e7f0"}}><strong style={{fontSize:13}}>{e.action}</strong><div className={styles.meta}>{e.details} · {new Date(e.timestamp).toLocaleString()}</div></div>)}</div>}</section>
 <p className={styles.footer}>Prototype only · No cloud uploads, approvals audit trail, malware scanning or cross-device access</p>
 </main>;
}
