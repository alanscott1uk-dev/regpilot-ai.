"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import s from "./workspace.module.css";
type Tab = "Overview" | "Actions" | "Documents" | "Intelligence";
const demo = [
 { id:"a1",title:"Review insurance certificate",owner:"Operations",due:"15 Nov 2026",status:"Evidence required",category:"Insurance" },
 { id:"a2",title:"Update supplier qualification",owner:"Quality",due:"24 Nov 2026",status:"In progress",category:"Suppliers" },
 { id:"a3",title:"Review privacy information",owner:"Administration",due:"02 Dec 2026",status:"Review required",category:"Data protection" },
];
export default function Workspace() {
 const [tab,setTab] = useState<Tab>("Overview");
 const [search,setSearch] = useState("");
 const [selected,setSelected] = useState<string|null>(null);
 const [view,setView] = useState("All");
 const [detail,setViewDetail] = useState("Overview");
 const filtered=useMemo(()=>demo.filter(x=>(view==="All"||x.status===view)&&[x.title,x.owner,x.category].join(" ").toLowerCase().includes(search.toLowerCase())),[search,view]);
 const active=demo.find(x=>x.id===selected);
 return <div className={s.shell}>
  <aside className={s.sidebar}>
   <div className={s.brand}>reg<span>pilot</span><span style={{fontSize:12,marginLeft:5,color:"#9db1d1"}}>AI</span></div>
   <div style={{fontSize:12,color:"#9fb2d2"}}>Compliance, made clearer.</div>
   <nav className={s.nav} aria-label="Workspace navigation">
    {(["Overview","Actions","Documents","Intelligence"] as Tab[]).map(t=><button key={t} aria-current={tab===t?"page":undefined} onClick={()=>{setTab(t);setSelected(null);}}>{t}</button>)}
   </nav>
   <div style={{fontSize:12,color:"#a6b8d6",marginTop:"auto"}}>Design preview · sample data</div>
  </aside>
  <main className={s.content}>
   <header className={s.header}><div><div className={s.eyebrow}>Business workspace / Demo company</div><h1 className={s.heading}>{tab==="Overview"?"Your compliance, at a glance":tab}</h1><div className={s.muted}>A clearer view of what needs attention and what happens next.</div></div><Link className={s.button} href="/company-scan" style={{textDecoration:"none"}}>Scan a company ↗</Link></header>
   {tab==="Overview"&&<>
    <div className={s.metrics}>
     {[["Tracked actions","3"],["Need attention","2"],["Evidence approved","0"],["Upcoming reviews","3"]].map(([label,value])=><div className={s.card} key={label}><div className={s.muted}>{label}</div><div className={s.metric}>{value}</div><span className={s.pill}>Demo</span></div>)}
    </div>
    <div className={s.columns}>
     <section className={s.card}><h2 className={s.sectionTitle}>Priority actions</h2><div className={s.muted}>Select an action to see supporting evidence.</div>{demo.map(x=><div className={s.row} key={x.id}><div><strong>{x.title}</strong><div className={s.muted}>{x.owner} · {x.due}</div></div><button className={s.button+" "+s.secondary} onClick={()=>{setTab("Actions");setSelected(x.id);}}>Review</button></div>)}</section>
     <section className={s.card}><h2 className={s.sectionTitle}>Document readiness</h2><p className={s.muted}>Keep certificates, policies and evidence linked to the actions they support.</p><div className={s.empty}>No documents uploaded in this preview.</div><button style={{marginTop:16}} className={s.button+" "+s.secondary} onClick={()=>setTab("Documents")}>Open document library</button></section>
    </div>
   </>}
   {tab==="Actions"&&<div className={s.columns} style={{marginTop:24}}>
    <section className={s.card}><h2 className={s.sectionTitle}>Action register</h2><div style={{display:"flex",gap:10,margin:"16px 0",flexWrap:"wrap"}}><input className={s.field} style={{flex:"1 1 180px"}} aria-label="Search actions" placeholder="Search actions..." value={search} onChange={e=>setSearch(e.target.value)}/><select className={s.field} style={{width:"auto"}} aria-label="Filter actions" value={view} onChange={e=>setView(e.target.value)}><option>All</option><option>Evidence required</option><option>In progress</option><option>Review required</option></select></div>{filtered.length?filtered.map(x=><div className={s.row} key={x.id}><div><strong>{x.title}</strong><div className={s.muted}>{x.category} · {x.due}</div><span className={s.pill+" "+(x.status==="Evidence required"?s.amber:"")}>{x.status}</span></div><button className={s.button+" "+s.secondary} onClick={()=>setSelected(x.id)}>Open</button></div>):<p className={s.muted}>No matching actions.</p>}</section>
    <section className={s.card}><h2 className={s.sectionTitle}>Action details</h2>{active?<><h3>{active.title}</h3><p className={s.muted}>Owner: {active.owner} · Due: {active.due}</p><div className={s.tabs}>{["Overview","Documents","Review history"].map(x=><button key={x} onClick={()=>setViewDetail(x)} aria-selected={detail===x}>{x}</button>)}</div>{detail==="Documents"?<div className={s.empty}><strong>Evidence vault</strong><p>No linked files yet.</p><p>Secure uploads require authenticated storage. This preview does not accept documents.</p></div>:detail==="Review history"?<p className={s.muted}>No review events recorded in this preview.</p>:<p className={s.muted}>Use this panel to review evidence and approve action completion once secure workflows are connected.</p>}</>:<p className={s.muted}>Select an action to view its details, documents and review history.</p>}</section>
   </div>}
   {tab==="Documents"&&<section className={s.card} style={{marginTop:24}}><h2 className={s.sectionTitle}>Document library</h2><p className={s.muted}>Planned: private uploads, categories, version history, expiry reminders and linking a file to multiple actions.</p><div className={s.empty}>Your secure document vault will appear here after authentication and storage are configured.</div></section>}
   {tab==="Intelligence"&&<section className={s.card} style={{marginTop:24}}><h2 className={s.sectionTitle}>Regulatory intelligence</h2><p className={s.muted}>Future official-source monitoring and company-specific impact analysis.</p><div className={s.empty}>No live regulatory feed connected yet. No simulated regulatory alerts are shown.</div></section>}
   <footer className={s.footer}>Preview uses fictional records. No accounts, uploads or compliance certifications are created here.</footer>
  </main>
 </div>;
}
