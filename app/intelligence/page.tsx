"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {validateObligation} from "../../lib/obligations.mjs";
import {CHANGE_REVIEW_KEY,sourceVersion,reviewKey,safeOfficialSource,parseChangeReviews,buildReview,buildTaskFromSource,reviewSummary} from "../../lib/change-triage.mjs";
import type {ChangeReview} from "../../lib/change-triage.mjs";
import ui from "../workbench/workbench.module.css";
import css from "./intelligence.module.css";
type Source={id:string;agency:string;topic:string;title:string;url:string;status:string;description:string;updatedAt:string|null;revisionAt:string|null};
type Response={checkedAt:string;results:Source[];disclaimer:string};
type FormState={status:ChangeReview["status"];impact:ChangeReview["impact"];owner:string;due:string;notes:string};
const blank:FormState={status:"unreviewed",impact:"unknown",owner:"",due:"",notes:""};
const ACTIONS_KEY="regpilot-demo-obligations-v1";
function format(date:string|null|undefined){if(!date||Number.isNaN(Date.parse(date)))return "Not stated";return new Date(date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}
export default function Intelligence(){
 const [data,setData]=useState<Response|null>(null);
 const [reviews,setReviews]=useState<ChangeReview[]>([]);
 const [ready,setReady]=useState(false);
 const [selectedId,setSelectedId]=useState("");
 const [draft,setDraft]=useState<FormState>(blank);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [filter,setFilter]=useState("all");
 useEffect(()=>{setReviews(parseChangeReviews(localStorage.getItem(CHANGE_REVIEW_KEY)||"[]"));setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(CHANGE_REVIEW_KEY,JSON.stringify(reviews))}catch{setMessage("Unable to save reviews in this browser.")}},[reviews,ready]);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/regulatory-sources",{cache:"no-store"});
   if(!response.ok)throw new Error("Official source service unavailable");
   const json:Response=await response.json();
   if(!json||!Array.isArray(json.results))throw new Error("Invalid source response");
   const valid=json.results.filter(safeOfficialSource);
   setData({...json,results:valid});
   setSelectedId(id=>valid.find(s=>s.id===id)?id:valid[0]?.id||"");
  }catch(e){setError(e instanceof Error?e.message:"Source check failed. Try again later.");}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void refresh()},[refresh]);
 const sources=data?.results||[];
 const current=sources.find(x=>x.id===selectedId);
 const saved=current?reviews.find(x=>x.key===reviewKey(current)):undefined;
 const oldReview=current?reviews.some(x=>x.key.startsWith(current.id+"::")&&x.key!==reviewKey(current)):false;
 useEffect(()=>{if(saved)setDraft({status:saved.status,impact:saved.impact,owner:saved.owner,due:saved.due,notes:saved.notes});else setDraft(blank)},[saved?.key,current?.id]);
 const summary=useMemo(()=>reviewSummary(sources,reviews),[sources,reviews]);
 const visible=sources.filter(x=>filter==="all"||(filter==="pending"&&!reviews.some(r=>r.key===reviewKey(x)&&["not-applicable","action-required"].includes(r.status)&&(!("actionId" in r)||!!r.actionId||r.status==="not-applicable")))||(filter==="tracked"&&reviews.some(r=>r.key===reviewKey(x)&&!!r.actionId)));
 function save(e:React.FormEvent){
  e.preventDefault();if(!current)return;
  try{
   const next=buildReview(current,draft);
   const prev=reviews.find(r=>r.key===next.key);
   if(prev?.actionId&&next.status!=="action-required"){setMessage("This review already has a linked action. Review the existing task before changing the applicability decision.");return;}
   const update={...next,...(prev?.actionId?{actionId:prev.actionId}:{})};
   setReviews(all=>[update,...all.filter(r=>r.key!==next.key)].slice(0,300));
   setMessage("Impact decision saved locally. This is a manual review, not AI verification.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not save review.")}
 }
 function convert(){
  if(!current)return;
  try{
   const review=reviews.find(r=>r.key===reviewKey(current));
   if(!review){setMessage("Save the impact assessment first.");return}
   if(review.actionId){setMessage("A work item is already linked to this reviewed source version.");return}
   const raw=localStorage.getItem(ACTIONS_KEY);
   const parsed:unknown=raw?JSON.parse(raw):[];
   const actions=Array.isArray(parsed)?parsed.filter(validateObligation):[];
   if(actions.length>=1000){setMessage("Demo work queue is full.");return}
   const id=crypto.randomUUID();
   const action=buildTaskFromSource(current,review,id);
   localStorage.setItem(ACTIONS_KEY,JSON.stringify([action,...actions]));
   setReviews(all=>all.map(r=>r.key===review.key?{...r,actionId:id}:r));
   setMessage("A linked draft action was added to your local work queue. Review it before acting.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not create the work item.");}
 }
 return <div className={ui.app}>
 <aside className={ui.sidebar}>
  <a href="/workbench" className={ui.logo}><span className={ui.logoMark}>R</span><span>RegPilot <b>AI</b><small>INTELLIGENCE &amp; OPERATIONS</small></span></a>
  <div className={ui.sideCaption}>WORKSPACE</div>
  <nav className={ui.sideNav} aria-label="Navigation">
   <a href="/workbench">◉ &nbsp;Today&apos;s work</a>
    <a href="/ai">✦ &nbsp;AI review studio</a><a href="/register">▤ &nbsp;Action register</a><a href="/documents">▣ &nbsp;Documents</a>
   <a className={ui.active} href="/intelligence" aria-current="page">✧ &nbsp;Regulatory intelligence</a>
   <a href="/evidence">◫ &nbsp;Evidence gaps</a><a href="/controls">◇ &nbsp;Shared control library</a><a href="/traceability">✧ &nbsp;Traceability explorer</a><a href="/assurance">◈ &nbsp;Review centre</a><a href="/departments">⚙ &nbsp;Business setup</a>
  </nav>
  <div className={ui.sideFoot}><strong>Limited pilot feed</strong><p>Official MHRA and Home Office publication metadata. Not a full compliance monitoring service.</p></div>
 </aside>
 <main className={ui.main}>
  <div className={ui.topbar}><span className={ui.crumb}>Workspace / Regulatory intelligence</span><div className={ui.topActions}><span className={ui.demo}>DEMO ONLY</span><a href="/workbench" className={ui.profile}>Return to command centre</a></div></div>
  <header className={css.hero}><div><span className={css.eyebrow}>REGULATORY INTELLIGENCE / PILOT</span><h1>From change to action.</h1><p>Review official publication metadata, record a human impact decision and convert relevant changes into owned tasks.</p></div><button className={ui.primary} type="button" disabled={loading} onClick={()=>void refresh()}>{loading?"Checking…":"↻ Check sources"}</button></header>
  <div className={ui.warning}><strong>Important:</strong> A changed publication date does not necessarily mean a legal requirement changed. RegPilot is not interpreting legislation automatically; assess the original official source before acting. Information and assessments are held in this browser only.</div>
  {error&&<p className={css.error} role="alert">{error}</p>}{message&&<p role="status" className={css.notice}>{message}</p>}
  <div className={css.metrics}>
   <div><span>Official feeds available</span><strong>{summary.sources}</strong><small>Limited published source catalogue</small></div>
   <div><span>Awaiting a decision</span><strong>{summary.awaiting}</strong><small>Unreviewed, investigating or action pending</small></div>
   <div><span>Converted to work</span><strong>{summary.tracked}</strong><small>Tasks linked to specific source versions</small></div>
  </div>
  <div className={css.columns}>
   <section className={css.list}>
    <div className={css.sectionHeader}><div><h2>Official source inbox</h2><p>{data?"Checked "+new Date(data.checkedAt).toLocaleString("en-GB"):"Source check not completed"}</p></div><select aria-label="Filter sources" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All sources</option><option value="pending">Needs decision</option><option value="tracked">Linked actions</option></select></div>
    {!data&&!error?<p className={css.empty}>Checking official sources…</p>:visible.length===0?<p className={css.empty}>No sources in this view.</p>:visible.map(s=>{
     const r=reviews.find(x=>x.key===reviewKey(s));
     const previous=reviews.some(x=>x.key.startsWith(s.id+"::")&&x.key!==reviewKey(s));
     return <button type="button" key={s.id} className={css.source+" "+(selectedId===s.id?css.chosen:"")} onClick={()=>{setSelectedId(s.id);setMessage("");}} aria-pressed={selectedId===s.id}>
       <div className={css.sourceMeta}><span>{s.agency} · {s.topic}</span><span>{format(sourceVersion(s))}</span></div>
       <strong>{s.title}</strong>
       <div className={css.sourceFooter}><span className={css.state}>{r?.actionId?"Linked to action":r?.status==="not-applicable"?"Reviewed · no action":r?.status==="action-required"?"Action required":r?.status==="investigating"?"Under review":previous?"New source revision":"Awaiting review"}</span><span>Review →</span></div>
      </button>
    })}</section>
   <section className={css.detail}>
    {!current?<div className={css.empty}>Select an official source to review its relevance.</div>:<>
     <div className={css.detailTop}><span className={css.agency}>{current.agency}</span><h2>{current.title}</h2><p>{current.description||"Read the publication to understand its requirements."}</p>
      <div className={css.meta}><span>Public update: {format(current.updatedAt)}</span><span>Current version: {format(sourceVersion(current))}</span></div>
      <a className={css.official} href={current.url} target="_blank" rel="noopener noreferrer">Read original GOV.UK publication <span>↗</span></a>
      <a className={css.official} style={{marginTop:10}} href={"/ai?sourceId="+encodeURIComponent(current.id)}>Prepare AI impact draft (private pilot) <span>↗</span></a>
     </div>
     {oldReview&&<p className={css.revision}>The recorded source version differs from an earlier review. Previous decisions do not automatically carry forward.</p>}
     <form onSubmit={save} className={css.form}>
      <div className={css.formHeading}><span>01</span><div><h3>Assess the impact</h3><p>Record the conclusion made by a person. RegPilot does not generate or approve it.</p></div></div>
      <label>Applicability decision<select value={draft.status} onChange={e=>setDraft(x=>({...x,status:e.target.value as ChangeReview["status"]}))}><option value="unreviewed">Not yet reviewed</option><option value="investigating">Investigating</option><option value="not-applicable">Not applicable — rationale required</option><option value="action-required">Action required</option></select></label>
      <label>Assessed potential impact<select value={draft.impact} onChange={e=>setDraft(x=>({...x,impact:e.target.value as ChangeReview["impact"]}))}><option value="unknown">Not assessed</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
      <div className={css.two}><label>Review owner<input maxLength={80} value={draft.owner} onChange={e=>setDraft(x=>({...x,owner:e.target.value}))} placeholder="e.g. Quality lead" required={draft.status==="action-required"}/></label><label>Target date<input type="date" value={draft.due} onChange={e=>setDraft(x=>({...x,due:e.target.value}))} required={draft.status==="action-required"}/></label></div>
      <label>Impact assessment / rationale<textarea rows={4} maxLength={500} value={draft.notes} onChange={e=>setDraft(x=>({...x,notes:e.target.value}))} placeholder="What does this potentially affect? Why is it applicable, or not applicable?" required={draft.status==="not-applicable"}/></label>
      <button type="submit" className={ui.primary}>Save human review</button>
     </form>
     <div className={css.convert}><div><span>02</span><div><h3>Move into operations</h3><p>Once an action-required assessment has been saved, create a traceable work item with the original source link.</p></div></div>
      <button type="button" className={css.convertButton} disabled={!saved||saved.status!=="action-required"||!!saved.actionId} onClick={convert}>{saved?.actionId?"Action already created":saved?.status==="action-required"?"Create linked work item →":"Complete a review first"}</button>
      {saved?.actionId&&<a href="/workbench" className={css.workLink}>Open work queue →</a>}
     </div>
    </>}
   </section>
  </div>
  <footer className={ui.footer}>Official-source pilot: metadata monitoring only · No background alerts, automated interpretation, audit-grade record or live multi-user storage.</footer>
 </main></div>;
}
