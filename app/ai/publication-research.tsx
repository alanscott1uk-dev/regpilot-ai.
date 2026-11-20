"use client";

import {useState, type FormEvent} from "react";
import type {Nation, ResearchResult, ResearchPassage, PassageCheck} from "../../lib/regulatory/research";
import styles from "./ai.module.css";

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
  return <div className={styles.researchResults}>
    <p role="status">{result.citations.length
      ? `${result.citations.length} matching passage${result.citations.length===1?"":"s"} from ${publicationCount} publication${publicationCount===1?"":"s"}.`
      : result.unavailable ? "The available publications did not provide a matching passage. Part of the search is unavailable."
      : "No matching passage found. Try naming the regulator, activity or licence."}</p>
    {result.citations.map(p=><article key={p.id}>
      <h3><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a></h3>
      <span>{p.agency} · {p.jurisdictions.length ? p.jurisdictions.join(", ") : "Check territorial scope in the publication"}</span>
      <blockquote>{p.quote}</blockquote>
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
  async function search(value:string) {
    setQuestion(value);setResult(null);setError("");setBusy(true);
    try {
      const response=await fetch("/api/ai/research",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({question:value,...(nation?{nation}:{})}),cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw Error(data.error || "Source search unavailable. Try again.");
      setResult(data);
    } catch(e) {setError(e instanceof Error?e.message:"Source search unavailable.");}
    finally {setBusy(false);}
  }
  function submit(event:FormEvent) {event.preventDefault();void search(question);}
  return <section id="source-research" aria-labelledby="research-heading" className={styles.research}>
    <h2 id="research-heading">Search UK regulatory sources</h2>
    <p>Ask about a UK business activity to find exact passages from official publications. This search runs without an external AI model.</p>
    <form onSubmit={submit}>
      <label>Research question<input required minLength={8} maxLength={1500} value={question} disabled={busy}
        placeholder="Which guidance covers a wholesale dealer’s licence?" onChange={e=>{setQuestion(e.target.value);setResult(null);setError("");}}/></label>
      <label>UK nation<select value={nation} disabled={busy} onChange={e=>{setNation(e.target.value);setResult(null);setError("");}}>
        <option value="">Use my question</option>{nations.map(n=><option key={n}>{n}</option>)}
      </select></label>
      <button disabled={busy} type="submit">{busy?"Checking publications…":"Find passages"}</button>
    </form>
    <button type="button" className={styles.researchExample} disabled={busy} onClick={()=>void search(example)}>Try a medicines question</button>
    {busy&&<p role="status">Reading the shortlisted official publications…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<PublicationResults result={result}/>}
  </section>;
}
