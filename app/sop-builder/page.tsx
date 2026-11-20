"use client";
import {useEffect,useRef,useState} from "react";
import WorkspaceNav from "../components/workspace-nav";
import {useWorkspaceContext} from "../../lib/client/workspace-context";
import {inferSopStarter,newSopDraft,sopDraftSchema,sopNations,sopOpenItems,sopStarterNames,type SopDraft,type SopStarter} from "../../lib/sop-draft";
import {SourcePassages} from "./source-passages";
import {ReviewHandoff,type ExportedSop} from "./review-handoff";
import shell from "../workbench/workbench.module.css";
import css from "./sop.module.css";

const fields=[
  ["title","Procedure title",160],["reference","Document reference",80],["revision","Draft revision",40],["owner","Accountable owner",120],
  ["purpose","Purpose",750],["scope","Scope and site",800],
] as const;
function download(blob:Blob,filename:string){
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function Editor({workspace}:{workspace:ReturnType<typeof useWorkspaceContext>}){
  const [topic,setTopic]=useState(""),[starter,setStarter]=useState<SopStarter>("general"),[nation,setNation]=useState<SopDraft["nation"]>("");
  const [draft,setDraft]=useState<SopDraft|null>(null),[message,setMessage]=useState(""),[building,setBuilding]=useState(false);
  const [exported,setExported]=useState<ExportedSop|null>(null);
  const uploading=useRef(false),alive=useRef(true),revision=useRef(0);
  useEffect(()=>{
    alive.current=true;
    const params=new URLSearchParams(location.hash.slice(1)),q=(params.get("q")||"").slice(0,160),n=sopNations.find(v=>v===params.get("nation"))||"";
    setTopic(q);setStarter(inferSopStarter(q));setNation(n);
    return ()=>{alive.current=false;revision.current++;};
  },[]);
  function change(d:SopDraft){revision.current++;setDraft(d);setExported(null);setMessage("");}
  async function openFile(file?:File){
    if(!file)return;
    const version=revision.current;
    try{
      if(file.size>192*1024)throw Error("Choose a RegPilot draft under 192 KiB.");
      const data=sopDraftSchema.safeParse(JSON.parse(await file.text()));
      if(!data.success)throw Error("Choose a valid RegPilot .json draft file.");
      if(alive.current&&revision.current===version){setTopic(data.data.title);change(data.data);}
    }catch(e){if(alive.current&&revision.current===version)setMessage(e instanceof Error?e.message:"This draft could not be opened.");}
  }
  async function exportWord(){
    if(!draft||uploading.current)return;
    uploading.current=true;setBuilding(true);setExported(null);setMessage("");
    const version=revision.current;
    try{
      const response=await fetch("/api/sop-builder/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft),cache:"no-store"});
      if(!response.ok){const problem=await response.json();throw Error(problem.error||"Word export failed.");}
      const blob=await response.blob(),filename=response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]||"procedure-draft.docx";
      if(alive.current&&version===revision.current){setExported({blob,filename});download(blob,filename);setMessage("Word draft prepared. Keep the editable RegPilot draft to resume here later.");}
    }catch(e){if(alive.current&&version===revision.current)setMessage(e instanceof Error?e.message:"Word export failed.");}
    finally{uploading.current=false;if(alive.current)setBuilding(false);}
  }
  const openItems=draft?sopOpenItems(draft):[];
  return <><header className={css.intro}><div><h1>SOP builder</h1><p>Create a standard operating procedure someone can follow. Choose a starting point, assign each step and attach official guidance for review.</p></div><a href={"/help"+(workspace.organizationId?"?"+new URLSearchParams({organizationId:workspace.organizationId}):"")+"#sop-builder"}>SOP builder help</a></header>
    {!draft?<section className={css.card}><h2>Start a procedure</h2><form onSubmit={e=>{e.preventDefault();change(newSopDraft(topic,starter,nation));}}>
      <label>What procedure are you writing?<input maxLength={160} placeholder="e.g. temperature mapping or staff offboarding" value={topic} onChange={e=>{setTopic(e.target.value);setStarter(inferSopStarter(e.target.value));}}/></label>
      <div className={css.grid}><label>Starting point<select value={starter} onChange={e=>setStarter(e.target.value as SopStarter)}>{Object.entries(sopStarterNames).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label>
      <label>UK nation<select value={nation} onChange={e=>setNation(e.target.value as SopDraft["nation"])}><option value="">Choose later</option>{sopNations.map(n=><option key={n}>{n}</option>)}</select></label></div>
      <button type="submit">Create SOP draft</button></form><div className={css.resume}><label>Resume a saved RegPilot draft<input type="file" accept=".json,application/json" onChange={e=>void openFile(e.target.files?.[0])}/></label></div></section>:
    <><section className={css.card}><div className={css.heading}><h2>Draft details</h2><button type="button" onClick={()=>{if(confirm("Start another procedure? Save this editable draft first to keep your changes.")){revision.current++;setDraft(null);setTopic("");setStarter("general");setExported(null);setMessage("");}}}>Start another</button></div>
      <div className={css.grid}>{fields.map(([key,label,max])=><label key={key}>{label}{max>700?<textarea rows={3} maxLength={max} value={draft[key]} onChange={e=>change({...draft,[key]:e.target.value})}/>:<input maxLength={max} value={draft[key]} onChange={e=>change({...draft,[key]:e.target.value})}/>}</label>)}
      <label>UK nation<select value={draft.nation} onChange={e=>change({...draft,nation:e.target.value as SopDraft["nation"]})}><option value="">Choose later</option>{sopNations.map(n=><option key={n}>{n}</option>)}</select></label></div></section>
      <section className={css.card}><h2>Procedure steps</h2>{draft.steps.map((s,i)=><fieldset key={i}><legend>Step {i+1}</legend>
        <label>Instruction<textarea rows={2} maxLength={900} value={s.action} onChange={e=>change({...draft,steps:draft.steps.map((x,j)=>j===i?{...x,action:e.target.value}:x)})}/></label>
        <div className={css.grid}>{([["role","Responsible role",120],["record","Evidence to retain",360]] as const).map(([key,label,max])=><label key={key}>{label}<input maxLength={max} value={s[key]} onChange={e=>change({...draft,steps:draft.steps.map((x,j)=>j===i?{...x,[key]:e.target.value}:x)})}/></label>)}</div>
        {draft.sources.length>0&&<label>Supporting passage<select value={s.citationId||""} onChange={e=>change({...draft,steps:draft.steps.map((x,j)=>j===i?{...x,citationId:e.target.value||undefined}:x)})}><option value="">No attached passage</option>{draft.sources.map((p,n)=><option key={p.id} value={p.id}>{n+1}. {p.quote.slice(0,78)}</option>)}</select></label>}
        <div className={css.actions}>{i>0&&<button type="button" onClick={()=>{const steps=[...draft.steps];[steps[i-1],steps[i]]=[steps[i],steps[i-1]];change({...draft,steps});}}>Move step {i+1} up</button>}
        {draft.steps.length>1&&<button type="button" onClick={()=>change({...draft,steps:draft.steps.filter((_,j)=>j!==i)})}>Remove step {i+1}</button>}</div></fieldset>)}
        <button type="button" disabled={draft.steps.length>=24} onClick={()=>change({...draft,steps:[...draft.steps,{role:"",action:"",record:""}]})}>Add step</button></section>
      <section className={css.card}><h2>Exceptions and site decisions</h2><label>What triggers escalation, and who decides?<textarea maxLength={1000} rows={3} value={draft.exceptions} onChange={e=>change({...draft,exceptions:e.target.value})}/></label>
      <label>Site decisions to confirm<textarea maxLength={1200} rows={3} value={draft.localChecks} onChange={e=>change({...draft,localChecks:e.target.value})}/></label></section>
      <SourcePassages draft={draft} topic={topic||draft.title||"standard operating procedures"} onDraft={change}/>
      <section className={css.card}><h2>Save and review</h2>
        <p>The Word document includes the current instructions, outstanding site decisions and attached passages. It is marked as a draft for independent review.</p>
        <details><summary>{openItems.length} incomplete {openItems.length===1?"field":"fields"}</summary>{openItems.length?<ul>{openItems.map(i=><li key={i}>{i}</li>)}</ul>:<p>All tracked fields are filled. The reviewer must assess suitability for the site.</p>}</details>
        <div className={css.actions}><button type="button" disabled={building||!draft.title.trim()} onClick={()=>void exportWord()}>{building?"Preparing Word…":"Download Word draft"}</button>
        <button type="button" onClick={()=>download(new Blob([JSON.stringify(draft,null,2)],{type:"application/json"}),"regpilot-sop-draft.json")}>Save editable draft</button></div>
        {exported&&<ReviewHandoff workspace={workspace} document={exported}/>}</section></>}
    {message&&<p className={css.notice} role="status">{message}</p>}</>;
}
export default function SopBuilderPage(){
  const workspace=useWorkspaceContext();
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}><div className={css.body}><Editor key={workspace.userId+"|"+workspace.organizationId} workspace={workspace}/></div></main></div>;
}
