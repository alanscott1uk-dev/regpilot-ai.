"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import styles from "./workspace-nav.module.css";
const primary=[
 {label:"Today",href:"/team/operations"},
 {label:"Tasks",href:"/team/work"},
 {label:"Regulatory updates",href:"/team/intelligence"},
 {label:"Evidence",href:"/team/evidence"},
 {label:"Connections",href:"/team/operations?view=connections"}
];
const groups=[
 {label:"Monitoring",links:[["Source checks","/team/sources"],["Monitoring health","/team/coverage"],["Weekly briefing","/team/briefing"],["Horizon feed","/horizon"]]},
 {label:"Reviews & assurance",links:[["Requirements","/team/library"],["Control library","/team/operations?view=controls"],["Import programme","/team/operations?view=programme"],["Change response","/team/changes"],["Evidence assessment","/team/assurance"],["People & policies","/team/people"],["Suppliers","/team/vendors"],["Audit requests","/team/audit-requests"],["Audits","/team/audits"],["Access reviews","/team/access-reviews"],["Approved answers","/team/answers"],["Questionnaires","/team/questionnaires"],["Trust centre","/team/trust"],["Recognition","/team/recognition"]]},
 {label:"Settings & tools",links:[["Workspace setup","/team/setup"],["Team & access","/team/settings"],["Task administration","/team"],["Services & spending","/team/services"],["AI Studio","/ai"],["Explore demo","/workbench"]]}
];
export default function WorkspaceNav(){
 const path=usePathname(),[view,setView]=useState(""),[organizationId,setOrganizationId]=useState(""),[desktop,setDesktop]=useState(false);
 useEffect(()=>{const media=window.matchMedia("(min-width:1051px)"),update=()=>setDesktop(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);
 useEffect(()=>{
  const update=()=>{const params=new URLSearchParams(window.location.search),org=params.get('organizationId')||'';setView(params.get('view')||'');setOrganizationId(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org)?org:'');};
  update();window.addEventListener('regpilot-workspace-navigation',update);window.addEventListener('popstate',update);
  return()=>{window.removeEventListener('regpilot-workspace-navigation',update);window.removeEventListener('popstate',update);};
 },[path]);
 const current=path.startsWith('/team/work/')?'/team/work':path==="/team/operations"&&view?path+"?view="+view:path;
 const scoped=(href:string)=>organizationId&&href!=='/workbench'?href+(href.includes('?')?'&':'?')+'organizationId='+encodeURIComponent(organizationId):href;
 const link=(label:string,href:string)=><a key={href} href={scoped(href)} aria-current={current===href?"page":undefined}>{label}</a>;
 return <aside className={styles.sidebar}>
  <a className={styles.brand} href={scoped('/team/operations')}><span aria-hidden="true">R</span><strong>RegPilot <small>Private workspace</small></strong></a>
  <nav className={styles.primary} aria-label="Main workspace">{primary.map(item=>link(item.label,item.href))}</nav>
  <details className={styles.more} key={current} open={desktop&&!primary.some(item=>item.href===current)}>
   <summary>More tools & settings</summary>
   {groups.map(group=><nav key={group.label} aria-label={group.label}><h2>{group.label}</h2>{group.links.map(([label,href])=>link(label,href))}</nav>)}
  </details>
 </aside>;
}
