"use client";

import {useCallback, useEffect, useId, useRef, useState, type FormEvent} from "react";
import type {Nation, ResearchResult, ResearchPassage, PassageCheck} from "../../lib/regulatory/research";
import {MIN_RESEARCH_QUESTION, MAX_RESEARCH_QUESTION} from "../../lib/regulatory/publication-query.mjs";
import styles from "./ai.module.css";
import {sopHref,sopIntent} from "../../lib/sop-draft";

const example = "Which publications cover GMP and wholesale dealer licensing for medicines?";
const nations: Nation[] = ["England","Scotland","Wales","Northern Ireland"];

const checkLabels:Record<PassageCheck["status"],string>={
  verified:"The publication text and quotation match the saved version.",
  same_position:"The publication changed. The quotation remains at its original position.",
  relocated:"The publication changed. The exact quotation now appears at a different position.",
  ambiguous:"The publication changed. The quotation now appears more than once.",
  missing:"The publication changed. The saved quotation no longer appears verbatim.",
  inconsistent:"The saved coordinates and publication text disagree.",
};

function RecheckCitation({passage}:{passage:ResearchPassage}) {
  const [checking,setChecking]=useState(false);
  const [message,setMessage]=useState("");
  async function recheck() {
    setChecking(true);setMessage("");
    try {
      const {id,sourceId,documentHash,start,end,quote}=passage;
      const response=await fetch("/api/ai/research/verify",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({id,sourceId,documentHash,start,end,quote}),cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw Error(data.error||"Could not recheck this publication.");
      const result:PassageCheck=data;
      setMessage(checkLabels[result.status]+(result.status==="relocated"?" New character range "+result.start+"–"+result.end+".":"")+
        " Checked "+new Date(result.checkedAt).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC.");
    } catch(e) {setMessage(e instanceof Error?e.message:"Could not recheck this publication.");}
    finally {setChecking(false);}
  }
  return <details><summary>Verify this passage</summary>
    <p>Captured {new Date(passage.checkedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC. Characters {passage.start}–{passage.end} in the extracted text (zero-based, end exclusive).</p>
    <p>Publication text SHA-256 <code>{passage.documentHash}</code></p>
    <button type="button" disabled={checking} onClick={()=>void recheck()}>{checking?"Checking publisher…":"Recheck publication"}</button>
    {message&&<p role="status">{message}</p>}
  </details>;
}

export function PublicationResults({result}:{result:ResearchResult}) {
  const publicationCount=new Set(result.citations.map(p=>p.sourceId)).size;
  const prefix=useId();
  const points=result.answer?.points || [];
  return <div className={styles.researchResults}>
    {!!points.length&&<section aria-label="RegPilot answer" className={styles.researchAnswer}>
      <h3>RegPilot answer</h3><p>In the publishers’ own words</p>
      {points.map(point=>{
        const citation=result.citations.find(c=>c.id===point.citationId);
        return citation&&<div key={point.citationId}>
          <p>{point.text}</p><a href={"#"+prefix+citation.id}>{citation.agency} · {citation.title}</a>
        </div>;
      })}
    </section>}
    {result.answer&&!result.answer.model&&!!result.citations.length&&<p role="note">The local answer model is unavailable. The matching publisher passages are below.</p>}
    {result.answer?.model&&!points.length&&!!result.citations.length&&<p role="status">I found related material, but couldn’t identify a sentence that answers this question.</p>}
    <p role="status">{result.citations.length
      ? `${result.citations.length} matching passage${result.citations.length===1?"":"s"} from ${publicationCount} publication${publicationCount===1?"":"s"}.`
      : result.unavailable ? "The available publications did not provide a matching passage. Part of the search is unavailable."
      : "I couldn’t find supporting guidance in this catalogue. Try adding the activity, regulator or licence you mean."}</p>
    {result.citations.map(p=><article key={p.id} id={prefix+p.id}>
      <h3><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a></h3>
      <span>{[p.agency,p.kind,p.jurisdictions.length ? p.jurisdictions.join(", ") : "Check territorial scope in the publication"].filter(Boolean).join(" · ")}</span>
      <blockquote>{p.quote}</blockquote>
      {p.scopeNote&&<small>{p.scopeNote}</small>}
      <RecheckCitation passage={p}/>
    </article>)}
    {!!result.unavailable&&<p role="note">{result.unavailable} shortlisted publication(s) could not be checked.</p>}
    <details><summary>Search coverage</summary>
      <p>Ranked a catalogue of {result.catalogueSize} publications and selected {result.checked.length} for passage matching. {result.nations.length ? "Territorial filter: "+result.nations.join(", ")+". " : ""}Results cover extracted page text. Linked files and legal applicability require separate review.</p>
      <ul>{result.checked.map(s=><li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> · {{matched:"Matched",unavailable:"Unavailable",no_passage:"No matching passage"}[s.status]}</li>)}</ul>
    </details>
  </div>;
}

export default function PublicationResearch() {
  const [question,setQuestion]=useState("");
  const [nation,setNation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<ResearchResult|null>(null);
  const pending=useRef(0);
  const region=useRef<HTMLElement>(null);
  const search=useCallback(async(value:string, territory="")=>{
    const request=++pending.current;
    setQuestion(value);setResult(null);setError("");setBusy(true);
    try {
      const response=await fetch("/api/ai/research",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({question:value,...(territory?{nation:territory}:{})}),cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw Error(data.error || "Source search unavailable. Try again.");
      if(request===pending.current)setResult(data);
    } catch(e) {if(request===pending.current)setError(e instanceof Error?e.message:"Source search unavailable.");}
    finally {if(request===pending.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    function openTopic() {
      const prefix="#source-research?";
      if(!location.hash.startsWith(prefix)) return;
      const value=new URLSearchParams(location.hash.slice(prefix.length)).get("q")?.trim();
      if(!value || value.length<MIN_RESEARCH_QUESTION || value.length>MAX_RESEARCH_QUESTION) return;
      region.current?.scrollIntoView();
      setNation("");void search(value);
    }
    openTopic();window.addEventListener("hashchange",openTopic);
    return ()=>{window.removeEventListener("hashchange",openTopic);pending.current++;};
  },[search]);
  function submit(event:FormEvent) {event.preventDefault();void search(question,nation);}
  return <section ref={region} id="source-research" aria-labelledby="research-heading" className={styles.research}>
    <h2 id="research-heading">Search UK regulatory sources</h2>
    <p>Enter a topic or ask a question in your own words. RegPilot searches UK publications by meaning and answers using sentences you can check at the source.</p>
    <form onSubmit={submit}>
      <label>Research question<input required minLength={MIN_RESEARCH_QUESTION} maxLength={MAX_RESEARCH_QUESTION} value={question} disabled={busy}
        placeholder="e.g. Where should I put sensors in my medicines store?" onChange={e=>{setQuestion(e.target.value);setResult(null);setError("");}}/></label>
      <label>UK nation<select value={nation} disabled={busy} onChange={e=>{setNation(e.target.value);setResult(null);setError("");}}>
        <option value="">Use my question</option>{nations.map(n=><option key={n}>{n}</option>)}
      </select></label>
      <button disabled={busy} type="submit">{busy?"Checking publications…":"Ask RegPilot"}</button>
    </form>
    <button type="button" className={styles.researchExample} disabled={busy} onClick={()=>void search(example,nation)}>Try a medicines question</button>
    {sopIntent(question)&&<p><a href={sopHref(question,nation)}>Build an SOP for this topic</a></p>}
    {busy&&<p role="status">Reading the shortlisted official publications…</p>}
    {error&&<p role="alert">{error}</p>}
    <p><a href="/team/knowledge#workspace-research">Compare guidance with your organisation’s procedures and evidence</a></p>
    {result&&<PublicationResults result={result}/>}
  </section>;
}
