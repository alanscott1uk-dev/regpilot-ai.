"use client";
import WorkspaceNav from "../../components/workspace-nav";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {useWorkspaceContext,workspaceHref} from "../../../lib/client/workspace-context";
import EmailSignIn from "../../components/email-sign-in";
import type {SourceCoverage} from "../../../lib/regulatory/source-coverage";
import type {RegulatorySource} from "../../../lib/regulatory-sources.mjs";
import {coverageDashboard,exportCoverageCsv} from "../../../lib/regulatory/coverage-dashboard.mjs";
import {matchesPublicationText} from "../../../lib/regulatory/publication-query.mjs";
import {ConnectionMonitoring} from "./connection-monitoring";
import shell from "../../workbench/workbench.module.css";
import css from "./coverage.module.css";
type Runtime={configured:boolean;mode:"worker"|"cron"|"both"|"inactive";state:string;lastStartedAt:string|null;lastFinishedAt:string|null;lastSuccessfulAt:string|null;cadenceMinutes:number|null;staleAfterMinutes:number|null;reason:string};
type Feed={organizationId?:string;catalogue:RegulatorySource[];coverage:SourceCoverage[];monitoringRuntime?:Runtime};
type Schedule=NonNullable<SourceCoverage["schedule"]>&{state?:string;lastAttemptAt?:string|null;checking?:boolean;recoveryPending?:boolean;retryAvailable?:boolean;retryReason?:string|null;history?:{id:string;at:string;action:string;outcome:string|null;failureCode:string|null;attempt:number|null;paused:boolean|null}[];historyLimited?:boolean};
const runtimeLabels:Record<string,string>={inactive:"Monitoring awaits activation","never-observed":"No worker run observed",stale:"Worker check-in overdue",running:"A monitoring run is in progress",degraded:"The latest monitoring run needs attention",healthy:"Recent monitoring run recorded"};
const runtimeDetails:Record<string,string>={inactive:"Schedules are saved, but the monitoring service and its trigger are not both configured. An administrator must activate and verify them before scheduled collection can run.","never-observed":"The service is configured, but there is no recorded execution yet. A saved schedule does not establish that collection is running.",stale:"No recent worker execution was recorded within the expected window. Review the service and trigger before relying on future scheduled checks.",running:"A worker has started and has not yet reported completion. Individual source results below remain separate from this runtime status.",degraded:"A worker execution failed or was interrupted. Inspect the individual source results below.",healthy:"A recent worker execution completed. Each publication still needs its own successful, timely collection and any required independent review."};
const stateLabel:Record<string,string>={failed:"Collection failed",overdue:"Watch overdue",stale:"Source stale",current:"Recently checked",
 checking:"Checking source","recovery-pending":"Recovery pending","never-checked":"Awaiting first check","awaiting-activation":"Not activated",paused:"Paused",unmonitored:"Not monitored","manual-refresh":"Manual refresh"};
const states=[["all","All sources"],["attention","Needs attention"],["failed","Failed"],["checking","Checking"],["recovery-pending","Recovery pending"],["overdue","Overdue"],["stale","Stale"],["review","Needs human review"],["current","Checked recently"],["unmonitored","Unmonitored"],["manual-refresh","Manual refresh"],["awaiting-activation","Not activated"]] as const;
const format=(s:string|null)=>s&&!Number.isNaN(Date.parse(s))?new Date(s).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Never";
function saveCsv(value:string){const url=URL.createObjectURL(new Blob([value],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="regpilot-source-monitoring-coverage.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
export default function Coverage(){
 const workspace=useWorkspaceContext();
 const {organisations:orgs,organizationId:orgId,request,capture,chooseOrganization}=workspace;
 const href=(path:string,values:Record<string,string>={})=>workspaceHref(path,orgId,values);
 const [stored,setStored]=useState<{revision:number;feed:Feed}|null>(null);
 const feed=stored?.revision===workspace.revision?stored.feed:null;
 const [loading,setLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[term,setTerm]=useState(""),[status,setStatus]=useState("attention"),[agency,setAgency]=useState("all");
 const [pending,setPending]=useState(""),[uncertain,setUncertain]=useState(false);
 const [connectionRefresh,setConnectionRefresh]=useState(0);
 const serial=useRef(0),mutation=useRef(false);
 const load=useCallback(async()=>{
  if(!orgId)return false;
  const valid=capture(),revision=workspace.revision,ticket=++serial.current;
  const current=()=>valid()&&serial.current===ticket;
  setLoading(true);setError("");
  try {
   const sources=await request("/api/workspace/sources?organizationId="+encodeURIComponent(orgId));
   if(!current())return false;
   if(!Array.isArray(sources.catalogue)||!Array.isArray(sources.coverage)||(sources.organizationId&&sources.organizationId!==orgId))throw Error("Could not verify the latest source monitoring status.");
   setStored({revision,feed:sources});
  }catch(problem){
   if(!current())return false;
   setStored(null);setError(problem instanceof Error?problem.message:"Could not retrieve source monitoring status.");setLoading(false);return false;
  }
  setLoading(false);setUncertain(false);return true;
 },[orgId,workspace.revision,request,capture]);
 useEffect(()=>{
  serial.current++;mutation.current=false;setStored(null);setError("");setNotice("");setPending("");setUncertain(false);setLoading(false);
  if(workspace.signedIn&&orgId)void load();
  return()=>{serial.current++};
 },[workspace.signedIn,orgId,workspace.revision,load]);
 async function refresh(){
  if(mutation.current||loading)return;
  const valid=capture();setNotice("");setConnectionRefresh(value=>value+1);
  if(await load()&&valid())setNotice("Latest saved monitoring status loaded. Refreshing does not run a source check or repeat a recovery request.");
 }
 async function recover(sourceId:string){
  const schedule=feed?.coverage.find(c=>c.sourceId===sourceId)?.schedule as Schedule|undefined;
  if(!orgId||!schedule?.retryAvailable||typeof schedule.version!=="number"||mutation.current||loading||uncertain)return;
  const valid=capture();mutation.current=true;setPending(sourceId);setError("");setNotice("");
  try{
   await request("/api/workspace/monitoring/retry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:orgId,sourceId,version:schedule.version})});
   if(!valid())return;
   if(await load()&&valid())setNotice("Recovery requested. The previous failure stays recorded until a check completes successfully. Review the saved status below.");
   else if(valid()){setUncertain(true);setNotice("The request was accepted, but the saved status could not be refreshed. Check saved monitoring status before making another request.");}
  }catch(e){if(valid()){setUncertain(true);setError(e instanceof Error?e.message:"The recovery result could not be confirmed.");setNotice("The request may have been saved. Check saved monitoring status before making another request.");}}
  finally{if(valid()){mutation.current=false;setPending("");}}
 }
 const schedules=useMemo(()=>new Map((feed?.coverage||[]).map(c=>[c.sourceId,c.schedule as Schedule|undefined])),[feed]);
 const runtime=feed?.monitoringRuntime;
 const dashboard=useMemo(()=>feed?coverageDashboard(feed.catalogue,feed.coverage):null,[feed]);
 const results=useMemo(()=>dashboard?.rows.filter(s=>{
  const pass=status==="all"||status==="attention"&&s.attention||status==="review"&&s.reviewNeeded||s.status===status;
  return pass&&(agency==="all"||s.agency===agency)&&matchesPublicationText([s.title,s.agency,s.topic,s.id,...s.activities].join(" "),term);
 })||[],[dashboard,status,agency,term]);
 const summary=dashboard?.summary;
 const currentOrg=orgs.find(x=>x.id===orgId),admin=!!currentOrg&&["OWNER","ADMIN"].includes(currentOrg.role);
 const busy=loading||!!pending;
 return <div className={shell.app}>
  <WorkspaceNav/>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Regulatory intelligence / Source health</span><span className={shell.demo}>PRIVATE PILOT</span></div>
   <header className={css.hero}><span className={css.overline}>REGPILOT / CONTINUOUS COVERAGE</span><h1>See what's covered.<br/><em>Know what still needs attention.</em></h1><p>One operational view of publication freshness, failed checks, unreviewed changes and monitoring gaps. Nothing here assumes an organisation is legally compliant.</p></header>
   {(error||workspace.error)&&<p className={css.error} role="alert">{error||workspace.error}</p>}
   {notice&&<p className={css.loading} role="status">{notice}</p>}
   {(loading||workspace.loading)&&<p role="status" className={css.loading}>Loading source health and current review evidence…</p>}
   {!workspace.signedIn&&!workspace.loading&&<section className={css.source}><EmailSignIn destination="/team/coverage"/></section>}
   {workspace.signedIn&&!orgs.length&&!workspace.loading&&<section className={css.source}><h2>Create your organisation</h2><a href={href("/team/setup")}>Set up your workspace →</a></section>}
   {!!orgs.length&&<div className={css.toolbar}>
    <label>Organisation<select aria-label="Organisation" value={orgId} disabled={!!pending} onChange={e=>chooseOrganization(e.target.value)}><option value="" disabled>Choose an organisation</option>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
    <div className={css.actions}>{orgId&&<><a href={href("/team/sources")} className={css.primary}>Manage source portfolio</a><button type="button" disabled={busy} onClick={()=>void refresh()}>{uncertain?"Check saved monitoring status":"Refresh monitoring status"}</button><button type="button" disabled={!dashboard||busy||uncertain} onClick={()=>{const valid=capture();if(dashboard&&feed&&valid())saveCsv(exportCoverageCsv(dashboard.rows));}}>Export source-health CSV</button></>}</div>
   </div>}
   {dashboard&&<>
   <section className={css.runtime} aria-label="Monitoring runtime" data-state={runtime?.state||"unknown"}>
    <div><span className={css.overline}>SERVICE EXECUTION</span><h2>{runtimeLabels[runtime?.state||""]||"Monitoring runtime status unavailable"}</h2><p>{runtimeDetails[runtime?.state||""]||"The latest service execution could not be verified. Saved schedules and source history remain separate from an observed running service."}</p></div>
    <dl><div><dt>Latest start</dt><dd>{format(runtime?.lastStartedAt||null)}</dd></div><div><dt>Latest completion</dt><dd>{format(runtime?.lastFinishedAt||null)}</dd></div><div><dt>Last successful run</dt><dd>{format(runtime?.lastSuccessfulAt||null)}</dd></div></dl>
    {runtime?.configured&&<p className={css.runtimeNote}>{runtime.mode==="cron"?"Scheduled trigger: daily at 06:00 UTC.":runtime.mode==="both"?"Worker expected every 30 minutes, with a daily scheduled trigger at 06:00 UTC.":"Worker expected every "+(runtime.cadenceMinutes||30)+" minutes."} Recovery requests wait for an available run; requesting recovery does not perform an immediate check.</p>}
    {runtime&&<p className={css.runtimeNote}>{runtime.reason} Runtime execution does not approve source changes.</p>}
   </section>
   <div className={css.metrics}>
    <button onClick={()=>setStatus("all")}><small>Curated publications</small><strong>{summary?.listed}</strong><span>Not a complete legislative library</span></button>
    <button onClick={()=>setStatus("current")}><small>Checked recently</small><strong>{summary?.current}</strong><span>Successful scheduled retrieval</span></button>
    <button onClick={()=>setStatus("attention")}><small>Need attention</small><strong>{summary?.attention}</strong><span>Failed, overdue or review pending</span></button>
    <button onClick={()=>setStatus("review")}><small>Human source review</small><strong>{summary?.reviewNeeded}</strong><span>Publication evidence needs decision</span></button>
    <button onClick={()=>setStatus("unmonitored")}><small>Unmonitored</small><strong>{dashboard.states.unmonitored||0}</strong><span>No watch is configured</span></button>
   </div>
   <p className={css.disclaimer}>{dashboard.caveat} A configured schedule only counts as current after a successful, timely collection. Latest snapshot age is separate from source change significance.</p>
   <section className={css.results}>
    <div className={css.heading}><div><h2>Publication health</h2><small>{results.length} displayed · Check date, action required and monitoring state</small></div><div className={css.filters}>
     <input type="search" aria-label="Search publications" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Find regulator, publication, or topic"/>
     <select aria-label="Filter operational status" value={status} onChange={e=>setStatus(e.target.value)}>{states.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>
     <select aria-label="Filter publishing agency" value={agency} onChange={e=>setAgency(e.target.value)}><option value="all">All publishers</option>{dashboard.agencies.map(a=><option value={a.agency} key={a.agency}>{a.agency}</option>)}</select>
    </div></div>
    <div className={css.records}>{results.length===0?<p className={css.empty}>No publications match these filters. This is not evidence of legal completeness.</p>:results.map(s=>{const schedule=schedules.get(s.id);return <article key={s.id} className={css.source} aria-label={s.title}>
     <div className={css.sourceTop}><span>{s.agency} · {s.topic}</span><span data-state={s.status} className={css.state}>{stateLabel[s.status]||s.status}</span></div>
     <h3>{s.title}</h3><p>{s.detail}</p>
     {schedule?.recoveryPending&&<p className={css.review} role="status">Recovery requested — waiting for a completed check. The previous failure stays visible until successful collection.</p>}
     {schedule?.checking&&<p role="status">A source check is in progress. Refresh status after it finishes.</p>}
     {s.reviewNeeded&&<p className={css.review}>Human interpretation outstanding. Do not treat the publication text as an accepted legal obligation.</p>}
     <div className={css.sourceMeta}><span>Text baseline: <b>{s.baseline?"Recorded":"Missing"}</b></span><span>Last successful watch: <b>{format(s.lastSuccessAt)}</b></span><span>Independent review: <b>{s.reviewStatus.replaceAll("_"," ").toLowerCase()}</b></span>{schedule&&<><span>Last attempt: <b>{format(schedule.lastAttemptAt||null)}</b></span><span>{schedule.recoveryPending?"Recovery due":"Next scheduled check"}: <b>{schedule.enabled?format(schedule.nextCheckAt):"Paused"}</b></span></>}</div>
     {schedule?.failureCode&&<p className={css.failure}>Last recorded issue: {schedule.failureCode.replaceAll("_"," ").toLowerCase()}.</p>}
     {schedule?.retryReason&&!schedule.retryAvailable&&!schedule.recoveryPending&&<p className={css.recoveryHint}>{schedule.retryReason}</p>}
     {admin&&schedule?.retryAvailable&&<button className={css.recover} disabled={busy||uncertain} onClick={()=>void recover(s.id)}>{pending===s.id?"Requesting recovery…":"Request recovery"}</button>}
     {!!schedule?.history?.length&&<details className={css.attempts}><summary>Recent monitoring activity</summary><ol>{schedule.history.map(event=><li key={event.id}><strong>{event.action.replace(/^monitoring\./,"").replaceAll("_"," ")}</strong><span>{format(event.at)}{event.outcome?" · "+event.outcome.toLowerCase().replaceAll("_"," "):""}</span>{event.failureCode&&<span>Recorded issue: {event.failureCode.toLowerCase().replaceAll("_"," ")}</span>}</li>)}</ol>{schedule.historyLimited&&<p>Only recent monitoring activity is shown.</p>}</details>}
     <div className={css.sourceActions}><a href={href("/team/sources",{sourceId:s.id})}>Review source and diffs</a><a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open official publication</a></div>
    </article>;})}</div>
   </section>
   <section className={css.sectors}><div className={css.heading}><h2>Regulator coverage</h2><small>Baselines, monitored publications and unresolved attention by publisher</small></div>
    <div className={css.agencyGrid}>{dashboard.agencies.map(a=><button key={a.agency} onClick={()=>{setAgency(a.agency);setStatus("all")}} aria-label={"Filter "+a.agency}><strong>{a.agency}</strong><span>{a.baseline} of {a.total} baselines</span><small>{a.attention} need attention</small></button>)}</div>
   </section>

   </>}
   {workspace.signedIn&&orgId&&<ConnectionMonitoring key={workspace.revision+":"+orgId} workspace={workspace} refresh={connectionRefresh}/>}
   {dashboard&&<footer className={css.footer}>Source health updated from tenant-scoped records. Public publication identity and applicability must be checked by a qualified person. No live checks are initiated by viewing this dashboard.</footer>}
  </main>
 </div>;
}
