"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {validateObligation} from "../../lib/obligations.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {parseControls,CONTROL_KEY} from "../../lib/controls.mjs";
import {parseChangeReviews,CHANGE_REVIEW_KEY} from "../../lib/change-triage.mjs";
import {buildTraceabilityGraph,exportTraceabilityCsv} from "../../lib/traceability-graph.mjs";
import type {TraceGraph,TraceRow} from "../../lib/traceability-graph.mjs";
import shell from "../workbench/workbench.module.css";
import ui from "./traceability.module.css";
const ACTIONS="regpilot-demo-obligations-v1",DOCS="regpilot-document-library-v1";
const empty={actions:[],controls:[],documents:[],reviews:[],sources:[]};
const priorities:{[key:string]:string}={"follow-up":"Follow up","review":"Needs review","organise":"Organise records","no-metadata-gaps":"No metadata gaps detected"};
function todayLocal(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function download(value:string,filename:string,type:string){const u=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement("a");a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export default function Traceability(){
 const [data,setData]=useState<{actions:any[];controls:any[];documents:any[];reviews:any[];sources:any[]}>(empty);
 const [ready,setReady]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [selected,setSelected]=useState("");
 const [filter,setFilter]=useState("all");
 const [search,setSearch]=useState("");
 const [showIntegrity,setShowIntegrity]=useState(false);
 const load=useCallback(()=>{
  function read(key:string):unknown{try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return []}}
  const actions=read(ACTIONS),documents=read(DOCS);
  setData(x=>({...x,
    actions:Array.isArray(actions)?actions.filter(validateObligation).slice(0,1000):[],
    documents:Array.isArray(documents)?documents.filter(validDocumentMetadata).slice(0,1000):[],
    controls:parseControls(localStorage.getItem(CONTROL_KEY)||"[]"),
    reviews:parseChangeReviews(localStorage.getItem(CHANGE_REVIEW_KEY)||"[]")
  }));
  setReady(true);
 },[]);
 useEffect(()=>{load();window.addEventListener("focus",load);window.addEventListener("storage",load);return()=>{window.removeEventListener("focus",load);window.removeEventListener("storage",load)}},[load]);
 const checkSources=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/regulatory-sources",{cache:"no-store"});
   if(!response.ok)throw new Error("Official source check unavailable");
   const payload:unknown=await response.json();
   if(!payload||typeof payload!=="object"||!("results" in payload)||!Array.isArray(payload.results))throw new Error("Invalid official source response");
   setData(x=>({...x,sources:(payload as {results:any[]}).results}));
  }catch{setData(x=>({...x,sources:[]}));setError("Official sources are unavailable. Previous decisions are not classified as superseded until a source can be checked.");}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void checkSources()},[checkSources]);
 const graph:TraceGraph=useMemo(()=>buildTraceabilityGraph(data,todayLocal()),[data]);
 useEffect(()=>{if(!selected&&graph.rows.length)setSelected(graph.rows[0].id);if(selected&&!graph.rows.some(r=>r.id===selected))setSelected(graph.rows[0]?.id||"")},[selected,graph]);
 const visible=useMemo(()=>graph.rows.filter(r=>(filter==="all"||r.attention===filter)&&[r.title,r.owner,r.regulator].join(" ").toLowerCase().includes(search.toLowerCase())),[graph,filter,search]);
 const detail=graph.rows.find(x=>x.id===selected);
 function exportCsv(){download(exportTraceabilityCsv(graph),"regpilot-traceability-"+graph.reviewDate+".csv","text/csv;charset=utf-8")}
 function exportJson(){download(JSON.stringify(graph,null,2),"regpilot-traceability-"+graph.reviewDate+".json","application/json")}
 const labels=[["Actions mapped",graph.summary.actions],["Source URLs recorded",graph.summary.linkedSources],["Controls mapped",graph.summary.mappedControls],["Current file metadata",graph.summary.withCurrentFileMetadata]];
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a href="/workbench" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>INTELLIGENCE &amp; OPERATIONS</small></span></a>
   <div className={shell.sideCaption}>WORKSPACE</div>
   <nav className={shell.sideNav} aria-label="Navigation">
    <a href="/workbench">◉ &nbsp;Today&apos;s work</a>
    <a href="/intelligence">✦ &nbsp;Regulatory intelligence</a>
    <a href="/controls">◇ &nbsp;Shared control library</a>
    <a className={shell.active} aria-current="page" href="/traceability">◈ &nbsp;Traceability explorer</a>
    <a href="/assurance">▣ &nbsp;Review centre</a>
    <a href="/documents">▤ &nbsp;Documents</a>
    <a href="/departments">⚙ &nbsp;Business setup</a>
   </nav>
   <div className={shell.sideFoot}><strong>Source to evidence</strong><p>Built to expose missing links, not to certify regulatory compliance. Browser-local demo records only.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / Traceability explorer</span><div className={shell.topActions}><span className={shell.demo}>DEMO ONLY</span><a className={shell.profile} href="/assurance">Review centre</a></div></div>
   <header className={ui.hero}>
    <div><span className={ui.eyebrow}><span className={ui.dot}/> REGPILOT / EVIDENCE LINEAGE</span><h1>Every requirement.<br/><em>A clear trail.</em></h1><p>Follow each work item from its recorded source to its controls, supporting documents and outstanding follow-ups.</p>
    <div className={ui.heroTags}><span>Traceable references</span><span>Reusable controls</span><span>Explainable gap checks</span></div></div>
    <div className={ui.heroSide}><span>RECORD TRANSPARENCY</span><strong>{graph.summary.critical+graph.summary.review}</strong><p>work items with urgent or review-level metadata findings</p><button type="button" onClick={()=>{setFilter("review");setSearch("");}}>Explore review items ↗</button></div>
   </header>
   <div className={shell.warning}><strong>Metadata visibility, not a compliance verdict.</strong> A source link isn't a verified obligation. A document's Approved label and attachment flag do not prove its contents are suitable. No automated legal interpretation or secure customer storage is connected.</div>
   {error&&<div className={ui.warning} role="status">{error}<button onClick={()=>void checkSources()} disabled={loading}>Retry</button></div>}
   <div className={ui.stats}>{labels.map(([label,num])=><div key={label}><span>{label}</span><strong>{num}</strong></div>)}</div>
   <section className={ui.workspace}>
    <div className={ui.listPanel}>
     <div className={ui.panelHeader}><div><span className={ui.overline}>STEP 01 / SELECT</span><h2>Work item explorer</h2><p>Filter by the attention needed</p></div><button className={ui.refresh} type="button" onClick={()=>{load();void checkSources()}} disabled={loading}>{loading?"Checking":"Refresh"}</button></div>
     <div className={ui.filters}><input aria-label="Find tasks" placeholder="Search work items…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Filter attention" value={filter} onChange={e=>setFilter(e.target.value)}>
      <option value="all">All tasks</option><option value="follow-up">Urgent follow-up</option><option value="review">Needs review</option><option value="organise">Record organisation</option><option value="no-metadata-gaps">No metadata gaps detected</option>
     </select></div>
     <div className={ui.scrollList}>{!ready?<p className={ui.empty}>Loading recorded data…</p>:visible.length===0?<p className={ui.empty}>No matching tasks. <a href="/workbench">Add or update a task.</a></p>:visible.map(r=><button key={r.id} type="button" onClick={()=>setSelected(r.id)} aria-pressed={selected===r.id} className={ui.task+" "+(selected===r.id?ui.selected:"")}>
      <div className={ui.taskTop}><span className={ui.attention+" "+(r.attention==="follow-up"?ui.alert:r.attention==="review"?ui.review:r.attention==="organise"?ui.organise:ui.clear)}>{priorities[r.attention]}</span><span className={ui.due}>{r.due}</span></div>
      <strong>{r.title}</strong><p>{r.owner} · {r.regulator}</p>
      <div className={ui.taskFoot}><span>{r.links.controls} control(s)</span><span>{r.links.documents} document(s)</span><span>{r.gaps.length} flags</span></div>
     </button>)}</div>
    </div>
    <div className={ui.detailPanel}>
     {!detail?<div className={ui.empty}><h2>Select a work item</h2><p>Recorded source, controls and evidence will appear here.</p></div>:<>
      <div className={ui.detailTop}><span className={ui.overline}>STEP 02 / FOLLOW THE TRAIL</span><h2>{detail.title}</h2><p>Owned by {detail.owner} · {detail.status} · Due {detail.due}</p></div>
      <div className={ui.chain}>
       <article><div className={ui.chainTop}><span className={ui.chainNum}>01</span><span>RECORDED SOURCE</span><strong>{detail.source.url?"Linked":"Not recorded"}</strong></div>
        {detail.source.url?<><p>Reference: <a href={detail.source.url} target="_blank" rel="noopener noreferrer">{detail.source.url}</a></p><small>{detail.source.state==="user-recorded"?"User-entered check date: "+detail.source.checkedAt:detail.source.state==="check-over-90-days"?"Last recorded check over 90 days ago":"No check date recorded"}</small></>:<p>No external source is recorded. This can be normal for an internally defined task.</p>}
        {detail.decisions.length>0&&<small>{detail.decisions.length} linked human source decision(s) recorded</small>}
       </article>
       <article><div className={ui.chainTop}><span className={ui.chainNum}>02</span><span>MAPPED CONTROLS</span><strong>{detail.controls.length} recorded</strong></div>
        {detail.controls.length?<div className={ui.chips}>{detail.controls.map(c=><a key={c.id} href="/controls">{c.title}<small> · {c.status}</small></a>)}</div>:<p>No shared control assigned to this task.</p>}
       </article>
       <article><div className={ui.chainTop}><span className={ui.chainNum}>03</span><span>SUPPORTING RECORDS</span><strong>{detail.evidence.length} linked</strong></div>
        {detail.evidence.length?<div className={ui.documents}>{detail.evidence.map(d=><div key={d.id}><div><strong>{d.title}</strong><small>{d.linkMethod} · {d.status} · Review: {d.reviewDate||"Not set"}</small></div><span className={d.recordedCurrent?ui.documentFlag:ui.documentMissing}>{d.recordedCurrent?"File metadata recorded":"Needs review"}</span></div>)}</div>:<p>No supporting document currently linked.</p>}
        <a className={ui.textLink} href={"/documents?obligationId="+encodeURIComponent(detail.id)}>Open document library ↗</a>
       </article>
      </div>
      <div className={ui.gaps}><div className={ui.gapTitle}><h3>What needs attention?</h3><span>{detail.gaps.length} finding(s)</span></div>
       {detail.gaps.length?detail.gaps.map((g,i)=><div key={g.code+"-"+i} className={ui.gap}><span className={g.severity==="critical"?ui.alert:g.severity==="review"?ui.review:ui.organise}>{g.severity==="critical"?"!":g.severity==="review"?"◇":"↔"}</span><div><strong>{g.title}</strong><p>{g.detail}</p></div><a href={g.href}>Resolve ↗</a></div>):<p className={ui.empty}>No gaps detected in these recorded fields. This is not evidence of compliance or effectiveness.</p>}
      </div>
      <a className={ui.openTask} href={"/workbench?item="+encodeURIComponent(detail.id)}>Open this work item ↗</a>
     </>}
    </div>
   </section>
   <section className={ui.integrity}><div className={ui.integrityHead}><div><span className={ui.overline}>STEP 03 / CHECK THE DATA</span><h2>Register integrity</h2><p>Missing or duplicated references can make reports misleading.</p></div><div><button type="button" onClick={()=>setShowIntegrity(v=>!v)}>{showIntegrity?"Hide checks":"Review "+graph.integrity.length+" flags"}</button><button type="button" onClick={exportCsv}>Export CSV</button><button type="button" onClick={exportJson}>Export JSON</button></div></div>
    {showIntegrity&&<div className={ui.integrityRows}>{graph.integrity.length===0?<p>No broken identifiers were found in the stored records checked. This is not verification of document content.</p>:graph.integrity.map((x,i)=><div key={x.code+"-"+i}><strong>{x.title}</strong><span>{x.detail}</span><a href={x.href}>Review ↗</a></div>)}</div>}
   </section>
   <p className={ui.footer}>RegPilot AI · Development demonstration · Source links and evidence flags are self-reported metadata, not legal findings or formal assurance. No real sensitive information.</p>
  </main>
 </div>;
}
