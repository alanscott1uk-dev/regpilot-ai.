"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import styles from "./workspace-nav.module.css";
const primary=[
 {label:"Today",href:"/team/operations",icon:"today"},
 {label:"Tasks",href:"/team/work",icon:"tasks"},
 {label:"Regulatory updates",href:"/team/intelligence",icon:"updates"},
 {label:"Evidence",href:"/team/evidence",icon:"evidence"},
 {label:"Reports",href:"/team/briefing",icon:"reports"}
];
const workspace=[
 {label:"Workspace setup",href:"/team/setup",icon:"setup"},
 {label:"Connections",href:"/team/operations?view=connections",icon:"connections"},
 {label:"Regulator accounts",href:"/regulator-accounts",icon:"reports"},
 {label:"Accounting software",href:"/team/accounting",icon:"connections"},
 {label:"Help Centre",href:"/help",icon:"help"}
];
const groups=[
 {label:"Monitoring",links:[["Source checks","/team/sources"],["Monitoring health","/team/coverage"],["Horizon feed","/horizon"]]},
 {label:"Reviews & assurance",links:[["Deviations & CAPA","/team/quality"],["Requirements","/team/library"],["Starter programmes","/team/programmes"],["Risk register","/team/risks"],["AI inventory","/team/ai-inventory"],["Control library","/team/operations?view=controls"],["Import programme","/team/operations?view=programme"],["Change response","/team/changes"],["Evidence assessment","/team/assurance"],["SOP builder","/sop-builder"],["People & policies","/team/people"],["Document effectivity","/team/effectivity"],["Training & competence","/team/training"],["Suppliers","/team/vendors"],["Audit requests","/team/audit-requests"],["Audits","/team/audits"],["Access reviews","/team/access-reviews"],["Recognition","/team/recognition"]]},
 {label:"Customer assurance",links:[["Products & scope","/team/products"],["Company knowledge","/team/knowledge"],["Quality evaluation","/team/evaluations"],["Approved answers","/team/answers"],["Questionnaires","/team/questionnaires"],["Trust centre","/team/trust"]]},
 {label:"Settings & tools",links:[["Team & access","/team/settings"],["Developer API","/team/developers"],["Outbound integrations","/team/integrations"],["Task administration","/team"],["Services & spending","/team/services"],["AI Studio","/ai"],["Explore demo","/workbench"]]}
];
const icons:Record<string,string>={help:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-13a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01",today:"M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",tasks:"m3 6 2 2 3-4M11 6h10M3 13l2 2 3-4m3 2h10M3 20l2 2 3-4m3 2h10",updates:"M4 20h16M6 16V9m6 7V4m6 12v-6M3 4h4m10 0h4",evidence:"M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8ZM14 2v6h6M8 12h8m-8 4h6",reports:"M4 3h16v18H4ZM8 17v-3m4 3V9m4 8V6",setup:"M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",connections:"m9 15 6-6m-5-4 2-2a5 5 0 0 1 7 7l-2 2M14 19l-2 2a5 5 0 0 1-7-7l2-2"};
function Icon({name}:{name:string}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]||icons.evidence}/></svg>;}
export default function WorkspaceNav(){
 const path=usePathname(),[view,setView]=useState(""),[organizationId,setOrganizationId]=useState(""),[desktop,setDesktop]=useState(false);
 useEffect(()=>{const media=window.matchMedia("(min-width:1051px)"),update=()=>setDesktop(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);
 useEffect(()=>{
  const update=()=>{const params=new URLSearchParams(window.location.search),org=params.get('organizationId')||'';setView(params.get('view')||'');setOrganizationId(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org)?org:'');};
  update();window.addEventListener('regpilot-workspace-navigation',update);window.addEventListener('popstate',update);
  return()=>{window.removeEventListener('regpilot-workspace-navigation',update);window.removeEventListener('popstate',update);};
 },[path]);
 const current=path.startsWith('/team/work/')?'/team/work':path==="/team/operations"&&view&&view!=="today"?path+"?view="+view:path;
 const scoped=(href:string)=>organizationId&&href!=='/workbench'?href+(href.includes('?')?'&':'?')+'organizationId='+encodeURIComponent(organizationId):href;
 const link=(label:string,href:string,icon?:string)=><a key={href} href={scoped(href)} aria-current={current===href?"page":undefined}>{icon&&<Icon name={icon}/>}<span>{label}</span></a>;
 return <aside className={styles.sidebar}>
  <a className={styles.brand} href={scoped('/team/operations')}><span aria-hidden="true">R</span><strong>RegPilot <small>Compliance, connected</small></strong></a>
  <p className={styles.caption}>Your daily work</p>
  <nav className={styles.primary} aria-label="Main workspace">{primary.map(item=>link(item.label,item.href,item.icon))}</nav>
  <nav className={styles.workspace} aria-label="Workspace configuration"><h2>Workspace</h2>{workspace.map(item=>link(item.label,item.href,item.icon))}</nav>
  <details className={styles.more} key={current} open={desktop&&![...primary,...workspace].some(item=>item.href===current)}>
   <summary>More tools & settings</summary>
   {groups.map(group=><nav key={group.label} aria-label={group.label}><h2>{group.label}</h2>{group.links.map(([label,href])=>link(label,href))}</nav>)}
  </details>
  <div className={styles.pilot}><span aria-hidden="true"/><div><strong>Private pilot</strong><p>Fictional or non-sensitive records</p></div></div>
 </aside>;
}
