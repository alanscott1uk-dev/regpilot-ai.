"use client";
import WorkspaceNav from "../../components/workspace-nav";
import {useEffect,useState} from "react";
import {useWorkspaceContext,workspaceHref} from "../../../lib/client/workspace-context";
import EmailSignIn from "../../components/email-sign-in";
import {exportBriefCsv} from "../../../lib/operational-brief.mjs";
import type {fetchOperationalBrief} from "../../../lib/server/briefing-service";
import shell from "../../workbench/workbench.module.css";
import ui from "./briefing.module.css";
type Brief=Awaited<ReturnType<typeof fetchOperationalBrief>>;
function save(text:string,name:string,type:string){const link=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=link;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(link),700);}
const when=(s:string|null)=>s&&!Number.isNaN(Date.parse(s))?new Date(s).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"Not recorded";
export default function Briefing(){
 const workspace=useWorkspaceContext();
 const {organisations:orgs,organizationId:orgId,request,chooseOrganization,capture}=workspace;
 const [storedReport,setReport]=useState<Brief|null>(null),[reportRevision,setReportRevision]=useState(-1);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const report=reportRevision===workspace.revision?storedReport:null;
 const href=(path:string)=>workspaceHref(path,orgId);
 useEffect(()=>{
  setReport(null);setError('');if(!orgId){setLoading(false);return;}
  const current=capture(),abort=new AbortController();setLoading(true);
  request('/api/workspace/briefing?organizationId='+encodeURIComponent(orgId),{signal:abort.signal}).then(result=>{
   if(current()){if(result.organizationId!==orgId)throw new Error('The returned report does not match this organisation.');setReport(result);setReportRevision(workspace.revision);}
  }).catch(e=>{if(current()&&!abort.signal.aborted)setError(e.message);}).finally(()=>{if(current())setLoading(false);});
  return()=>abort.abort();
 },[orgId,workspace.revision,request,capture,refresh]);
 const organization=orgs.find(o=>o.id===orgId);
 function download(format:'json'|'csv'){
  if(!report||report.organizationId!==orgId)return;
  const name='regpilot-report-'+report.windowEnd.slice(0,10);
  if(format==='csv')save(exportBriefCsv(report),name+'.csv','text/csv;charset=utf-8');
  else save(JSON.stringify({...report,organizationName:organization?.name||''},null,2),name+'.json','application/json');
 }
 const summary=report?.summary;
 return <div className={shell.app+" "+ui.printLayout}>
  <WorkspaceNav/>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / Reports</span><span className={shell.demo}>PRIVATE WORKSPACE</span></div>
   <header className={ui.hero}><span>YOUR RECORDED WORK, IN ONE REPORT</span><h1>Compliance operations report</h1><p>{organization?.name||'Your organisation'} · Publication changes, open decisions and work completed with reviewed evidence.</p>{report&&<p>Reporting window: {when(report.windowStart)} to {when(report.windowEnd)}.</p>}</header>
   {(error||workspace.error)&&<p className={ui.notice} role="alert">{error||workspace.error}</p>}
   {(loading||workspace.loading)&&<p className={ui.notice} role="status">Checking your organisation's recorded work…</p>}
   {!workspace.loading&&!workspace.signedIn&&<section className={ui.section}><h2>Sign in to your reports</h2><EmailSignIn destination="/team/briefing"/></section>}
   {workspace.signedIn&&!orgs.length&&!workspace.loading&&<section className={ui.section}><h2>Start with your organisation</h2><p>Set up your company to keep its sources, tasks and report together.</p><a href={href('/team/setup')}>Create your organisation →</a></section>}
   {!!orgs.length&&<div className={ui.actions}><label>Organisation<select aria-label="Organisation" value={orgId} onChange={e=>{setReport(null);chooseOrganization(e.target.value);}}>{!orgId&&<option value="" disabled>Choose an organisation</option>}{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
    <button disabled={!report} onClick={()=>download('json')}>Download report JSON</button>
    <button disabled={!report} onClick={()=>download('csv')}>Download briefing CSV</button>
    <button disabled={!report} onClick={()=>window.print()}>Print report</button>
    <button disabled={!orgId||loading} onClick={()=>setRefresh(x=>x+1)}>Refresh report</button>
    {orgId&&<a href={href('/team/operations')}>Back to Today →</a>}
   </div>}
   {report&&<><div className={ui.stats}>
    <a href="#changes"><span>Publication text changes</span><strong>{summary?.changedPublications}</strong><small>Detected in last seven days</small></a>
    <a href="#reviews"><span>Human source reviews</span><strong>{summary?.awaitingReview}</strong><small>Latest versions awaiting decision</small></a>
    <a href="#monitor"><span>Source checks need action</span><strong>{summary?.sourceCheckIssues}</strong><small>Failures, missed or unverified</small></a>
    <a href="#connections"><span>Connector attention</span><strong>{summary?.connectorIssues}</strong><small>Failed or unverified integrations</small></a>
    <a href="#completed"><span>Recorded completions</span><strong>{summary?.completedWork||0}</strong><small>Saved decisions in this period</small></a>
    <a href="#tasks"><span>Upcoming team work</span><strong>{summary?.dueWork}</strong><small>{summary?.overdueWork} overdue in sampled queue</small></a>
   </div>
   <div className={ui.caveat}>{report.limitations[0]} {report.limitations[1]} Reporting window: {when(report.windowStart)} to {when(report.windowEnd)}. {Object.values(report.limits).some(Boolean)?"At least one history or task sample reached its display limit; open the original workspace for more.":""}</div>
   <section id="changes" className={ui.section}><div className={ui.heading}><h2>01 · Official publication changes</h2><a href={href('/team/sources')}>View source history</a></div>
    {report.changes.length===0?<p className={ui.empty}>No recorded text-change events in this seven-day window. This does not prove that UK regulations remained unchanged.</p>:report.changes.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>DETECTED {when(x.detectedAt)} · {x.status.replaceAll("_"," ")}</span><h3>{x.title}</h3><p>Publication text changed. Human applicability and effective-date assessment is still required.</p></div><a href={x.href}>Review change</a></article>)}
   </section>
   <section id="reviews" className={ui.section}><div className={ui.heading}><h2>02 · Independent source decisions</h2><a href={href('/team/intelligence')}>Open intelligence inbox</a></div>
    {report.pending.length===0?<p className={ui.empty}>No latest source versions currently awaiting review among the recorded snapshots.</p>:report.pending.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>REVIEW REQUIRED · CHECKED {when(x.checkedAt)}</span><h3>{x.title}</h3></div><a href={x.href}>Review publication</a></article>)}
   </section>
   <section id="monitor" className={ui.section}><div className={ui.heading}><h2>03 · Monitoring problems</h2><a href={href('/team/coverage')}>Source health</a></div>
    {report.collections.length===0?<p className={ui.empty}>No flagged scheduled-source failures in the recorded and sampled watches.</p>:report.collections.map(x=><article key={x.sourceId} className={ui.item}><div><span className={ui.meta}>{x.status.toUpperCase()}</span><h3>{x.title}</h3><p>Last successful collection: {when(x.lastSuccessAt)}</p></div><a href={x.href}>Inspect source</a></article>)}
   </section>
   <section id="connections" className={ui.section}><div className={ui.heading}><h2>04 · Connected evidence</h2><a href={href('/team/operations?view=connections')}>Manage connections</a></div>
    {report.connectors.length===0?<p className={ui.empty}>No failed or unverified active evidence connections among the sampled records.</p>:report.connectors.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>{x.provider} · {x.status.toUpperCase()}</span><h3>{x.target}</h3><p>Last successful collection: {when(x.lastSuccessAt)}</p></div><a href={x.href}>Open connection</a></article>)}
   </section>
   <section id="tasks" className={ui.section}><div className={ui.heading}><h2>05 · Work due within seven days</h2><a href={href('/team/work')}>Open task workspace</a></div>
    {report.tasks.length===0?<p className={ui.empty}>No recorded work items due within the next seven days among the sampled tasks.</p>:report.tasks.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>{x.overdue?"OVERDUE":"DUE"} · {when(x.dueDate)} · {x.owner}</span><h3>{x.title}</h3></div><a href={x.href}>Open task</a></article>)}
   </section>
   <section id="completed" className={ui.section} aria-label="Recorded work completions"><div className={ui.heading}><h2>06 · Completed work and its evidence</h2><a href={href('/team/work/reviews')}>Review completed work</a></div>
    <p className={ui.empty}>{report.completionScope}</p>
    {report.completionRecordsUnavailable>0&&<p className={ui.notice} role="alert">{report.completionRecordsUnavailable} saved completion records could not be verified and are omitted from this report. <a href={href('/team/work/reviews')}>Inspect completed-work records before relying on this report.</a></p>}
    {report.completedWork.length===0?<p className={ui.empty}>No verified completion records in this reporting window. Open tasks and evidence approval are shown separately.</p>:report.completedWork.map(record=><article key={record.eventId} className={ui.item}><div><span className={ui.meta}>RECORDED {when(record.completedAt)} · {record.owner}</span><h3>{record.title}</h3><p>{record.evidenceCount} reviewed {record.evidenceCount===1?'file':'files'} in the saved decision. Record {record.eventId}.</p><details><summary>Source and evidence in this decision</summary><p className={ui.fingerprint}>Proof SHA-256: {record.proofHash}</p><p>The JSON download contains the full frozen decision, source context and evidence fingerprints. Open the task to inspect original files or request a fresh review.</p></details></div><a href={record.href}>Open completion record</a></article>)}
   </section>
   <p className={ui.foot}>{report.notice} Last generated {when(report.generatedAt)}. This report does not send emails or trigger regulatory decisions.</p>
   </>}
  </main>
 </div>;
}
