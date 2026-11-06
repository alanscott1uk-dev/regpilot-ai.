"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {REGULATORY_SOURCES} from "../../../lib/regulatory-sources.mjs";
import shell from "../../workbench/workbench.module.css";
import ui from "./sources.module.css";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Snapshot={id:string;organizationId:string;sourceId:string;title:string;url:string;contentHash:string;revisionAt:string|null;firstCapturedAt:string;lastCheckedAt:string;reviewStatus:"NEEDS_REVIEW"|"REVIEWED"|"NOT_APPLICABLE";reviewNotes:string;reviewedAt:string|null;reviewerId:string|null;capturedById:string;addedSnippets:string[];removedSnippets:string[];version:number};
type CheckResult={state:"BASELINE"|"UNCHANGED"|"CONTENT_CHANGED"|"COOLDOWN";note:string;snapshot:Snapshot;comparison:{state:string;changed:boolean;added:string[];removed:string[]}};
const dateLabel=(raw:string)=>new Date(raw).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const nextDate=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
export default function OfficialSourceHistory(){
 const [user,setUser]=useState<{id:string;email:string}|null>(null);
 const [organisations,setOrganisations]=useState<Org[]>([]),[orgId,setOrgId]=useState("");
 const [selected,setSelected]=useState(REGULATORY_SOURCES[0].id);
 const [history,setHistory]=useState<Snapshot[]>([]);
 const [lastResult,setLastResult]=useState<CheckResult|null>(null);
 const [reviewNotes,setReviewNotes]=useState("");
 const [decision,setDecision]=useState<"REVIEWED"|"NOT_APPLICABLE">("REVIEWED");
 const [owner,setOwner]=useState("Regulatory lead");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const request=useCallback(async(url:string,options:RequestInit={})=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw new Error("Sign in to the private workspace first");
  const response=await fetch(url,{...options,headers:{...options.headers,authorization:"Bearer "+token},cache:"no-store"});
  if(!response.ok){const body=await response.json().catch(()=>({error:"Request unavailable"}));throw new Error(body.error||"Source request unavailable");}
  return response.json();
 },[]);
 const loadHistory=useCallback(async(id:string)=>{
  if(!id)return;
  try{const body=await request("/api/workspace/sources?organizationId="+encodeURIComponent(id));setHistory(Array.isArray(body.snapshots)?body.snapshots:[]);}
  catch(e){setHistory([]);setMessage(e instanceof Error?e.message:"Source history unavailable")}
 },[request]);
 useEffect(()=>{
  let alive=true;
  async function session(){
   try{
    const token=(await browserAuth().auth.getSession()).data.session?.access_token;
    if(!token)return;
    const response=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+token},cache:"no-store"});
    if(!response.ok)throw new Error("Private workspace not configured");
    const body=await response.json();
    if(!alive)return;
    const list:Org[]=body.organisations||[];
    setUser({id:body.userId||"",email:body.email});setOrganisations(list);
    setOrgId(old=>list.some(x=>x.id===old)?old:list[0]?.id||"");
   }catch(e){if(alive)setMessage(e instanceof Error?e.message:"Sign in to use source history")}
  }
  try{const {data}=browserAuth().auth.onAuthStateChange(()=>setTimeout(()=>{if(alive)void session()},0));void session();return()=>{alive=false;data.subscription.unsubscribe()}}
  catch{setMessage("Supabase sign-in is not configured");return()=>{alive=false}}
 },[]);
 useEffect(()=>{setHistory([]);setLastResult(null);if(user&&orgId)void loadHistory(orgId)},[orgId,user?.id,loadHistory]);
 const currentOrg=organisations.find(x=>x.id===orgId);
 const activeSource=REGULATORY_SOURCES.find(x=>x.id===selected);
 const rows=useMemo(()=>history.filter(x=>x.sourceId===selected),[history,selected]);
 const latest=rows[0];
 const canCheck=currentOrg&&currentOrg.role!=="VIEWER";
 const canReview=currentOrg&&["OWNER","ADMIN"].includes(currentOrg.role);
 const pending=history.filter(x=>x.reviewStatus==="NEEDS_REVIEW").length;
 async function check(){
  if(!orgId)return;setBusy(true);setMessage("");
  try{
   const body:CheckResult=await request("/api/workspace/sources",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:orgId,sourceId:selected})});
   setLastResult(body);setMessage(body.note);
   await loadHistory(orgId);
  }catch(e){setMessage(e instanceof Error?e.message:"Could not check official publication")}
  finally{setBusy(false)}
 }
 async function review(){
  if(!latest)return;setBusy(true);setMessage("");
  try{
   const body=await request("/api/workspace/sources/"+encodeURIComponent(latest.id),{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,status:decision,notes:reviewNotes,version:latest.version})
   });
   setReviewNotes("");setMessage("Human source review recorded. This is not a legal compliance opinion.");
   await loadHistory(orgId);
  }catch(e){setMessage(e instanceof Error?e.message:"Review decision unavailable")}
  finally{setBusy(false)}
 }
 async function createAction(){
  if(!latest||!activeSource)return;setBusy(true);setMessage("");
  try{
   await request("/api/workspace/obligations",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,title:("Assess publication impact: "+latest.title).slice(0,160),
     category:"Regulatory intelligence",ownerName:owner.trim().slice(0,80),dueDate:nextDate(14),
     notes:"Review the actual GOV.UK publication text differences and identify any practical impact. A text change does NOT establish a new legal obligation.",
     sourceUrl:latest.url,sourceCheckedAt:nextDate(0)})});
   setMessage("A human-requested follow-up task was created in the private team queue.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not create a follow-up task")}
  finally{setBusy(false)}
 }
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a href="/workbench" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>REGULATORY SOURCE HISTORY</small></span></a>
   <div className={shell.sideCaption}>WORKSPACE</div>
   <nav className={shell.sideNav}><a href="/team">▤ &nbsp;Team tasks</a><a href="/team/evidence">▣ &nbsp;Evidence vault</a><a href="/intelligence">✦ &nbsp;Prototype intelligence</a><a className={shell.active} href="/team/sources" aria-current="page">◈ &nbsp;Source history</a><a href="/ai">◇ &nbsp;AI Studio</a></nav>
   <div className={shell.sideFoot}><strong>Publication checks</strong><p>Compares text from a small GOV.UK catalogue. It does not autonomously monitor all UK regulations or determine legal effects.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Private workspace / Official source history</span><span className={shell.demo}>MANUAL CHECK · STAGING PILOT</span></div>
   <header className={ui.hero}><div><span>REGPILOT / REGULATORY CHANGE INTELLIGENCE</span><h1>Know what changed.<br/><em>Verify what it means.</em></h1><p>Capture the text of an official publication, compare future versions and give every potential change a named reviewer.</p></div><div className={ui.heroGlyph}>✦</div></header>
   <div className={shell.warning}><strong>A changed publication is not automatically a changed law.</strong> This checks textual differences on a very small allowlisted GOV.UK catalogue. Human applicability and effective-date assessment are mandatory.</div>
   {message&&<div className={ui.notice} role="status">{message}</div>}
   {!user&&<div className={ui.card}>Sign in via the <a href="/team">private team workspace</a> before checking official sources.</div>}
   {user&&organisations.length>0&&<>
    <section className={ui.topCards}>
     <div><span>Saved publication versions</span><strong>{history.length}</strong></div><div><span>Awaiting human review</span><strong>{pending}</strong></div>
     <div><label>Organisation<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
    </section>
    <section className={ui.layout}>
     <div className={ui.catalog}><div className={ui.heading}><span>01 / GOV.UK CATALOGUE</span><h2>Choose a publication</h2><p>Only these predefined primary-source locations can be queried.</p></div>
      {REGULATORY_SOURCES.map(src=><button key={src.id} type="button" onClick={()=>{setSelected(src.id);setLastResult(null)}} className={selected===src.id?ui.selected:ui.source}>
       <span>{src.agency} · {src.topic}</span><strong>{src.title}</strong></button>)}
     </div>
     <div className={ui.detail}><div className={ui.heading}><span>02 / TEXT-BASED VERSION CHECK</span><h2>{activeSource?.title}</h2><p>Manual, versioned publication snapshots for your organisation.</p></div>
      <div className={ui.line}><a href={"https://www.gov.uk"+(activeSource?.path||"")} target="_blank" rel="noopener noreferrer">Open source on GOV.UK ↗</a>
       {canCheck&&<button type="button" disabled={busy} onClick={()=>void check()}>{busy?"Checking…":latest?"Compare latest text":"Create first baseline"}</button>}
      </div>
      {latest?<div className={ui.snapshot}><div className={ui.versionHead}><span>{latest.reviewStatus.replaceAll("_"," ")}</span><span>{latest.contentHash.slice(0,14)}…</span></div>
       <strong>Last text check: {dateLabel(latest.lastCheckedAt)}</strong><p>First captured {dateLabel(latest.firstCapturedAt)} · Source metadata revision {latest.revisionAt||"not stated"}</p>
       <div className={ui.deltas}>
        <div><h3>Added or changed passages</h3>{latest.addedSnippets?.length?latest.addedSnippets.map((s,i)=><blockquote key={i}>{s}</blockquote>):<p>No new text passages recorded for this baseline.</p>}</div>
        <div><h3>Removed or replaced passages</h3>{latest.removedSnippets?.length?latest.removedSnippets.map((s,i)=><blockquote key={i}>{s}</blockquote>):<p>No removed text passages recorded for this baseline.</p>}</div>
       </div>
       {canReview&&latest.reviewStatus==="NEEDS_REVIEW"&&latest.capturedById!==user.id&&<div className={ui.review}><h3>Record independent impact assessment</h3><label>Decision<select value={decision} onChange={e=>setDecision(e.target.value as "REVIEWED"|"NOT_APPLICABLE")}><option value="REVIEWED">Reviewed — assess follow-up</option><option value="NOT_APPLICABLE">Not applicable — rationale required</option></select></label><label>Review notes<textarea rows={3} minLength={20} maxLength={800} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)}/></label><button disabled={busy||reviewNotes.length<20} onClick={()=>void review()}>Save human review</button></div>}
       {latest.reviewStatus==="NEEDS_REVIEW"&&latest.capturedById===user.id&&<p className={ui.fine}>A different administrator must independently review this snapshot.</p>}
       {latest.reviewNotes&&<p className={ui.reviewed}>Recorded reviewer rationale: {latest.reviewNotes}</p>}
       {canCheck&&<div className={ui.task}><label>Follow-up owner<input maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label><button disabled={busy||!owner.trim()} onClick={()=>void createAction()}>Create manual follow-up task ↗</button></div>}
      </div>:<div className={ui.empty}>No official publication baseline stored for this organisation. A first check captures a reference point, not a finding of legal change.</div>}
      {lastResult&&<p className={ui.status}>Last request: {lastResult.state.replaceAll("_"," ")} · {lastResult.comparison.added.length} added passages · {lastResult.comparison.removed.length} removed passages</p>}
     </div>
    </section>
    <section className={ui.card}><div className={ui.heading}><span>03 / RECORDED HISTORY</span><h2>Previous versions for this source</h2><p>Past snapshots remain available even after later versions are captured.</p></div>
     <div className={ui.history}>{rows.length===0?<p>No history yet.</p>:rows.map(x=><div key={x.id}><span>{dateLabel(x.firstCapturedAt)}</span><strong>{x.contentHash.slice(0,18)}…</strong><small>{x.reviewStatus.replaceAll("_"," ")}</small></div>)}</div>
    </section>
   </>}
   <footer className={shell.footer}>RegPilot private source watcher · Manual publication checks, not continuous legal monitoring.</footer>
  </main>
 </div>;
}
