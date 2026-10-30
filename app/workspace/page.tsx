"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import s from "./workspace.module.css";
import EvidencePanel from "./evidence-panel";
import ModuleRegister from "./module-register";
import LiveWorkspace from "./live-workspace";
import { navigationForIndustry } from "./navigation.mjs";
import { actionSummary, actionPriority } from "../../lib/action-priority.mjs";
type Tab = "Overview" | "Actions" | "Documents" | "Intelligence" | "Modules" | "My business";
const demo = [
 { id:"a1",title:"Review insurance certificate",owner:"Operations",due:"15 Nov 2026",status:"Evidence required",category:"Insurance" },
 { id:"a2",title:"Update supplier qualification",owner:"Quality",due:"24 Nov 2026",status:"In progress",category:"Suppliers" },
 { id:"a3",title:"Review privacy information",owner:"Administration",due:"02 Dec 2026",status:"Review required",category:"Data protection" },
];
export default function Workspace() {
 const [tab,setTab] = useState<Tab>("My business");
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
   <div className={s.mobileTop}><div className={s.brand}>EAG<span>NEXIS</span><span style={{fontSize:12,marginLeft:5,color:"#9db1d1"}}>AI</span></div><button className={s.mobileToggle} type="button" aria-expanded={menuOpen} aria-controls="workspace-menu" onClick={()=>setMenuOpen(v=>!v)}>{menuOpen?"Close menu":"☰ Menu"}</button></div>
   <div id="workspace-menu" className={s.mobileMenu} data-open={menuOpen}>
   <div style={{fontSize:12,color:"#9fb2d2"}}>Compliance, made clearer.</div>
   <label style={{fontSize:12,color:"#b8c9e4"}}>Business sector<select aria-label="Business sector" value={industry} onChange={e=>setIndustry(e.target.value)} style={{display:"block",marginTop:6,width:"100%",padding:9,borderRadius:9,background:"#233657",color:"white",border:"1px solid #435679"}}><option value="all">General business</option><option value="healthcare">Healthcare & pharma</option><option value="manufacturing">Manufacturing</option><option value="food">Food</option><option value="logistics">Logistics</option><option value="construction">Construction</option><option value="retail">Retail</option><option value="hospitality">Hospitality</option></select></label>
   <nav className={s.nav} aria-label="Workspace navigation">
    {([{tab:"My business",label:"Home"},{tab:"Actions",label:"My tasks"},{tab:"Documents",label:"Documents"},{tab:"Modules",label:"More tools"},{tab:"Intelligence",label:"Regulatory updates"}] as {tab:Tab;label:string}[]).map(item=><button key={item.tab} aria-current={tab===item.tab?"page":undefined} onClick={()=>{setTab(item.tab);setSelected(null);setMenuOpen(false);}}>{item.label}</button>)}
   </nav>
   <div style={{fontSize:12,color:"#a6b8d6",marginTop:"auto"}}>{tab==="My business"?"Authenticated staging workspace":"Design preview · "+dataOrigin}</div>
   </div>
  </aside>
  <main className={s.content}>
   <header className={s.header}><div><div className={s.eyebrow}>{tab==="My business"?"Business workspace / Staging":"EAGNEXIS AI / Demonstration workspace"}</div><h1 className={s.heading}>{tab==="My business"?"Your business dashboard":tab==="Actions"?"My tasks":tab==="Modules"?"More tools":tab==="Intelligence"?"Regulatory updates":tab}</h1><div className={s.muted}>A clearer view of what needs attention and what happens next.</div></div><Link className={s.button+" "+s.secondary} href="/company-scan" style={{textDecoration:"none"}}>Company lookup</Link></header>
   {tab==="My business"&&<div style={{marginTop:24}}><LiveWorkspace onOpenBeta={()=>window.location.assign("/beta")}/></div>}
   {tab==="Overview"&&<>
    <div className={s.metrics}>
     {[["Tracked actions",String(actions.length)],["Overdue",String(priorities.overdue)],["Due in 7 days",String(priorities.urgent)],["Completed",String(priorities.complete)]].map(([label,value])=><div className={s.card} key={label}><div className={s.muted}>{label}</div><div className={s.metric}>{value}</div><span className={s.pill}>Demo</span></div>)}
    </div>
    <div className={s.columns}>
     <section className={s.card}><h2 className={s.sectionTitle}>Priority actions</h2><div className={s.muted}>Select an action to see supporting evidence.</div>{actions.map(x=><div className={s.row} key={x.id}><div><strong>{x.title}</strong><div className={s.muted}>{x.owner} · {x.due}</div></div><button className={s.button+" "+s.secondary} onClick={()=>{setTab("Actions");setSelected(x.id);}}>Review</button></div>)}</section>
     <section className={s.card}><h2 className={s.sectionTitle}>Document readiness</h2><p className={s.muted}>Keep certificates, policies and evidence linked to the actions they support.</p><div className={s.empty}>No documents uploaded in this preview.</div><button style={{marginTop:16}} className={s.button+" "+s.secondary} onClick={()=>setTab("Documents")}>Open document library</button></section>
    </div>
   </>}
   {tab==="Actions"&&<div style={{marginTop:24}}><LiveWorkspace onOpenBeta={()=>window.location.assign("/beta")} moduleFilter="obligations"/></div>}
   {tab==="Modules"&&<section className={s.card} style={{marginTop:24}}>
    <h2 className={s.sectionTitle}>Compliance modules</h2>
    <p className={s.muted}>Select a module to manage authenticated organisation records. Specialist approval and document-upload features remain restricted until validated.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,margin:"16px 0"}}>
    {groups.flatMap(g=>g.items).map(m=><button key={m.id} onClick={()=>setModuleId(m.id)} aria-pressed={moduleId===m.id} className={s.button+" "+(moduleId===m.id?"":s.secondary)}>{m.name}</button>)}
    </div>
    <LiveWorkspace key={moduleId} moduleFilter={moduleId} onOpenBeta={()=>window.location.assign("/beta")}/>
   </section>}
   {tab==="Documents"&&<section style={{marginTop:24}}>
    <h2 className={s.sectionTitle}>Your documents</h2>
    <p className={s.muted}>For test uploads: 1. Select a saved document-related task below. 2. Register the document. 3. Choose a sample file and upload to quarantine. Only use fictional files; scanning and approval are not ready.</p>
    <LiveWorkspace moduleFilter="policies" onOpenBeta={()=>window.location.assign("/beta")}/>
   </section>}
   {tab==="Intelligence"&&<section className={s.card} style={{marginTop:24}}><h2 className={s.sectionTitle}>Regulatory intelligence</h2><p className={s.muted}>Future official-source monitoring and company-specific impact analysis.</p><div className={s.empty}>No live regulatory feed connected yet. No simulated regulatory alerts are shown.</div></section>}
   <footer className={s.footer}>Authenticated registers use staging Supabase. Regulatory intelligence is not yet operational. Test uploads are quarantine-only and are not approved evidence. No regulatory certification is provided.</footer>
  </main>
 </div>;
}
