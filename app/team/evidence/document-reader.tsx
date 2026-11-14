"use client";
import {useEffect,useRef,useState} from "react";
import {locationLabel} from "../../../lib/documents/coverage";
import type {inspectEvidence} from "../../../lib/server/document-inspection";
import ui from "./evidence.module.css";
type Inspection=Awaited<ReturnType<typeof inspectEvidence>>;
export function DocumentReader({organizationId,evidenceId,request}:{organizationId:string;evidenceId:string;request:(path:string,options?:RequestInit)=>Promise<Response>}){
  const [result,setResult]=useState<Inspection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[search,setSearch]=useState(""),[limit,setLimit]=useState(20);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  async function inspect(){if(busy)return;const abort=new AbortController();controller.current=abort;setBusy(true);setError("");try{const r=await request("/api/workspace/evidence/"+evidenceId+"/inspect",{method:"POST",signal:abort.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId})});const data=await r.json();if(!abort.signal.aborted)setResult(data);}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:"Document inspection unavailable");}finally{if(!abort.signal.aborted)setBusy(false);}}
  const visible=result?.units.filter(u=>(u.text+" "+(u.label||"")).toLowerCase().includes(search.toLowerCase()))||[];
  return <details className={ui.reader}><summary>Check what RegPilot can read</summary><p>Inspect extracted text before asking for a programme or assessment. This check runs locally on the server and makes no paid AI call.</p>
    {!result&&<button disabled={busy} onClick={()=>void inspect()}>{busy?"Reading document…":"Inspect document"}</button>}{error&&<p role="alert">{error}</p>}
    {result&&<><strong>{result.blocked?"Resolve content gaps":"Text ready for human review"}</strong><p>{result.nextStep}</p><p>{result.coverage.extractedPages} / {result.coverage.totalPages} {result.coverage.unitKind==="block"?"Word blocks":"pages"} · {result.characters.toLocaleString("en-GB")} extracted characters{result.coverage.truncated?" · extraction limit reached":""}</p>
      {!!result.coverage.skippedPages.length&&<p>Unreadable pages: {result.coverage.skippedPages.join(", ")}. Provide a text-based copy; OCR is not enabled.</p>}
      <ul>{[...(result.coverage.blockingIssues||[]),...result.warnings].map(w=><li key={w}>{w}</li>)}</ul>
      <label>Find text in this document<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setLimit(20);}} placeholder="Search a policy, date or responsibility…"/></label>
      <p role="status">{visible.length} matching locations</p><div className={ui.readingPane}>{visible.slice(0,limit).map(u=><article key={u.page}><strong>{locationLabel(u.page,result.coverage.unitKind,u.label)}</strong><pre>{u.text}</pre></article>)}</div>
      {visible.length>limit&&<button onClick={()=>setLimit(n=>n+20)}>Show 20 more locations</button>}
      <a href="/team/operations">Use documents to prepare a programme ↗</a>
    </>}
  </details>;
}
