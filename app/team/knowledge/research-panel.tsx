'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {researchWorkspaceQuestion} from '../../../lib/server/company-knowledge-service';
import {workspaceHref,type useWorkspaceContext} from '../../../lib/client/workspace-context';
import css from '../questionnaires/questionnaires.module.css';
type Result=Awaited<ReturnType<typeof researchWorkspaceQuestion>>;
type Passage=Result['evidence'][number];
function Citations({hits,empty,organizationId}:{hits:Passage[];empty:string;organizationId:string}){
 return hits.length?<ul>{hits.map(hit=><li key={hit.evidenceId}><strong>{hit.policy?hit.policy.title+' · revision '+hit.policy.number:hit.filename}</strong><details><summary>{hit.filename} · {hit.unitKind} {hit.unit} · view passage</summary><blockquote>{hit.quote}</blockquote><small>Characters {hit.start}–{hit.end}</small><p><a href={workspaceHref('/team/evidence',organizationId,{evidenceId:hit.evidenceId})}>Open reviewed file</a></p></details></li>)}</ul>:<p>{empty}</p>;
}
export function ResearchPanel({workspace,productId,scopeName}:{workspace:ReturnType<typeof useWorkspaceContext>;productId:string;scopeName:string}){
 const [question,setQuestion]=useState(''),[asset,setAsset]=useState(''),[result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 async function ask(event:FormEvent){
  event.preventDefault();
  if(pending.current)return;
  const abort=new AbortController();pending.current=abort;
  const current=workspace.capture();
  setResult(null);setError('');setBusy(true);
  try{
   const value=await workspace.request('/api/workspace/knowledge/research?'+new URLSearchParams({organizationId:workspace.organizationId}),{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({question,asset,productId:productId||null})});
   if(!abort.signal.aborted&&current()){
    if(value.organizationId!==workspace.organizationId||value.productId!==(productId||null))throw Error('The response belongs to a different workspace scope.');
    setResult(value);
   }
  }catch(problem){if(!abort.signal.aborted&&current())setError(problem instanceof Error?problem.message:'Search failed.');}
  finally{pending.current=null;if(!abort.signal.aborted&&current())setBusy(false);}
 }
 return <section id="workspace-research" className={css.panel}><h2>Ask across your compliance workspace</h2>
  <p>Search UK guidance, controls, risks, suppliers, audit work and approved documents. Document scope: {scopeName}.</p>
  <form onSubmit={ask}><div className={css.formGrid}><label>Question<input required minLength={3} maxLength={1200} disabled={busy} value={question} onChange={e=>{setQuestion(e.target.value);setResult(null);}} placeholder="Which controls and records cover supplier access?"/></label>
  <label>Limit evidence to a site or asset (optional)<input maxLength={100} disabled={busy} value={asset} onChange={e=>{setAsset(e.target.value);setResult(null);}} placeholder="Site name or equipment ID"/></label></div>
  <button type="submit" disabled={busy||productId==='INVALID'}>{busy?'Checking sources…':'Search guidance and company records'}</button></form>
  {error&&<p role="alert">{error}</p>}
  {result&&<div aria-live="polite"><p>Searched {result.documents} current reviewed company documents in this scope.</p>
  <h3>Official guidance</h3>{result.official.unavailable>0&&<p>{result.official.unavailable} shortlisted publications were unavailable.</p>}
  {result.official.answer.points.map(point=>{
   const source=result.official.citations.find(c=>c.id===point.citationId);
   return source?<p key={point.citationId+point.start}>{point.text} <a href={'#official-'+source.id}>{source.agency} passage</a></p>:null;
  })}
  {result.official.citations.length?result.official.citations.map(c=><details key={c.id} id={'official-'+c.id}><summary>{c.title}</summary><blockquote>{c.quote}</blockquote><a href={c.url}>Open original publication</a></details>):<p>No supporting official passage retrieved.</p>}
  <h3>Related workspace records</h3>
  {result.productId?<p>Clear the product filter to include organisation-wide operational records.</p>:result.records.length?<ul>{result.records.map(row=><li key={row.kind+row.id}><a href={row.href}>{row.title}</a> · {row.kind} · {row.status.replaceAll('_',' ')}</li>)}</ul>:<p>No matching operational records found.</p>}
  <h3>Current published procedures</h3><Citations organizationId={result.organizationId} hits={result.procedures} empty="No matching current published procedure found in the indexed records."/>
  <h3>Supporting evidence{result.asset?' for '+result.asset:''}</h3><Citations organizationId={result.organizationId} hits={result.evidence} empty="No matching reviewed evidence found in the indexed records for this scope."/>
  {result.evidence.length>0&&<p>Check the report date, coverage and review interval in the cited file before relying on it.</p>}
  </div>}</section>;
}
