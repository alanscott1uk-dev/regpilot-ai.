"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import styles from "./workspace-nav.module.css";
import ToolFinder from "./tool-finder";
import {dailyTools,workspaceTools,toolGroups} from "./workspace-tools";
const icons:Record<string,string>={help:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-13a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01",today:"M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",tasks:"m3 6 2 2 3-4M11 6h10M3 13l2 2 3-4m3 2h10M3 20l2 2 3-4m3 2h10",updates:"M4 20h16M6 16V9m6 7V4m6 12v-6M3 4h4m10 0h4",evidence:"M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8ZM14 2v6h6M8 12h8m-8 4h6",reports:"M4 3h16v18H4ZM8 17v-3m4 3V9m4 8V6",setup:"M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",connections:"m9 15 6-6m-5-4 2-2a5 5 0 0 1 7 7l-2 2M14 19l-2 2a5 5 0 0 1-7-7l2-2"};
export function WorkspaceIcon({name}:{name:string}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]||icons.evidence}/></svg>;}
export default function WorkspaceNav(){
 const path=usePathname(),[view,setView]=useState(""),[organizationId,setOrganizationId]=useState("");
 useEffect(()=>{
  const update=()=>{const params=new URLSearchParams(window.location.search),org=params.get('organizationId')||'';setView(params.get('view')||'');setOrganizationId(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org)?org:'');};
  update();window.addEventListener('regpilot-workspace-navigation',update);window.addEventListener('popstate',update);
  return()=>{window.removeEventListener('regpilot-workspace-navigation',update);window.removeEventListener('popstate',update);};
 },[path]);
 const current=path.startsWith('/team/work/')?'/team/work':path==="/team/operations"&&view&&view!=="today"?path+"?view="+view:path;
 const scoped=(href:string)=>organizationId&&href!=='/workbench'?href+(href.includes('?')?'&':'?')+'organizationId='+encodeURIComponent(organizationId):href;
 const link=(label:string,href:string,icon?:string)=><a key={href} href={scoped(href)} aria-current={current===href?"page":undefined}>{icon&&<WorkspaceIcon name={icon}/>}<span>{label}</span></a>;
 const selected=toolGroups.flatMap(group=>group.tools).find(item=>item.href===current);
 return <aside className={styles.sidebar}>
  <div className={styles.navTop}>
   <a className={styles.brand} href={scoped('/team/operations')} aria-label="RegPilot home"><span aria-hidden="true"><svg width="21" height="24" viewBox="0 0 21 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M4 21V3h6a5 5 0 0 1 0 10H4m6 0 7 8"/></svg></span><strong>RegPilot</strong></a>
   <ToolFinder current={current} scoped={scoped}/>
  </div>
  <p className={styles.caption}>Your daily work</p>
  <nav className={styles.primary} aria-label="Main workspace">{dailyTools.map(item=>link(item.label,item.href,item.icon))}</nav>
  <nav className={styles.workspace} aria-label="Workspace configuration"><h2>Workspace</h2>{workspaceTools.map(item=>link(item.label,item.href,item.icon))}</nav>
  {selected&&!dailyTools.some(item=>item.href===current)&&<p className={styles.location}>Current tool <strong>{selected.label}</strong></p>}
  <div className={styles.pilot}><span aria-hidden="true"/><div><strong>Private pilot</strong><p>Fictional or non-sensitive records</p></div></div>
 </aside>;
}
