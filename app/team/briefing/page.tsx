"use client";
import {useCallback,useEffect,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {exportBriefCsv} from "../../../lib/operational-brief.mjs";
import type {ComplianceBrief} from "../../../lib/operational-brief.mjs";
import shell from "../../workbench/workbench.module.css";
import ui from "./briefing.module.css";
type Org={id:string;name:string;role:string};
type Brief=ComplianceBrief&{limits:{snapshotHistoryLimited:boolean;scheduledSourcesLimited:boolean;connectorsLimited:boolean;tasksLimited:boolean};notice:string};
function save(text:string){const link=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=link;a.download="regpilot-weekly-compliance-operations.csv";a.click();setTimeout(()=>URL.revokeObjectURL(link),700);}
const when=(s:string|null)=>s&&!Number.isNaN(Date.parse(s))?new Date(s).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"Not recorded";
export default function Briefing(){
 const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState(""),[report,setReport]=useState<Brief|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const request=useCallback(async(url:string,signal?:AbortSignal)=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw new Error("Sign in to your private workspace to view your organisation's briefing.");
  const result=await fetch(url,{headers:{authorization:"Bearer "+token},signal,cache:"no-store"});
  const data=await result.json();if(!result.ok)throw new Error(data.error||"Request unavailable");return data;
 },[]);
 useEffect(()=>{
  let alive=true,unsubscribe=()=>{};
  async function init(){try{
   const body=await request("/api/ai/context");if(!alive)return;
   const list:Array<Org>=Array.isArray(body.organisations)?body.organisations:[];
   setOrgs(list);setOrgId(id=>list.some(x=>x.id===id)?id:list[0]?.id||"");setError("");
  }catch(e){if(alive){setOrgId("");setReport(null);setOrgs([]);setError(e instanceof Error?e.message:"Sign in needed");}}
  finally{if(alive)setLoading(false);}}
  try{const r=browserAuth().auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){setOrgId("");setReport(null);setOrgs([]);}setTimeout(()=>{if(alive)void init()},0);});unsubscribe=()=>r.data.subscription.unsubscribe();void init();}
  catch{setLoading(false);setError("Private workspace authentication has not been configured.");}
  return()=>{alive=false;unsubscribe();}
 },[request]);
 useEffect(()=>{
  setReport(null);if(!orgId)return;
  let alive=true;const abort=new AbortController();setLoading(true);
  request("/api/workspace/briefing?organizationId="+encodeURIComponent(orgId),abort.signal).then(result=>{if(alive){setReport(result);setError("");}}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false;abort.abort()};
 },[orgId,request]);
 const summary=report?.summary;
 return <div className={shell.app}>
  <aside className={shell.sidebar}><a className={shell.logo} href="/team/operations"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>COMPLIANCE INTELLIGENCE</small></span></a>
   <div className={shell.sideCaption}>OPERATIONS</div><nav className={shell.sideNav} aria-label="Main navigation">
    <a href="/team/operations">◉ &nbsp; Operations</a><a className={shell.active} href="/team/briefing" aria-current="page">✦ &nbsp; Weekly briefing</a>
    <a href="/horizon">Horizon feed</a><a href="/team/coverage">◈ &nbsp; Source monitoring</a><a href="/team/sources">▤ &nbsp; Source history</a>
    <a href="/team/intelligence">◇ &nbsp; Regulatory intelligence</a><a href="/team/changes">↗ &nbsp; Change response</a>
    <a href="/team/assurance">▣ &nbsp; Independent evidence review</a></nav>
   <div className={shell.sideFoot}><strong>Operational facts, not a compliance grade.</strong><p>Keep the source, responsible person, current evidence and decision visible at every stage.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>RegPilot / Weekly briefing</span><span className={shell.demo}>PRIVATE WORKSPACE</span></div>
   <header className={ui.hero}><span>UK REGULATORY &amp; BUSINESS ASSURANCE</span><h1>What's changed.<br/><em>What needs doing.</em></h1><p>One seven-day briefing across recorded official-source text changes, pending human decisions, failed collection, connected evidence and upcoming team work.</p></header>
   {error&&<p className={ui.notice} role="alert">{error} <a href="/team">Open team sign-in</a></p>}
   {loading&&<p className={ui.notice} role="status">Checking your organisation's recorded work…</p>}
   {!!orgs.length&&<div className={ui.actions}><label>Organisation<select value={orgId} onChange={e=>{setReport(null);setOrgId(e.target.value);}}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
    <button disabled={!report} onClick={()=>report&&save(exportBriefCsv(report))}>Download briefing CSV</button>
    <a href="/team/coverage">Inspect monitoring health</a>
   </div>}
   {report&&<><div className={ui.stats}>
    <a href="#changes"><span>Publication text changes</span><strong>{summary?.changedPublications}</strong><small>Detected in last seven days</small></a>
    <a href="#reviews"><span>Human source reviews</span><strong>{summary?.awaitingReview}</strong><small>Latest versions awaiting decision</small></a>
    <a href="#monitor"><span>Source checks need action</span><strong>{summary?.sourceCheckIssues}</strong><small>Failures, missed or unverified</small></a>
    <a href="#connections"><span>Connector attention</span><strong>{summary?.connectorIssues}</strong><small>Failed or unverified integrations</small></a>
    <a href="#tasks"><span>Upcoming team work</span><strong>{summary?.dueWork}</strong><small>{summary?.overdueWork} overdue in sampled queue</small></a>
   </div>
   <div className={ui.caveat}>{report.limitations[0]} {report.limitations[1]} Reporting window: {when(report.windowStart)} to {when(report.windowEnd)}. {Object.values(report.limits).some(Boolean)?"At least one history or task sample reached its display limit; open the original workspace for more.":""}</div>
   <section id="changes" className={ui.section}><div className={ui.heading}><h2>01 · Official publication changes</h2><a href="/team/sources">View source history</a></div>
    {report.changes.length===0?<p className={ui.empty}>No recorded text-change events in this seven-day window. This does not prove that UK regulations remained unchanged.</p>:report.changes.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>DETECTED {when(x.detectedAt)} · {x.status.replaceAll("_"," ")}</span><h3>{x.title}</h3><p>Publication text changed. Human applicability and effective-date assessment is still required.</p></div><a href={x.href}>Review change</a></article>)}
   </section>
   <section id="reviews" className={ui.section}><div className={ui.heading}><h2>02 · Independent source decisions</h2><a href="/team/intelligence">Open intelligence inbox</a></div>
    {report.pending.length===0?<p className={ui.empty}>No latest source versions currently awaiting review among the recorded snapshots.</p>:report.pending.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>REVIEW REQUIRED · CHECKED {when(x.checkedAt)}</span><h3>{x.title}</h3></div><a href={x.href}>Review publication</a></article>)}
   </section>
   <section id="monitor" className={ui.section}><div className={ui.heading}><h2>03 · Monitoring problems</h2><a href="/team/coverage">Source health</a></div>
    {report.collections.length===0?<p className={ui.empty}>No flagged scheduled-source failures in the recorded and sampled watches.</p>:report.collections.map(x=><article key={x.sourceId} className={ui.item}><div><span className={ui.meta}>{x.status.toUpperCase()}</span><h3>{x.title}</h3><p>Last successful collection: {when(x.lastSuccessAt)}</p></div><a href={x.href}>Inspect source</a></article>)}
   </section>
   <section id="connections" className={ui.section}><div className={ui.heading}><h2>04 · Connected evidence</h2><a href="/team/operations?view=connections">Manage connections</a></div>
    {report.connectors.length===0?<p className={ui.empty}>No failed or unverified active evidence connections among the sampled records.</p>:report.connectors.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>{x.provider} · {x.status.toUpperCase()}</span><h3>{x.target}</h3><p>Last successful collection: {when(x.lastSuccessAt)}</p></div><a href={x.href}>Open connection</a></article>)}
   </section>
   <section id="tasks" className={ui.section}><div className={ui.heading}><h2>05 · Work due within seven days</h2><a href="/team">Open team queue</a></div>
    {report.tasks.length===0?<p className={ui.empty}>No recorded work items due within the next seven days among the sampled tasks.</p>:report.tasks.map(x=><article key={x.id} className={ui.item}><div><span className={ui.meta}>{x.overdue?"OVERDUE":"DUE"} · {when(x.dueDate)} · {x.owner}</span><h3>{x.title}</h3></div><a href={x.href}>Open task</a></article>)}
   </section>
   <p className={ui.foot}>{report.notice} Last generated {when(report.generatedAt)}. This report does not send emails or trigger regulatory decisions.</p>
   </>}
  </main>
 </div>;
}
