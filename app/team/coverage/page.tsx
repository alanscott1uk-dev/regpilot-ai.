"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {coverageDashboard,exportCoverageCsv} from "../../../lib/regulatory/coverage-dashboard.mjs";
import type {CoverageDashboard,SourceHealth} from "../../../lib/regulatory/coverage-dashboard.mjs";
import type {ConnectorHealthItem} from "../../../lib/connectors/health-dashboard.mjs";
import shell from "../../workbench/workbench.module.css";
import css from "./coverage.module.css";
type Org={id:string;name:string;role:string};
type Feed={catalogue:any[];coverage:any[]};
const stateLabel:Record<string,string>={failed:"Collection failed",overdue:"Watch overdue",stale:"Source stale",current:"Recently checked",
 "never-checked":"Awaiting first check","awaiting-activation":"Not activated",paused:"Paused",unmonitored:"Not monitored"};
const states=[["all","All sources"],["attention","Needs attention"],["failed","Failed"],["overdue","Overdue"],["stale","Stale"],["review","Needs human review"],["current","Checked recently"],["unmonitored","Unmonitored"],["awaiting-activation","Not activated"]] as const;
const format=(s:string|null)=>s&&!Number.isNaN(Date.parse(s))?new Date(s).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Never";
function saveCsv(value:string){const url=URL.createObjectURL(new Blob([value],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="regpilot-source-monitoring-coverage.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
export default function Coverage(){
 const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState(""),[feed,setFeed]=useState<Feed|null>(null);
 const [connections,setConnections]=useState<{items:ConnectorHealthItem[];total:number;observed:number;needsAttention:number;notice:string}|null>(null);
 const [connectionError,setConnectionError]=useState("");
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[term,setTerm]=useState(""),[status,setStatus]=useState("attention"),[agency,setAgency]=useState("all");
 const loadSession=useCallback(async()=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw new Error("Sign in through the team workspace to review live monitoring coverage.");
  const r=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+token},cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"Workspace session unavailable");
  const list:Array<Org>=Array.isArray(data.organisations)?data.organisations:[];
  setOrgs(list);setOrgId(old=>list.some(x=>x.id===old)?old:list[0]?.id||"");
 },[]);
 useEffect(()=>{
  let alive=true;
  async function init(){try{await loadSession();if(alive)setError("");}catch(e){if(alive){setError(e instanceof Error?e.message:"Sign in required");setOrgs([]);setOrgId("");setFeed(null);}}finally{if(alive)setLoading(false);}}
  let unsub=()=>{};
  try{const handler=browserAuth().auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){setFeed(null);setOrgId("");setOrgs([]);}setTimeout(()=>{if(alive)void init()},0);});unsub=()=>handler.data.subscription.unsubscribe();void init();}
  catch{setLoading(false);setError("Secure authentication is not configured in this environment.");}
  return()=>{alive=false;unsub();};
 },[loadSession]);
 useEffect(()=>{
  setFeed(null);setConnections(null);setConnectionError("");if(!orgId)return;
  const controller=new AbortController();let alive=true;setLoading(true);setError("");
  (async()=>{
   try{
    const token=(await browserAuth().auth.getSession()).data.session?.access_token;
    if(!token)throw new Error("Sign in again");
    const r=await fetch("/api/workspace/sources?organizationId="+encodeURIComponent(orgId),{headers:{authorization:"Bearer "+token},cache:"no-store",signal:controller.signal});
    const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not load source coverage");
    if(!Array.isArray(data.catalogue)||!Array.isArray(data.coverage))throw new Error("Invalid source coverage");
    if(alive)setFeed({catalogue:data.catalogue,coverage:data.coverage});
    try{
     const health=await fetch("/api/workspace/connectors/health?organizationId="+encodeURIComponent(orgId),{headers:{authorization:"Bearer "+token},cache:"no-store",signal:controller.signal});
     if(!health.ok)throw new Error("Connector health requires an enabled private workspace");
     const h=await health.json();
     if(!Array.isArray(h.items))throw new Error("Connector health response invalid");
     if(alive)setConnections(h);
    }catch{if(alive)setConnectionError("Could not independently retrieve the latest connector health. Previously recorded signals should not be treated as current.");}
   }catch(e){if(alive)setError(e instanceof Error?e.message:"Monitoring coverage unavailable");}
   finally{if(alive)setLoading(false);}
  })();
  return()=>{alive=false;controller.abort()};
 },[orgId]);
 const dashboard=useMemo(()=>feed?coverageDashboard(feed.catalogue,feed.coverage):null,[feed]);
 const results=useMemo(()=>dashboard?.rows.filter(s=>{
  const pass=status==="all"||status==="attention"&&s.attention||status==="review"&&s.reviewNeeded||s.status===status;
  return pass&&(agency==="all"||s.agency===agency)&&[s.title,s.agency,s.topic,s.id,...s.activities].join(" ").toLowerCase().includes(term.toLowerCase().trim());
 })||[],[dashboard,status,agency,term]);
 const summary=dashboard?.summary;
 const currentOrg=orgs.find(x=>x.id===orgId);
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a className={shell.logo} href="/team/operations"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>UK REGULATORY INTELLIGENCE</small></span></a>
   <div className={shell.sideCaption}>PRIVATE WORKSPACE</div>
   <nav className={shell.sideNav} aria-label="Main navigation">
    <a href="/team/operations">◉ &nbsp; Operations</a>
    <a className={shell.active} aria-current="page" href="/team/coverage">◈ &nbsp; Monitoring health</a>
    <a href="/team/sources">▤ &nbsp; Publications &amp; version history</a><a href="/team/briefing">✦ &nbsp; Weekly briefing</a>
    <a href="/team/intelligence">✦ &nbsp; Impact assessment</a>
    <a href="/team/changes">◇ &nbsp; Change response</a>
    <a href="/team/evidence">▣ &nbsp; Evidence vault</a>
    <a href="/team/audits">◎ &nbsp; Audit preparation</a>
   </nav>
   <div className={shell.sideFoot}><strong>Know the limits of your coverage.</strong><p>A verified publication fetch establishes neither applicability nor compliance. Failed sources are never counted as checked.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Regulatory intelligence / Source health</span><span className={shell.demo}>PRIVATE PILOT</span></div>
   <header className={css.hero}><span className={css.overline}>REGPILOT / CONTINUOUS COVERAGE</span><h1>See what's covered.<br/><em>Know what still needs attention.</em></h1><p>One operational view of publication freshness, failed checks, unreviewed changes and monitoring gaps. Nothing here assumes an organisation is legally compliant.</p></header>
   {error&&<p className={css.error} role="alert">{error} <a href="/team">Open sign-in</a></p>}
   {loading&&<p role="status" className={css.loading}>Loading source health and current review evidence…</p>}
   {!!orgs.length&&<div className={css.toolbar}>
    <label>Organisation<select value={orgId} onChange={e=>{setFeed(null);setOrgId(e.target.value)}}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
    <div className={css.actions}><a href="/team/sources" className={css.primary}>Manage source portfolio</a><button type="button" disabled={!dashboard} onClick={()=>dashboard&&saveCsv(exportCoverageCsv(dashboard.rows))}>Export source-health CSV</button></div>
   </div>}
   {dashboard&&<><div className={css.metrics}>
    <button onClick={()=>setStatus("all")}><small>Curated publications</small><strong>{summary?.listed}</strong><span>Not a complete legislative library</span></button>
    <button onClick={()=>setStatus("current")}><small>Checked recently</small><strong>{summary?.current}</strong><span>Successful scheduled retrieval</span></button>
    <button onClick={()=>setStatus("attention")}><small>Need attention</small><strong>{summary?.attention}</strong><span>Failed, overdue or review pending</span></button>
    <button onClick={()=>setStatus("review")}><small>Human source review</small><strong>{summary?.reviewNeeded}</strong><span>Publication evidence needs decision</span></button>
    <button onClick={()=>setStatus("unmonitored")}><small>Unmonitored</small><strong>{dashboard.states.unmonitored||0}</strong><span>No watch is configured</span></button>
   </div>
   <p className={css.disclaimer}>{dashboard.caveat} A configured schedule only counts as current after a successful, timely collection. Latest snapshot age is separate from source change significance.</p>
   <section className={css.sectors}><div className={css.heading}><h2>Regulator coverage</h2><small>Baselines, monitored publications and unresolved attention by publisher</small></div>
    <div className={css.agencyGrid}>{dashboard.agencies.map(a=><button key={a.agency} onClick={()=>{setAgency(a.agency);setStatus("all")}} aria-label={"Filter "+a.agency}><strong>{a.agency}</strong><span>{a.baseline} of {a.total} baselines</span><small>{a.attention} need attention</small></button>)}</div>
   </section>
   <section className={css.sectors} aria-label="Connected evidence health">
    <div className={css.heading}><div><h2>Evidence integration health</h2><small>Read-only provider collection, integrity and freshness — not a compliance verdict</small></div>
     <a href="/team/operations?view=connections" style={{fontSize:12,fontWeight:750,color:"#68429c",textDecoration:"none"}}>Manage connections</a></div>
    {connectionError&&<p className={css.error} role="status">{connectionError}</p>}
    {connections&&<><div className={css.connectMetrics}><span><b>{connections.total}</b> connections configured</span><span><b>{connections.observed}</b> recent clean observations</span><span><b>{connections.needsAttention}</b> require investigation or verification</span></div>
     {connections.items.length===0?<p className={css.empty}>No evidence connections configured. Set up a read-only provider in Operations.</p>:
      <div className={css.connectionGrid}>{connections.items.map(c=><article key={c.id} className={css.connection}>
       <div className={css.sourceTop}><span>{c.provider}</span><span className={css.state} data-state={c.status==="observed"?"current":c.status==="failed"?"failed":"stale"}>{c.status.replaceAll("-"," ")}</span></div>
       <h3>{c.target}</h3><p>{c.reason}</p>
       <small>{c.checksFailed} failing observations · {c.checksUnknown} unknown · last retrieved {format(c.lastSuccessAt)}</small>
       <a href={c.href}>Inspect connection and actual signals →</a>
      </article>)}</div>}
     <p className={css.disclaimer}>{connections.notice}</p></>}
   </section>
   <section className={css.results}>
    <div className={css.heading}><div><h2>Publication health</h2><small>{results.length} displayed · Check date, action required and monitoring state</small></div><div className={css.filters}>
     <input type="search" aria-label="Search publications" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Find regulator, publication, or topic"/>
     <select aria-label="Filter operational status" value={status} onChange={e=>setStatus(e.target.value)}>{states.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>
     <select aria-label="Filter publishing agency" value={agency} onChange={e=>setAgency(e.target.value)}><option value="all">All publishers</option>{dashboard.agencies.map(a=><option value={a.agency} key={a.agency}>{a.agency}</option>)}</select>
    </div></div>
    <div className={css.records}>{results.length===0?<p className={css.empty}>No publications match these filters. This is not evidence of legal completeness.</p>:results.map(s=><article key={s.id} className={css.source}>
     <div className={css.sourceTop}><span>{s.agency} · {s.topic}</span><span data-state={s.status} className={css.state}>{stateLabel[s.status]||s.status}</span></div>
     <h3>{s.title}</h3><p>{s.detail}</p>
     {s.reviewNeeded&&<p className={css.review}>Human interpretation outstanding. Do not treat the publication text as an accepted legal obligation.</p>}
     <div className={css.sourceMeta}><span>Text baseline: <b>{s.baseline?"Recorded":"Missing"}</b></span><span>Last successful watch: <b>{format(s.lastSuccessAt)}</b></span><span>Independent review: <b>{s.reviewStatus.replaceAll("_"," ").toLowerCase()}</b></span></div>
     <div className={css.sourceActions}><a href={"/team/sources?sourceId="+encodeURIComponent(s.id)}>Review source and diffs</a><a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open official publication</a></div>
    </article>)}</div>
   </section>
   <footer className={css.footer}>Source health updated from tenant-scoped records. Public publication identity and applicability must be checked by a qualified person. No live checks are initiated by viewing this dashboard.</footer>
   </>}
  </main>
 </div>;
}
