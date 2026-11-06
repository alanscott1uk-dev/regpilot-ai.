"use client";
import {useEffect,useMemo,useState} from "react";
import styles from "../dashboard.module.css";
import {validateObligation} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {evidenceCoverage,evidenceCoverageSummary} from "../../lib/evidence-coverage.mjs";
import type {CoverageRow} from "../../lib/evidence-coverage.mjs";
const ACTION_KEY="regpilot-demo-obligations-v1";
const DOCUMENT_KEY="regpilot-document-library-v1";
const labels:Record<string,string>={
 "missing":"No linked document",
 "pending-review":"Document awaiting approval",
 "review-expired":"Approved document overdue for review",
 "attachment-unverified":"Approved record with no confirmed file",
 "evidence-linked":"Linked file recorded"
};
const priority:Record<string,number>={"missing":0,"review-expired":1,"attachment-unverified":2,"pending-review":3,"evidence-linked":4};
function localToday(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
export default function Evidence(){
 const [rows,setRows]=useState<CoverageRow[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [filter,setFilter]=useState("All");
 const [query,setQuery]=useState("");
 function refresh(){
  try{
   const a=JSON.parse(localStorage.getItem(ACTION_KEY)||"[]");
   const d=JSON.parse(localStorage.getItem(DOCUMENT_KEY)||"[]");
   setRows(evidenceCoverage(Array.isArray(a)?a.filter(validateObligation):[],Array.isArray(d)?d.filter(validDocumentMetadata):[],localToday()));
  }catch{setRows([]);}
  setLoaded(true);
 }
 useEffect(()=>{refresh();window.addEventListener("focus",refresh);return()=>window.removeEventListener("focus",refresh);},[]);
 const summary=useMemo(()=>evidenceCoverageSummary(rows),[rows]);
 const visible=useMemo(()=>rows.filter(r=>(filter==="All"||r.state===filter)&&[r.title,r.owner].join(" ").toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(priority[a.state]??99)-(priority[b.state]??99)),[rows,filter,query]);
 return <main className={styles.shell}>
  <header className={styles.top}><div className={styles.brand}><span className={styles.mark}>R</span>RegPilot <span style={{color:"#3159df"}}>AI</span></div><span className={styles.pill}>DEMO WORKSPACE</span></header>
  <a href="/" style={{fontSize:13,color:"#3159df"}}>← Compliance dashboard</a>
  <div style={{marginTop:24}}><div className={styles.eyebrow}>Action to evidence / All sectors</div><h1 className={styles.heading}>Evidence coverage</h1><p className={styles.sub}>See which actions need documents, review or attached evidence before closing them.</p></div>
  <div className={styles.notice}><strong>Demonstration only.</strong> This browser-only check uses document metadata, including a saved-file flag. It does not inspect document contents, confirm that a file still exists or decide legal compliance. Use fictional information only.</div>
  <section className={styles.stats}>{[["Actions",summary.total||0],["Missing",(summary.missing||0)],["Pending review",(summary["pending-review"]||0)+(summary["review-expired"]||0)],["Linked files",(summary["evidence-linked"]||0)]].map(([label,count])=><div className={styles.stat} key={label}><div className={styles.statLabel}>{label}</div><div className={styles.statNumber}>{count}</div></div>)}</section>
  <section className={styles.panel}><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><h2 className={styles.panelTitle} style={{margin:0}}>Evidence gaps</h2><button className={styles.button+" "+styles.outline} onClick={refresh}>Refresh</button></div>
   <div className={styles.toolbar} style={{marginTop:16}}><input className={styles.field+" "+styles.search} aria-label="Search actions" placeholder="Search actions or owners" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter evidence status" className={styles.field+" "+styles.filter} value={filter} onChange={e=>setFilter(e.target.value)}><option value="All">All states</option>{Object.entries(labels).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></div>
   {!loaded?<p className={styles.empty}>Loading local records…</p>:visible.length===0?<p className={styles.empty}>No matching actions. Add demo actions on the dashboard to begin.</p>:<div className={styles.list}>{visible.map(row=><article key={row.id} className={styles.item}><div><span className={styles.category}>{labels[row.state]}</span><div className={styles.itemTitle}>{row.title}</div><div className={styles.meta}>{row.owner} · Due {row.due||"Not set"} · {row.linked} linked document(s) · {row.verifiedAttachments} recorded current approved file(s)</div></div><div className={styles.actions}><a href="/documents" className={styles.button+" "+styles.outline} style={{textDecoration:"none"}}>Manage documents</a></div></article>)}</div>}
  </section>
  <p className={styles.footer}>Prototype evidence triage · Not a substitute for a qualified compliance review</p>
 </main>;
}
