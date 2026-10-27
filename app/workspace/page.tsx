"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import s from "./workspace.module.css";
import EvidencePanel from "./evidence-panel";
import ModuleRegister from "./module-register";
import { navigationForIndustry } from "./navigation.mjs";
import { actionSummary, actionPriority } from "../../lib/action-priority.mjs";
type Tab = "Overview" | "Actions" | "Documents" | "Intelligence" | "Modules";
const demo = [
 { id:"a1",title:"Review insurance certificate",owner:"Operations",due:"15 Nov 2026",status:"Evidence required",category:"Insurance" },
 { id:"a2",title:"Update supplier qualification",owner:"Quality",due:"24 Nov 2026",status:"In progress",category:"Suppliers" },
 { id:"a3",title:"Review privacy information",owner:"Administration",due:"02 Dec 2026",status:"Review required",category:"Data protection" },
];
export default function Workspace() {
 const [tab,setTab] = useState<Tab>("Overview");
 const [menuOpen,setMenuOpen] = useState(false);
 const [actions,setActions] = useState(demo);
 const [dataOrigin,setDataOrigin] = useState("Sample data");
 useEffect(() => {
   try {
     const raw=window.localStorage.getItem("regpilot-demo-obligations-v1");
     if(!raw) return;
     const parsed: unknown=JSON.parse(raw);
     if(!Array.isArray(parsed)) return;
     const safe=parsed.filter((x): x is {id:string;title:string;owner:string;due:string;status:string;regulator:string}=>
       !!x && typeof x==="object" && typeof x.id==="string" && typeof x.title==="string" && typeof x.owner==="string" && typeof x.due==="string" && typeof x.status==="string" && typeof x.regulator==="string"
     ).map(x=>({id:x.id,title:x.title,owner:x.owner,due:x.due,status:x.status,category:x.regulator}));
     setActions(safe);setDataOrigin("Browser demo register");
   }catch { /* leave sample records visible if demo data is corrupt */ }
 },[]);
 const [search,setSearch] = useState("");
 const [selected,setSelected] = useState<string|null>(null);
 const [view,setView] = useState("All");
 const [detail,setViewDetail] = useState("Overview");
 const [industry,setIndustry] = useState("all");
 const [moduleId,setModuleId] = useState("obligations");
 const groups = navigationForIndustry(industry);
 const filtered=useMemo(()=>actions.filter(x=>(view==="All"||x.status===view)&&[x.title,x.owner,x.category].join(" ").toLowerCase().includes(search.toLowerCase())),[actions,search,view]);
 const active=actions.find(x=>x.id===selected);
 const [today,setToday]=useState("2026-10-27");
 useEffect(()=>{const d=new Date();setToday([d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"));},[]);
 const priorities=actionSummary(actions,today);
 return <div className={s.shell}>
  <aside className={s.sidebar}>
   <div className={s.mobileTop}><div className={s.brand}>reg<span>pilot</span><span style={{fontSize:12,marginLeft:5,color:"#9db1d1"}}>AI</span></div><button className={s.mobileToggle} type="button" aria-expanded={menuOpen} aria-controls="workspace-menu" onClick={()=>setMenuOpen(v=>!v)}>{menuOpen?"Close menu":"☰ Menu"}</button></div>
   <div id="workspace-menu" className={s.mobileMenu} data-open={menuOpen}>
   <div style={{fontSize:12,color:"#9fb2d2"}}>Compliance, made clearer.</div>
   <label style={{fontSize:12,color:"#b8c9e4"}}>Business sector<select aria-label="Business sector" value={industry} onChange={e=>setIndustry(e.target.value)} style={{display:"block",marginTop:6,width:"100%",padding:9,borderRadius:9,background:"#233657",color:"white",border:"1px solid #435679"}}><option value="all">General business</option><option value="healthcare">Healthcare & pharma</option><option value="manufacturing">Manufacturing</option><option value="food">Food</option><option value="logistics">Logistics</option><option value="construction">Construction</option><option value="retail">Retail</option><option value="hospitality">Hospitality</option></select></label>
   <nav className={s.nav} aria-label="Workspace navigation">
    {(["Overview","Actions","Documents","Intelligence"] as Tab[]).map(t=><button key={t} aria-current={tab===t?"page":undefined} onClick={()=>{setTab(t);setSelected(null);setMenuOpen(false);}}>{t}</button>)}
    {groups.filter(g=>g.items.length>0).map(g=><button key={g.id} aria-current={tab==="Modules"&&groups.find(x=>x.items.some(m=>m.id===moduleId))?.id===g.id?"page":undefined} onClick={()=>{setTab("Modules");setModuleId(g.items[0]?.id??g.modules[0]);setSelected(null);setMenuOpen(false);}}>{g.label}</button>)}
   </nav>
   <div style={{fontSize:12,color:"#a6b8d6",marginTop:"auto"}}>Design preview · {dataOrigin}</div>
   </div>
  </aside>
  <main className={s.content}>
   <header className={s.header}><div><div className={s.eyebrow}>Business workspace / Demo company</div><h1 className={s.heading}>{tab==="Overview"?"Your compliance, at a glance":tab}</h1><div className={s.muted}>A clearer view of what needs attention and what happens next.</div></div><Link className={s.button} href="/company-scan" style={{textDecoration:"none"}}>Scan a company ↗</Link></header>
   {tab==="Overview"&&<>
    <div className={s.metrics}>
     {[["Tracked actions",String(actions.length)],["Overdue",String(priorities.overdue)],["Due in 7 days",String(priorities.urgent)],["Completed",String(priorities.complete)]].map(([label,value])=><div className={s.card} key={label}><div className={s.muted}>{label}</div><div className={s.metric}>{value}</div><span className={s.pill}>Demo</span></div>)}
    </div>
    <div className={s.columns}>
     <section className={s.card}><h2 className={s.sectionTitle}>Priority actions</h2><div className={s.muted}>Select an action to see supporting evidence.</div>{actions.map(x=><div className={s.row} key={x.id}><div><strong>{x.title}</strong><div className={s.muted}>{x.owner} · {x.due}</div></div><button className={s.button+" "+s.secondary} onClick={()=>{setTab("Actions");setSelected(x.id);}}>Review</button></div>)}</section>
     <section className={s.card}><h2 className={s.sectionTitle}>Document readiness</h2><p className={s.muted}>Keep certificates, policies and evidence linked to the actions they support.</p><div className={s.empty}>No documents uploaded in this preview.</div><button style={{marginTop:16}} className={s.button+" "+s.secondary} onClick={()=>setTab("Documents")}>Open document library</button></section>
    </div>
   </>}
   {tab==="Actions"&&<div className={s.columns} style={{marginTop:24}}>
    <section className={s.card}><h2 className={s.sectionTitle}>Action register</h2><div style={{display:"flex",gap:10,margin:"16px 0",flexWrap:"wrap"}}><input className={s.field} style={{flex:"1 1 180px"}} aria-label="Search actions" placeholder="Search actions..." value={search} onChange={e=>setSearch(e.target.value)}/><select className={s.field} style={{width:"auto"}} aria-label="Filter actions" value={view} onChange={e=>setView(e.target.value)}><option>All</option><option>Evidence required</option><option>In progress</option><option>Review required</option></select></div>{filtered.length?filtered.map(x=><div className={s.row} key={x.id}><div><strong>{x.title}</strong><div className={s.muted}>{x.category} · {x.due}</div><span className={s.pill+" "+(actionPriority(x,today)==="Overdue"||actionPriority(x,today)==="Urgent"?s.amber:"")}>{actionPriority(x,today)} · {x.status}</span></div><button className={s.button+" "+s.secondary} onClick={()=>setSelected(x.id)}>Open</button></div>):<p className={s.muted}>No matching actions.</p>}</section>
    <section className={s.card}><h2 className={s.sectionTitle}>Action details</h2>{active?<><h3>{active.title}</h3><p className={s.muted}>Owner: {active.owner} · Due: {active.due}</p><div className={s.tabs}>{["Overview","Documents","Review history"].map(x=><button key={x} onClick={()=>setViewDetail(x)} aria-selected={detail===x}>{x}</button>)}</div>{detail==="Documents"?<EvidencePanel actionId={active.id}/>:detail==="Review history"?<p className={s.muted}>No review events recorded in this preview.</p>:<p className={s.muted}>Use this panel to review evidence and approve action completion once secure workflows are connected.</p>}</>:<p className={s.muted}>Select an action to view its details, documents and review history.</p>}</section>
   </div>}
   {tab==="Modules"&&<section className={s.card} style={{marginTop:24}}>
    <h2 className={s.sectionTitle}>Business modules</h2><p className={s.muted}>Choose a department or compliance function. Availability adapts to the selected sector.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:18}}>
     {groups.flatMap(g=>g.items).map(m=><button key={m.id} onClick={()=>setModuleId(m.id)} aria-pressed={moduleId===m.id} style={{textAlign:"left",border:moduleId===m.id?"2px solid #2659df":"1px solid #dbe3ee",borderRadius:12,background:moduleId===m.id?"#eef4ff":"#fff",padding:14,cursor:"pointer",fontWeight:700,color:"#203454"}}>{m.name}</button>)}
    </div>
    <div style={{marginTop:20,padding:18,background:"#f8fafc",borderRadius:12}}>
     <h3>{groups.flatMap(g=>g.items).find(m=>m.id===moduleId)?.name??"Select a module"}</h3>
     <p className={s.muted}>This module is part of the RegPilot roadmap. Where no live workflow is connected, no compliance status is asserted.</p>
     <ModuleRegister key={moduleId} moduleId={moduleId} moduleName={groups.flatMap(g=>g.items).find(m=>m.id===moduleId)?.name??"Module"} onCreateAction={item=>setActions(prev=>[...prev,{id:"session-"+String(Date.now())+"-"+prev.length,...item}])}/>
     {moduleId==="obligations"?<button className={s.button} onClick={()=>setTab("Actions")}>Open action register</button>:moduleId==="policies"?<button className={s.button} onClick={()=>setTab("Documents")}>Open document library</button>:moduleId==="regulatory"?<button className={s.button} onClick={()=>setTab("Intelligence")}>Open intelligence</button>:null}
    </div>
   </section>}
   {tab==="Documents"&&<section className={s.card} style={{marginTop:24}}><h2 className={s.sectionTitle}>Document library</h2><p className={s.muted}>Planned: private uploads, categories, version history, expiry reminders and linking a file to multiple actions.</p><EvidencePanel/></section>}
   {tab==="Intelligence"&&<section className={s.card} style={{marginTop:24}}><h2 className={s.sectionTitle}>Regulatory intelligence</h2><p className={s.muted}>Future official-source monitoring and company-specific impact analysis.</p><div className={s.empty}>No live regulatory feed connected yet. No simulated regulatory alerts are shown.</div></section>}
   <footer className={s.footer}>Preview uses browser-local demo records where available. No accounts, uploads or compliance certifications are created here.</footer>
  </main>
 </div>;
}
