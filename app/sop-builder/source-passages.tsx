"use client";
import {useEffect,useRef,useState} from "react";
import type {ResearchResult} from "../../lib/regulatory/research";
import {REGULATORY_SOURCES,officialSourceUrl} from "../../lib/regulatory-sources.mjs";
import type {SopDraft,SopReceipt} from "../../lib/sop-draft";
import css from "./sop.module.css";

type Props={draft:SopDraft;topic:string;onDraft:(draft:SopDraft)=>void};
export function SourcePassages({draft,topic,onDraft}:Props){
  const [query,setQuery]=useState(topic),[result,setResult]=useState<ResearchResult|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>{setResult(null);setNotice("");setBusy(false);return ()=>pending.current?.abort();},[draft.nation]);
  async function research(){
    pending.current?.abort();
    const call=new AbortController();pending.current=call;setNotice("");setBusy(true);setResult(null);
    try{
      const resp=await fetch("/api/ai/research",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:query,...(draft.nation?{nation:draft.nation}:{})}),signal:call.signal,cache:"no-store"});
      const body=await resp.json();if(!resp.ok)throw Error(body.error||"Source search failed.");
      if(!call.signal.aborted)setResult(body);
    }catch(error){if(!call.signal.aborted)setNotice(error instanceof Error?error.message:"Source search failed.");}
    finally{if(!call.signal.aborted)setBusy(false);}
  }
  function attach(p:SopReceipt,instruction?:string){
    const {id,sourceId,documentHash,start,end,quote}=p;
    const present=draft.sources.some(s=>s.id===id);
    if(!present&&draft.sources.length>=5)return;
    if(instruction&&(draft.steps.length>=24||!p.quote.includes(instruction)))return;
    const sources=present?draft.sources:[...draft.sources,{id,sourceId,documentHash,start,end,quote}];
    const steps=instruction?[...draft.steps,{role:"",record:"",action:instruction,citationId:id}]:draft.steps;
    onDraft({...draft,sources,steps});
  }
  return <section className={css.card}><h2>Official guidance</h2>
    <p>Search with a public topic. Only this search phrase and the selected nation go to regulatory research.</p>
    <div className={css.actions}><label>Public research topic<input value={query} maxLength={500} onChange={e=>{pending.current?.abort();setBusy(false);setResult(null);setNotice("");setQuery(e.target.value);}}/></label>
    <button type="button" disabled={busy||query.trim().length<3} onClick={()=>void research()}>{busy?"Checking publications…":"Find official guidance"}</button></div>
    {notice&&<p role="alert">{notice}</p>}
    {result&&<div aria-live="polite">{result.citations.length===0?<p>{result.unavailable?"Some publications were unavailable. Retry or continue the draft with the gap recorded.":"No supporting passage found. Refine the activity or continue the draft with the gap recorded."}</p>:
      <><p>{result.citations.length} matching passages. Select those that apply to this procedure.</p>{result.citations.map(p=>{
        const point=result.answer?.points.find(a=>a.citationId===p.id&&p.quote.includes(a.text));
        return <details key={p.id}><summary>{p.agency} · {p.title}</summary><blockquote>{p.quote}</blockquote><a href={p.url} target="_blank" rel="noreferrer">Open publication</a>{" "}
        <button type="button" disabled={draft.sources.length>=5||draft.sources.some(c=>c.id===p.id)} onClick={()=>attach(p)}>{draft.sources.some(c=>c.id===p.id)?"Attached":"Attach passage"}</button>
        {point&&<div><p>Suggested source wording for an editable step</p><p>{point.text}</p><button type="button" disabled={draft.steps.length>=24||draft.steps.some(s=>s.citationId===p.id&&s.action===point.text)||(draft.sources.length>=5&&!draft.sources.some(s=>s.id===p.id))} onClick={()=>attach(p,point.text)}>Use wording in a new step</button></div>}</details>;})}</>}</div>}
    {draft.sources.length>0&&<div><h3>Attached passages</h3>{draft.sources.map(p=>{
      const s=REGULATORY_SOURCES.find(x=>x.id===p.sourceId);
      return <div key={p.id} className={css.passage}>{s?<a href={officialSourceUrl(s)} target="_blank" rel="noreferrer">{s.agency} · {s.title}</a>:<strong>Unrecognised source</strong>}
        <blockquote>{p.quote}</blockquote><button type="button" onClick={()=>onDraft({...draft,sources:draft.sources.filter(c=>c.id!==p.id),steps:draft.steps.map(s=>s.citationId===p.id?{...s,citationId:undefined}:s)})}>Remove passage</button></div>;
    })}</div>}
  </section>;
}
