"use client";
import {useEffect,useRef,useState} from "react";
import WorkspaceNav from "../components/workspace-nav";
import {researchHandoff} from "../../lib/operator-answer";
import {helpArticles,searchHelp} from "../../lib/help-centre";
import {workUuid} from "../../lib/work-hub.mjs";
import shell from "../workbench/workbench.module.css";
import ui from "../sop-builder/sop.module.css";
const categories=[...new Set(helpArticles.map(a=>a.category))];
export default function HelpCentre(){
  const [query,setQuery]=useState(""),[category,setCategory]=useState(""),[active,setActive]=useState(""),[org,setOrg]=useState("");
  const search=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    function follow(){
      const id=location.hash.slice(1);
      if(helpArticles.some(a=>a.id===id)){setCategory("");setQuery("");setActive(id);requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({block:"start"}));}
      else setActive("");
      const candidate=new URLSearchParams(location.search).get("organizationId")||"";setOrg(workUuid(candidate)?candidate:"");
    }
    follow();window.addEventListener("hashchange",follow);return()=>window.removeEventListener("hashchange",follow);
  },[]);
  function href(target:string){
    if(!org||(!target.startsWith("/team")&&!target.startsWith("/sop-builder")&&target!=="/regulator-accounts"))return target;
    const url=new URL(target,"https://regpilot.invalid");url.searchParams.set("organizationId",org);return url.pathname+url.search+url.hash;
  }
  function choose(id:string){
    const next=active===id?"":id;setActive(next);
    history.replaceState(history.state,"",location.pathname+location.search+(next?"#"+next:""));
  }
  const hits=searchHelp(query,category);
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}><div className={ui.body}><header className={ui.intro}><div><h1>Help Centre</h1><p>Find instructions for your next task or troubleshoot a result in RegPilot.</p></div></header>
    <section className={ui.card} aria-label="Find help"><div className={ui.grid}><label>Search help<input ref={search} value={query} maxLength={160} placeholder="e.g. write an SOP, missing guidance or stale connection" onChange={e=>{setQuery(e.target.value);setActive("");}}/></label>
    <label>Topic<select value={category} onChange={e=>{setCategory(e.target.value);setActive("");}}><option value="">All topics</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
    <p>{query.trim().length>=3&&<a href={researchHandoff(query,org)}>Ask this question across procedures, UK guidance and connected evidence</a>}</p>
    <p role="status">{hits.length} {hits.length===1?"guide":"guides"}</p></section>
    {!hits.length&&<section className={ui.card}><h2>No matching guide</h2><p>Try a task name such as “SOP”, “supplier” or “sign in”.</p><button onClick={()=>{setQuery("");setCategory("");search.current?.focus();}}>Show all guides</button></section>}
    {hits.map(a=><article className={ui.card} id={a.id} key={a.id}><h2><button type="button" aria-controls={"guide-"+a.id} aria-expanded={active===a.id} onClick={()=>choose(a.id)}>{a.title}</button></h2><p>{a.summary}</p>
      <div id={"guide-"+a.id} hidden={active!==a.id}><ol>{a.steps.map(s=><li key={s}>{s}</li>)}</ol><div className={ui.actions}>{a.links.map(([label,url])=><a key={url} href={href(url)}>{label}</a>)}</div></div></article>)}</div></main></div>;
}
