'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {researchWorkspaceQuestion} from '../../../lib/server/company-knowledge-service';
import {workspaceHref,type useWorkspaceContext} from '../../../lib/client/workspace-context';
import {sopNations,sopHref,sopIntent} from "../../../lib/sop-draft";
import {RegulatorAccountSuggestions,SupplierRegisterLinks} from "../../components/regulator-account-links";
import css from '../questionnaires/questionnaires.module.css';
type Result=Awaited<ReturnType<typeof researchWorkspaceQuestion>>;
type Passage=Result['evidence'][number];
function Citations({hits,empty,organizationId}:{hits:Passage[];empty:string;organizationId:string}){
 return hits.length?<ul>{hits.map(hit=><li key={hit.evidenceId}><strong>{hit.policy?hit.policy.title+' · revision '+hit.policy.number:hit.filename}</strong>{hit.policy&&hit.namedAsset===false&&<span> · site applicability needs confirmation</span>}<details><summary>{hit.filename} · {hit.unitKind} {hit.unit} · view passage</summary><blockquote>{hit.quote}</blockquote><small>Characters {hit.start}–{hit.end}</small><p><a href={workspaceHref('/team/evidence',organizationId,{evidenceId:hit.evidenceId})}>Open reviewed file</a></p></details></li>)}</ul>:<p>{empty}</p>;
}
type ResearchProps={workspace:ReturnType<typeof useWorkspaceContext>;productId:string;scopeName:string};
export function ResearchPanel(props:ResearchProps){
 return <ScopedResearch key={props.workspace.revision+':'+props.workspace.organizationId+':'+props.productId} {...props}/>;
}
function ScopedResearch({workspace,productId,scopeName}:ResearchProps){
 const [question,setQuestion]=useState(''),[nation,setNation]=useState(''),[asset,setAsset]=useState(''),[result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  function follow(){const fragment=window.location.hash;if(fragment.startsWith("#workspace-research?")){
   setQuestion((new URLSearchParams(fragment.slice(fragment.indexOf("?")+1)).get("q")||"").slice(0,1200));setResult(null);
   document.getElementById("workspace-research")?.scrollIntoView({block:"start"});
  }}
  follow();window.addEventListener("hashchange",follow);
  return ()=>{window.removeEventListener("hashchange",follow);pending.current?.abort();};
 },[]);
 async function ask(event:FormEvent){
  event.preventDefault();
  if(pending.current)return;
  const abort=new AbortController();pending.current=abort;
  const current=workspace.capture();
  setResult(null);setError('');setBusy(true);
  try{
   const value=await workspace.request('/api/workspace/knowledge/research?'+new URLSearchParams({organizationId:workspace.organizationId}),{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({question,asset,nation:nation||undefined,productId:productId||null})});
   if(!abort.signal.aborted&&current()){
    if(value.organizationId!==workspace.organizationId||value.productId!==(productId||null))throw Error('The response belongs to a different workspace scope.');
    setResult(value);
   }
  }catch(problem){if(!abort.signal.aborted&&current())setError(problem instanceof Error?problem.message:'Search failed.');}
  finally{pending.current=null;if(!abort.signal.aborted&&current())setBusy(false);}
 }
 return <section id="workspace-research" className={css.panel}><h2>Ask across your compliance workspace</h2>
  <p>Search UK guidance, controls, risks, suppliers, audit work and approved documents. Document scope: {scopeName}.</p>
  {sopIntent(question)&&<p><a href={workspaceHref(sopHref(question,nation),workspace.organizationId)}>Build an SOP for this topic</a></p>}
  <form onSubmit={ask}><div className={css.formGrid}><label>Question<input required minLength={3} maxLength={1200} disabled={busy} value={question} onChange={e=>{setQuestion(e.target.value);setResult(null);}} placeholder="Which controls and records cover supplier access?"/></label>
  <label>UK nation for official guidance<select value={nation} disabled={busy} onChange={e=>{setNation(e.target.value);setResult(null);}}><option value="">All UK nations</option>{sopNations.map(n=><option key={n}>{n}</option>)}</select></label>
  <label>Limit evidence to a site or asset (optional)<input maxLength={100} disabled={busy} value={asset} onChange={e=>{setAsset(e.target.value);setResult(null);}} placeholder="Site name or equipment ID"/></label></div>
  <button type="submit" disabled={busy||productId==='INVALID'}>{busy?'Checking sources…':'Search guidance and company records'}</button></form>
  <RegulatorAccountSuggestions question={question} nation={nation}/>
  {error&&<p role="alert">{error}</p>}
  {result&&<div aria-live="polite"><p>Searched {result.documents} current reviewed company documents in this scope.</p>
  {result.clarifications.length>0&&<><h3>What still needs confirming</h3><ul>{result.clarifications.map(q=><li key={q}>{q}</li>)}</ul></>}
  {result.connections.length>0&&<><h3>Connected evidence and outstanding actions</h3><ul>{result.connections.map(c=><li key={c.id}>
    <a href={workspaceHref(c.href,result.organizationId)}>{c.target}</a> · <strong>{c.status}</strong> · {c.reason}
    <p>Owner {c.owner} · {c.checksFailed} failed · {c.checksUnknown} unknown</p>
    {c.sourceUrl&&<p><a href={c.sourceUrl}>Provider source</a> · captured {c.sourceCapturedAt} · expires {c.expiresAt}</p>}
    {c.findings.length>0&&<details><summary>Provider checks ({c.findings.length} of {c.checksSeen})</summary>{c.findings.map(f=><p key={f.id}><strong>{f.label}</strong> · {f.status} · {f.observed} {f.sourceUrl&&<a href={f.sourceUrl} rel="noreferrer">Source record</a>}</p>)}</details>}
    {c.openTasks.map(t=><p key={t.id}><a href={workspaceHref("/team/work",result.organizationId,{taskId:t.id})}>{t.title}</a> · {t.ownerName}</p>)}
  </li>)}</ul></>}
  {!!result.partnerReports?.length&&<section><h3>Reviewed partner reports</h3>{result.partnerReports.map(r=><article key={r.id}>
   <h4><a href={workspaceHref('/team/developers',result.organizationId,{observationId:r.id})}>{r.kind} · {r.recordId}</a></h4>
   <p>{r.summary}</p><p>{r.outcome?.replaceAll('_',' ').toLowerCase()} · Reported by {r.source} · Responsible party {r.owner}</p>
   <details><summary>Source and review dates</summary><p>Observed {r.observedAt} · Reviewed {r.reviewedAt} · Valid until {r.validUntil}</p>
    <p>Source version {r.sourceVersion} · Report revision {r.revision} · Receipt {r.receiptHash}</p>
    {r.sourceUrl&&<a href={r.sourceUrl} rel="noreferrer">Open source record</a>}</details>
   {r.taskId&&<a href={workspaceHref('/team/work',result.organizationId,{taskId:r.taskId})}>Open follow-up task</a>}
  </article>)}</section>}
  {result.suppliers.length>0&&<><h3>Supplier reviews and public records</h3>{result.suppliers.map(s=><div key={s.id}>
    <p><a href={workspaceHref("/team/vendors",result.organizationId,{vendorId:s.id})}>{s.name}</a>{s.premises&&<> · {s.activity} at {s.premises}</>}</p>
    <p>{s.number&&<>UK WDA(H) {s.number} · </>}{s.reviewState.replaceAll("_"," ")}{s.recommendation?" · "+s.recommendation:""} · Owner {s.owner}</p>
    {s.requiredEntries.length>0&&<p>Required annex entries · {s.requiredEntries.map(e=>e.code+" "+e.label).join(", ")}</p>}
    {s.accounting&&<p>Last accounting comparison · {s.accounting.provider==='xero'?'Xero':'QuickBooks'} · {s.accounting.checkedAt.slice(0,10)} · supplier revision {s.accounting.vendorVersion} · {s.accounting.issues.join(' · ')||'Name and active status matched at check time'}</p>}
    <SupplierRegisterLinks links={s.publicRecords}/>{s.checkedOn&&<p>Last MHRA register check {s.checkedOn}</p>}
    {s.findings.map(f=><p key={f}>{f}</p>)}{s.openTasks.map(t=><p key={t.id}><a href={workspaceHref("/team/work",result.organizationId,{taskId:t.id})}>{t.title}</a></p>)}</div>)}</>}
  <h3>Official guidance</h3>{result.official.scopeQuestion&&<p>{result.official.scopeQuestion}</p>}{result.official.unavailable>0&&<p>{result.official.unavailable} shortlisted publications were unavailable.</p>}
  {result.official.answer.points.map(point=>{
   const source=result.official.citations.find(c=>c.id===point.citationId);
   return source?<p key={point.citationId+point.start}>{point.text} <a href={'#official-'+source.id}>{source.agency} passage</a></p>:null;
  })}
  {result.official.citations.length?result.official.citations.map(c=><details key={c.id} id={'official-'+c.id}><summary>{c.title}</summary><blockquote>{c.quote}</blockquote><p>{c.jurisdictions.join(", ")} · checked {c.checkedAt}{c.revisionAt?" · publisher revision "+c.revisionAt:""}</p><a href={c.url}>Open original publication</a></details>):<p>No supporting official passage retrieved.</p>}
  {result.official.checked.filter(source=>source.status==='manual_refresh').map(source=><p key={source.id}>
   <a href={workspaceHref('/team/sources',result.organizationId,{sourceId:source.id})}>{source.title} · open manual refresh</a>
  </p>)}
  {result.requirements&&<section><h3>Reviewed requirements and applicability</h3>
   {result.requirements.notice&&<p>{result.requirements.notice}</p>}
   {!result.requirements.hits.length&&!result.requirements.notice&&<p>No matching current requirement found.</p>}
   {result.requirements.hits.map(r=><article key={r.id}>
    <h4><a href={workspaceHref('/team/library',result.organizationId,{revisionId:r.id})}>{r.reference} · {r.title}</a></h4>
    <p>{r.collection} · revision {r.edition} · {r.kind.toLowerCase()} · {r.decision?r.decision.replaceAll('_',' ').toLowerCase():'Applicability needs review'}</p>
    <blockquote>{r.quote}</blockquote>
    {r.conditions.map(v=><p key={v}>Condition · {v}</p>)}{r.exceptions.map(v=><p key={v}>Exception · {v}</p>)}
    {r.effectivity&&<p>Effective from {r.effectivity.from}{r.effectivity.through&&' through '+r.effectivity.through} · {r.effectivity.quote}</p>}
    {r.rationale&&<p>{r.rationale}</p>}{r.owner&&<p>Owner · {r.owner}</p>}
    <p>Business profile {r.profileVersion} · {r.nations.join(', ')}</p>
    <p><a href={r.source.url||workspaceHref('/team/evidence',result.organizationId,{evidenceId:r.source.id})}>{r.source.title}</a>
     {r.source.block?' · Word block '+r.source.block:r.source.page?' · PDF page '+r.source.page:''} · characters {r.source.start}–{r.source.end}</p>
   </article>)}</section>}
  <h3>Related workspace records</h3>
  {result.productId?<p>Clear the product filter to include organisation-wide operational records.</p>:result.records.length?<ul>{result.records.map(row=><li key={row.kind+row.id}><a href={row.href}>{row.title}</a> · {row.kind} · {row.status.replaceAll('_',' ')}</li>)}</ul>:<p>No matching operational records found.</p>}
  <h3>Current published procedures</h3><Citations organizationId={result.organizationId} hits={result.procedures} empty="No matching current published procedure found in the indexed records."/>
  <h3>Supporting evidence{result.asset?' for '+result.asset:''}</h3><Citations organizationId={result.organizationId} hits={result.evidence} empty="No matching reviewed evidence found in the indexed records for this scope."/>
  {result.evidence.length>0&&<p>Check the report date, coverage and review interval in the cited file before relying on it.</p>}
  </div>}</section>;
}
