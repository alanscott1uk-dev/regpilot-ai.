"use client";
import WorkspaceNav from "../../components/workspace-nav";
import {TERRITORIES,SOURCE_ACTIVITIES,matchingSources,sourceNextStep,type SourceCoverage} from "../../../lib/regulatory/source-coverage";
import {officialSourceUrl} from "../../../lib/regulatory-sources.mjs";
import {recommendSourcePortfolio} from "../../../lib/regulatory/portfolio-recommendations.mjs";
import {useCallback,useEffect,useMemo,useState,useRef} from "react";
import {useWorkspaceContext,workspaceHref} from "../../../lib/client/workspace-context";
import EmailSignIn from "../../components/email-sign-in";
import {REGULATORY_SOURCES} from "../../../lib/regulatory-sources.mjs";
import shell from "../../workbench/workbench.module.css";
import ui from "./sources.module.css";
type Snapshot={id:string;organizationId:string;sourceId:string;title:string;url:string;contentHash:string;revisionAt:string|null;firstCapturedAt:string;lastCheckedAt:string;reviewStatus:"NEEDS_REVIEW"|"REVIEWED"|"NOT_APPLICABLE";reviewNotes:string;reviewedAt:string|null;reviewerId:string|null;capturedById:string;addedSnippets:string[];removedSnippets:string[];version:number};
type CheckResult={state:"BASELINE"|"UNCHANGED"|"CONTENT_CHANGED"|"COOLDOWN";note:string;snapshot:Snapshot;comparison:{state:string;changed:boolean;added:string[];removed:string[]}};
const dateLabel=(raw:string)=>new Date(raw).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const nextDate=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
export default function OfficialSourceHistory(){
 const workspace=useWorkspaceContext();
 const {organisations,organizationId:orgId,request,capture,chooseOrganization}=workspace;
 const user=workspace.signedIn?{id:workspace.userId,email:workspace.email}:null;
 const href=(path:string,values:Record<string,string>={})=>workspaceHref(path,orgId,values);
 const activeOrg=useRef(orgId);activeOrg.current=orgId;
 const [catalogue,setCatalogue]=useState([...REGULATORY_SOURCES]);
 const [selected,setSelected]=useState(REGULATORY_SOURCES[0].id);
 const deepLinkApplied=useRef(false);
 useEffect(()=>{if(deepLinkApplied.current)return;const requested=new URLSearchParams(window.location.search).get("sourceId");if(!requested){deepLinkApplied.current=true;return;}if(catalogue.some(x=>x.id===requested)){deepLinkApplied.current=true;setSelected(requested);}},[catalogue]);
 const activeSelection=useRef(selected);activeSelection.current=selected;
 const [storedCoverage,setCoverage]=useState<SourceCoverage[]>([]),[territory,setTerritory]=useState(""),[activity,setActivity]=useState(""),[search,setSearch]=useState("");
 const [businessProfile,setBusinessProfile]=useState<{activities:string[];jurisdictions:string[]}|null>(null);
 const [recommendedOnly,setRecommendedOnly]=useState(false);
 const recommendations=useMemo(()=>recommendSourcePortfolio(catalogue,businessProfile),[catalogue,businessProfile]);
 const filtered=useMemo(()=>{
  const ids=new Set(recommendations.suggested.map(x=>x.id));
  return matchingSources(catalogue,territory,activity,search).filter(s=>!recommendedOnly||ids.has(s.id));
 },[catalogue,territory,activity,search,recommendedOnly,recommendations]);
 const [storedHistory,setHistory]=useState<Snapshot[]>([]);
 const dataRevision=useRef(-1),history=dataRevision.current===workspace.revision?storedHistory:[],coverage=dataRevision.current===workspace.revision?storedCoverage:[];
 const [lastResult,setLastResult]=useState<CheckResult|null>(null);
 const [reviewNotes,setReviewNotes]=useState("");
 const [decision,setDecision]=useState<"REVIEWED"|"NOT_APPLICABLE">("REVIEWED");
 const [owner,setOwner]=useState("Regulatory lead");
 const [message,setMessage]=useState("");
 const [monitorEvery,setMonitorEvery]=useState<"24"|"168">("168");
 const [busy,setBusy]=useState(false),[historyLoading,setHistoryLoading]=useState(false),[uncertainRecovery,setUncertainRecovery]=useState(false);
 const [runtimeState,setRuntimeState]=useState<{state:string;reason:string;configured?:boolean;mode?:string;cadenceMinutes?:number|null}|null>(null);
 const historyRequest=useRef(0),recoveryRequest=useRef(false);
 const blocked=busy||historyLoading||uncertainRecovery;
 useEffect(()=>{
  let active=true;const current=capture();setBusinessProfile(null);setRecommendedOnly(false);
  if(!orgId)return;
  void request("/api/workspace/intelligence/profile?organizationId="+encodeURIComponent(orgId)).then(body=>{
   if(active&&current()){const p=body.profile;if(p&&Array.isArray(p.activities)&&Array.isArray(p.jurisdictions))setBusinessProfile({activities:p.activities,jurisdictions:p.jurisdictions});}
  }).catch(()=>{if(active)setBusinessProfile(null)});
  return()=>{active=false};
 },[orgId,workspace.revision,request,capture]);
 const automatic=filtered.filter(source=>source.refreshMode!=="manual");
 const loadHistory=useCallback(async(id:string)=>{
  if(!id)return false;const valid=capture(),ticket=++historyRequest.current;
  const current=()=>valid()&&historyRequest.current===ticket&&activeOrg.current===id&&activeSelection.current===selected;
  setHistoryLoading(true);
  try{
   const body=await request("/api/workspace/sources?organizationId="+encodeURIComponent(id)+"&sourceId="+encodeURIComponent(selected));
   if(!current())return false;
   if(!Array.isArray(body.coverage)||!Array.isArray(body.snapshots)||body.organizationId&&body.organizationId!==id)throw new Error("The saved source status could not be verified.");
   dataRevision.current=workspace.revision;setCoverage(body.coverage);setHistory(body.snapshots);setCatalogue(body.catalogue||[...REGULATORY_SOURCES]);setRuntimeState(body.monitoringRuntime||null);setUncertainRecovery(false);return true;
  }catch(e){if(current()){setCoverage([]);setHistory([]);setRuntimeState(null);setMessage(e instanceof Error?e.message:"Source history unavailable")}return false;}
  finally{if(current())setHistoryLoading(false);}
 },[request,selected,capture,workspace.revision]);
 useEffect(()=>{historyRequest.current++;recoveryRequest.current=false;setHistory([]);setCoverage([]);setRuntimeState(null);setLastResult(null);setReviewNotes("");setMessage("");setBusy(false);setHistoryLoading(false);setUncertainRecovery(false);setCatalogue([...REGULATORY_SOURCES]);if(workspace.signedIn&&orgId)void loadHistory(orgId);return()=>{historyRequest.current++};},[orgId,workspace.userId,workspace.revision,loadHistory]);
 const currentOrg=organisations.find(x=>x.id===orgId);
 const activeSource=catalogue.find(x=>x.id===selected);
 const rows=useMemo(()=>history.filter(x=>x.sourceId===selected),[history,selected]);
 const latest=rows[0];
 const canCheck=currentOrg&&currentOrg.role!=="VIEWER";
 const canReview=currentOrg&&["OWNER","ADMIN"].includes(currentOrg.role);
 const pending=coverage.filter(x=>x.reviewStatus==="NEEDS_REVIEW").length;
 const selectedCoverage=coverage.find(x=>x.sourceId===selected);
 async function recordManualCheck(){
  if(blocked||!selectedCoverage||activeSource?.refreshMode!=="manual")return;
  const valid=capture(),id=orgId,sourceId=selected;
  const current=()=>valid()&&activeOrg.current===id&&activeSelection.current===sourceId;
  setBusy(true);setMessage("");
  try{
   await request("/api/workspace/sources",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:id,sourceId,action:"recordManualCheck",confirmed:true,previousId:selectedCoverage.manualCheck?.id??null})});
   if(current()&&await loadHistory(id)&&current())setMessage("Manual publication check recorded.");
  }catch(e){if(current())setMessage(e instanceof Error?e.message:"Manual check could not be recorded.");}
  finally{if(valid())setBusy(false);}
 }
 async function check(){
  if(!orgId||blocked)return;const current=capture();setBusy(true);setMessage("");
  try{
   const body:CheckResult=await request("/api/workspace/sources",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:orgId,sourceId:selected})});
   if(!current())return;setLastResult(body);setMessage(body.note);
   await loadHistory(orgId);
  }catch(e){if(current())setMessage(e instanceof Error?e.message:"Could not check official publication")}
  finally{if(current())setBusy(false)}
 }
 async function retryMonitoring(){
  const schedule=selectedCoverage?.schedule;if(!orgId||blocked||recoveryRequest.current||!schedule?.retryAvailable||typeof schedule.version!=="number")return;
  const current=capture(),submitted=orgId,source=selected;recoveryRequest.current=true;setBusy(true);setMessage("");
  try{
   await request("/api/workspace/monitoring/retry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:submitted,sourceId:source,version:schedule.version})});
   if(!current()||activeOrg.current!==submitted||activeSelection.current!==source)return;
   if(await loadHistory(submitted)&&current())setMessage("Recovery requested. The previous failure stays recorded until a check completes successfully.");
   else if(current()){setUncertainRecovery(true);setMessage("The request was accepted, but its saved status could not be refreshed. Check saved monitoring status before trying again.");}
  }catch(e){if(current()&&activeOrg.current===submitted&&activeSelection.current===source){setUncertainRecovery(true);setMessage((e instanceof Error?e.message:"The recovery result could not be confirmed.")+" The request may have been saved. Check saved monitoring status before another request.");}}
  finally{if(current()){recoveryRequest.current=false;setBusy(false);}}
 }
 async function refreshMonitoring(){
  if(!orgId||busy||historyLoading)return;const current=capture();setMessage("");
  if(await loadHistory(orgId)&&current())setMessage("Latest saved source and monitoring status loaded. No collection or recovery request was repeated.");
 }
 async function review(){
  if(!latest||blocked)return;const current=capture();setBusy(true);setMessage("");
  try{
   const body=await request("/api/workspace/sources/"+encodeURIComponent(latest.id),{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,status:decision,notes:reviewNotes,version:latest.version})
   });
   if(!current())return;setReviewNotes("");setMessage("Human source review recorded. This is not a legal compliance opinion.");
   await loadHistory(orgId);
  }catch(e){if(current())setMessage(e instanceof Error?e.message:"Review decision unavailable")}
  finally{if(current())setBusy(false)}
 }
 async function monitorPortfolio(){
  if(!orgId||blocked)return;const current=capture();
  if(!automatic.length||automatic.length>30){setMessage("Filter to between 1 and 30 publications before enabling portfolio monitoring.");return;}
  setBusy(true);setMessage("");
  try{
   const result=await request("/api/workspace/monitoring/portfolio",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({organizationId:orgId,sourceIds:automatic.map(s=>s.id),enabled:true,intervalHours:Number(monitorEvery)})});
   if(!current())return;setMessage(result.created+" new, "+result.updated+" updated, "+result.unchanged+" already scheduled. Collection starts only when the secure worker is enabled.");
   await loadHistory(orgId);
  }catch(e){if(current())setMessage(e instanceof Error?e.message:"Could not configure the monitoring portfolio");}
  finally{if(current())setBusy(false);}
 }
 async function createAction(){
  if(!latest||!activeSource||blocked)return;const current=capture();setBusy(true);setMessage("");
  try{
   await request("/api/workspace/obligations",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,title:("Assess publication impact: "+latest.title).slice(0,160),
     category:"Regulatory intelligence",ownerName:owner.trim().slice(0,80),dueDate:nextDate(14),
     notes:"Review the actual official publication text differences and identify any practical impact. A text change does NOT establish a new legal obligation.",
     sourceUrl:latest.url,sourceCheckedAt:nextDate(0)})});
   if(!current())return;setMessage("A human-requested follow-up task was created in the private team queue.");
  }catch(e){if(current())setMessage(e instanceof Error?e.message:"Could not create a follow-up task")}
  finally{if(current())setBusy(false)}
 }
 return <div className={shell.app}>
  <WorkspaceNav/>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Private workspace / Official source history</span><span className={shell.demo}>PRIVATE SOURCE REVIEW</span></div>
   <header className={ui.hero}><div><span>REGPILOT / REGULATORY CHANGE INTELLIGENCE</span><h1>Know what changed.<br/><em>Verify what it means.</em></h1><p>Capture the text of an official publication, compare future versions and give every potential change a named reviewer.</p></div><div className={ui.heroGlyph}>✦</div></header>
   <div className={shell.warning}><strong>A changed publication is not automatically a changed law.</strong> This checks textual differences on your selected official publications. Human applicability and effective-date assessment are mandatory.</div>
   {(message||workspace.error)&&<div className={ui.notice} role="status">{message||workspace.error}</div>}
   {historyLoading&&<p className={ui.notice} role="status">Loading saved publication and monitoring status…</p>}
   {orgId&&<div className={ui.monitoringActions}><a href={href('/team/coverage')}>View monitoring health →</a><button type="button" disabled={busy||historyLoading} onClick={()=>void refreshMonitoring()}>{uncertainRecovery?"Check saved monitoring status":"Refresh source status"}</button></div>}
   {!user&&!workspace.loading&&<div className={ui.card}><EmailSignIn destination="/team/sources"/></div>}
   {user&&!orgId&&<section className={ui.card}><h2>{organisations.length?'Choose your organisation':'Create your organisation'}</h2>{organisations.length?<label>Organisation<select aria-label="Organisation" value="" onChange={e=>chooseOrganization(e.target.value)}><option value="" disabled>Choose an organisation</option>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>:<a href={href('/team/setup')}>Set up your workspace →</a>}</section>}
   {user&&orgId&&organisations.length>0&&<>
    <section className={ui.topCards}>
     <div><span>Sources with a baseline</span><strong>{coverage.filter(x=>x.snapshotId).length} / {catalogue.length}</strong></div><div><span>Awaiting human review</span><strong>{pending}</strong></div>
     <div><label>Organisation<select aria-label="Organisation" disabled={blocked} value={orgId} onChange={e=>{setHistory([]);setCoverage([]);setLastResult(null);chooseOrganization(e.target.value);}}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
    </section>
    <section className={ui.layout}>
     <div className={ui.catalog}><div className={ui.heading}><span>01 / OFFICIAL SOURCE CATALOGUE</span><h2>Choose a publication</h2><a href={href('/team/library')}>Find and register publications ↗</a><p>Find a relevant starting point. Territory and topic tags do not determine legal applicability; unclassified publications remain visible.</p></div>
      <div className={ui.filters}>
      <div style={{background:"#f8f5fc",border:"1px solid #dfd2eb",padding:12,borderRadius:10,marginBottom:11}}>
       <strong style={{display:"block",fontSize:13}}>Recommended source starting points</strong>
       {businessProfile?<><p style={{fontSize:12}}>{recommendations.suggested.length} references share business activity and territory discovery tags. {recommendations.differentTerritory.length} have different territory tags; {recommendations.uncategorised.length} are unclassified and remain available manually.</p>
       <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12}}>
       <input type="checkbox" checked={recommendedOnly} onChange={e=>setRecommendedOnly(e.target.checked)} />
       Show my suggested starting points only
       </label><p style={{fontSize:11}}>These are suggestions for review, not verified duties or exemptions. Inspect every original publication before enabling a monitor.</p></>
        :<p style={{fontSize:12}}>Declare your activities and UK nations in <a href={href('/team/intelligence')}>Regulatory intelligence</a> to find relevant starting points. Unclassified publications remain visible.</p>}
      </div><label>Business location<select value={territory} onChange={e=>setTerritory(e.target.value)}><option value="">All locations</option>{TERRITORIES.map(t=><option key={t}>{t}</option>)}</select></label><label>Activity<select value={activity} onChange={e=>setActivity(e.target.value)}><option value="">All activities</option>{Object.entries(SOURCE_ACTIVITIES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Find a publication<input type="search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/></label><p>{filtered.length} references shown. {coverage.filter(x=>!x.snapshotId).length} catalogue references have no saved baseline.</p>
 {canReview&&<div className={ui.review} style={{padding:12,marginTop:8}}>
  <strong style={{display:"block",fontSize:13,marginBottom:7}}>Monitor this filtered source portfolio</strong>
  <label style={{display:"block",fontSize:12}}>Check frequency<select value={monitorEvery} onChange={e=>setMonitorEvery(e.target.value as "24"|"168")}>
   <option value="168">Weekly</option><option value="24">Daily</option></select></label>
  <button type="button" disabled={blocked||automatic.length<1||automatic.length>30} onClick={()=>void monitorPortfolio()}>
   {busy?"Saving…":"Enable monitoring for "+automatic.length+" shown source(s)"}</button>
  <p style={{fontSize:11}}>Choose a location, industry or search to limit selection to 30. Official text checks require an activated scheduler; source changes still require human interpretation.</p>
 </div>}</div>
      {filtered.length===0&&<p>No references match these filters. This does not mean no requirements apply.</p>}
      {filtered.map(src=><button key={src.id} type="button" disabled={blocked} onClick={()=>{setSelected(src.id);setLastResult(null)}} className={selected===src.id?ui.selected:ui.source}>
       <span>{src.agency} · {src.topic}</span><strong>{src.title}</strong><small>{src.jurisdictions?.join(", ")||"Territory scope needs review"}</small><small>{sourceNextStep(coverage.find(x=>x.sourceId===src.id))}</small></button>)}
     </div>
     <div className={ui.detail}><div className={ui.heading}><span>02 / TEXT-BASED VERSION CHECK</span><h2>{activeSource?.title}</h2><p>{activeSource?.kind||"Publication reference"} · {activeSource?.jurisdictions?.join(", ")||"Confirm territory and exceptions in the original"}</p><p>{activeSource?.scopeNote||"Selected publication only; linked publications and attachments are separate references."}</p><p><strong>{sourceNextStep(selectedCoverage)}</strong> · {selectedCoverage?.monitoring||"Monitoring status unavailable"}</p><p><a href={href('/team/intelligence',{sourceId:selected})}>Assess business applicability ↗</a> · <a href={href('/team/library')}>Review requirements and control relationships ↗</a></p></div>
      {selectedCoverage?.schedule&&<section className={ui.status} aria-label="Source monitoring status">
       <h3>{selectedCoverage.schedule.recoveryPending?"Recovery requested — waiting for a completed check":selectedCoverage.schedule.checking?"A source check is in progress":selectedCoverage.schedule.failureCode?"This source needs attention":"Saved monitoring schedule"}</h3>
       <p>{selectedCoverage.schedule.enabled?"Checks are scheduled every "+(selectedCoverage.schedule.intervalHours===24?"day":"week")+".":"This schedule is paused."} {runtimeState?runtimeState.reason:"Runtime execution has not been verified on this screen."}</p>
       {runtimeState?.configured&&<p>{runtimeState.mode==="cron"?"The daily trigger is scheduled for 06:00 UTC.":"The worker is expected every "+(runtimeState.cadenceMinutes||30)+" minutes."} A recovery request waits for an available run.</p>}
       <p>Last successful scheduled check: {selectedCoverage.schedule.lastSuccessAt?new Date(selectedCoverage.schedule.lastSuccessAt).toLocaleString("en-GB"):"None recorded"}. {selectedCoverage.schedule.enabled&&<>Next due: {new Date(selectedCoverage.schedule.nextCheckAt).toLocaleString("en-GB")}.</>}</p>
       {selectedCoverage.schedule.failureCode&&<><p>The previous issue stays recorded until collection succeeds.</p><details><summary>Recorded issue</summary><p>Reason: {selectedCoverage.schedule.failureCode} · Attempts: {selectedCoverage.schedule.attempts}</p></details></>}
       {selectedCoverage.schedule.retryReason&&!selectedCoverage.schedule.retryAvailable&&<p>{selectedCoverage.schedule.retryReason}</p>}
       {canReview&&selectedCoverage.schedule.retryAvailable&&<button type="button" disabled={blocked} onClick={()=>void retryMonitoring()}>Request recovery</button>}
       <a href={href('/team/coverage')}>Inspect monitoring history and service status →</a>
      </section>}
      <div className={ui.line}><a href={activeSource?officialSourceUrl(activeSource):"/team/sources"} target="_blank" rel="noopener noreferrer">Open official source ↗</a>{activeSource?.officialDocuments&&<a href={activeSource.officialDocuments} target="_blank" rel="noreferrer">Publisher’s downloadable edition ↗</a>}
       {canCheck&&<button type="button" disabled={blocked} onClick={()=>void check()}>{busy?"Checking…":activeSource?.refreshMode==="manual"?"Refresh official text manually":latest?"Compare latest text":"Create first baseline"}</button>}
      </div>
      {activeSource?.refreshMode==="manual"&&<section aria-label="Manual publication check" className={ui.status}>
       <h3>Manual refresh</h3><p>Open the Scottish Government publication or its downloadable edition. After reading it, record your check here.</p>
       <p>{selectedCoverage?.manualCheck?'Last manual check · '+new Date(selectedCoverage.manualCheck.at).toLocaleString('en-GB')+' · '+selectedCoverage.manualCheck.by:'No manual check recorded.'}</p>
       {canCheck&&<button type="button" disabled={blocked||!selectedCoverage} onClick={()=>void recordManualCheck()}>I checked the official publication</button>}
      </section>}
      {latest?<div className={ui.snapshot}><div className={ui.versionHead}><span>{latest.reviewStatus.replaceAll("_"," ")}</span><span>{latest.contentHash.slice(0,14)}…</span></div>
       <strong>Last text check: {dateLabel(latest.lastCheckedAt)}</strong><p>First captured {dateLabel(latest.firstCapturedAt)} · Source metadata revision {latest.revisionAt||"not stated"}</p>
       <div className={ui.deltas}>
        <div><h3>Added or changed passages</h3>{latest.addedSnippets?.length?latest.addedSnippets.map((s,i)=><blockquote key={i}>{s}</blockquote>):<p>No new text passages recorded for this baseline.</p>}</div>
        <div><h3>Removed or replaced passages</h3>{latest.removedSnippets?.length?latest.removedSnippets.map((s,i)=><blockquote key={i}>{s}</blockquote>):<p>No removed text passages recorded for this baseline.</p>}</div>
       </div>
       {canReview&&latest.reviewStatus==="NEEDS_REVIEW"&&latest.capturedById!==user.id&&<div className={ui.review}><h3>Record independent impact assessment</h3><label>Decision<select value={decision} onChange={e=>setDecision(e.target.value as "REVIEWED"|"NOT_APPLICABLE")}><option value="REVIEWED">Reviewed — assess follow-up</option><option value="NOT_APPLICABLE">Not applicable — rationale required</option></select></label><label>Review notes<textarea rows={3} minLength={20} maxLength={800} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)}/></label><button disabled={blocked||reviewNotes.length<20} onClick={()=>void review()}>Save human review</button></div>}
       {latest.reviewStatus==="NEEDS_REVIEW"&&latest.capturedById===user.id&&<p className={ui.fine}>A different administrator must independently review this snapshot.</p>}
       {latest.reviewNotes&&<p className={ui.reviewed}>Recorded reviewer rationale: {latest.reviewNotes}</p>}
       {canCheck&&<div className={ui.task}><label>Follow-up owner<input maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label><button disabled={blocked||!owner.trim()} onClick={()=>void createAction()}>Create manual follow-up task ↗</button></div>}
      </div>:<div className={ui.empty}>No official publication baseline stored for this organisation. A first check captures a reference point, not a finding of legal change.</div>}
      {lastResult&&<p className={ui.status}>Last request: {lastResult.state.replaceAll("_"," ")} · {lastResult.comparison.added.length} added passages · {lastResult.comparison.removed.length} removed passages</p>}
     </div>
    </section>
    <section className={ui.card}><div className={ui.heading}><span>03 / RECORDED HISTORY</span><h2>Previous versions for this source</h2><p>Past snapshots remain available even after later versions are captured.</p></div>
     <div className={ui.history}>{rows.length===0?<p>No history yet.</p>:rows.map(x=><div key={x.id}><span>{dateLabel(x.firstCapturedAt)}</span><strong>{x.contentHash.slice(0,18)}…</strong><small>{x.reviewStatus.replaceAll("_"," ")}</small></div>)}</div>
    </section>
   </>}
   <footer className={shell.footer}>RegPilot private source watcher · Selected publication checks and separately configured schedules; not a complete legal register.</footer>
  </main>
 </div>;
}
