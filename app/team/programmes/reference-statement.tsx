'use client';
import {useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import {referenceStatementCsv,referenceEvidence,referenceEvidenceCsv,evidenceViews,type EvidenceView,type ReferenceStatement} from '../../../lib/programme-reference-csv';

export function ReferenceStatementPanel({w,id}:{w:ReturnType<typeof useWorkspaceContext>;id:string}){
 const [data,setData]=useState<ReferenceStatement|null>(null),[selection,choose]=useState(''),[busy,lock]=useState(false),[message,tell]=useState('');
 const [filter,setFilter]=useState<EvidenceView|'all'>('all');
 const url='/api/workspace/programmes/'+id+'/references?'+new URLSearchParams({organizationId:w.organizationId});
 async function load(){
  const current=w.capture();
  const result=await w.request(url) as ReferenceStatement;
  if(result.programmeId!==id)throw Error('The saved programme changed.');
  if(current())setData(result);
 }
 async function run(fn:()=>Promise<void>){const current=w.capture();lock(true);tell('');try{await fn();}catch(e){if(current())tell(e instanceof Error?e.message:'The scope decision could not be loaded.');}finally{if(current())lock(false);}}
 const rows=data?.rows??[],counts={scope:0,unlinked:0,missing:0,limited:0,covered:0,excluded:0};
 for(const entry of rows)counts[referenceEvidence(entry,!!data?.evidenceLimited)]++;
 const visible=rows.filter(entry=>filter==='all'||referenceEvidence(entry,!!data?.evidenceLimited)===filter);
 const nextUnassessed=visible.find(r=>r.decision==='UNASSESSED'&&r.reference!==selection);
 const row=visible.find(r=>r.reference===selection)??nextUnassessed??visible[0];
 return <details onToggle={e=>{if(e.currentTarget.open&&!data&&!busy)void run(load);}}><summary>Statement of applicability by framework reference</summary>
 {message&&<p role="alert">{message}</p>}{!data?<button disabled={busy} onClick={()=>void run(load)}>Load decisions</button>:<>
 <p aria-live="polite">Decisions recorded for {data.rows.filter(r=>r.decision==='APPLIES'||r.decision==='EXCLUDED').length} of {data.rows.length} references.</p>
 <button type="button" disabled={busy} onClick={()=>void run(load)}>Refresh decisions</button>{' '}
 <button type="button" onClick={()=>{const link=document.createElement('a'),url=URL.createObjectURL(new Blob([referenceStatementCsv(data)],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='statement-of-applicability.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download statement of applicability</button>
 <label>Filter references by evidence<select disabled={busy} value={filter} onChange={e=>{setFilter(e.target.value as typeof filter);choose('');}}>
 <option value="all">All references ({rows.length})</option>{(Object.keys(evidenceViews) as EvidenceView[]).map(key=><option key={key} value={key}>{evidenceViews[key]} ({counts[key]})</option>)}</select></label>
 {filter!=='all'&&visible.length>0&&<button type="button" onClick={()=>{const link=document.createElement('a'),url=URL.createObjectURL(new Blob([referenceEvidenceCsv(data,visible)],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='audit-evidence-'+filter+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download filtered references and tasks</button>}
 {!visible.length&&<p role="status">No references match this filter.</p>}
 {row&&<><label>Framework reference<select aria-label="Framework reference" value={row.reference} disabled={busy} onChange={e=>choose(e.target.value)}>{visible.map(r=><option key={r.reference} value={r.reference}>{r.reference} · {r.decision.replaceAll('_',' ').toLowerCase()}</option>)}</select></label>
 {row.decision!=='UNASSESSED'&&nextUnassessed&&<button type="button" disabled={busy} onClick={()=>choose(nextUnassessed.reference)}>Review next unassessed reference</button>}
 <p>{row.area} · {evidenceViews[referenceEvidence(row,data.evidenceLimited)]}</p>
 {row.tasks.length>0&&<ul>{row.tasks.map(task=><li key={task.id}><a href={task.href}>{task.title}</a> · {task.owner||'Unassigned'} · {task.status} · {task.reviewedFiles.length} reviewed files</li>)}</ul>}
 <form key={row.reference+'-'+row.version} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),current=w.capture();void run(async()=>{
  await w.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:row.reference,version:row.version,recordHash:data.recordHash,decision:form.get('decision'),reason:form.get('reason')})});
  if(current()){choose(row.reference);await load();if(current())tell('Scope decision recorded.');}
 });}}><fieldset disabled={busy}><legend>Record the scope decision</legend><label>Applicability<select aria-label="Applicability" required name="decision" defaultValue={row.version?row.decision:''}><option value="">Choose a decision</option><option value="APPLIES">Applicable</option><option value="EXCLUDED">Excluded</option><option value="REVIEW_NEEDED">Reopen for review</option></select></label>
 <label>Reason for this decision<textarea aria-label="Reason for this decision" name="reason" required minLength={20} maxLength={800} defaultValue={row.reason}/></label><button>Save scope decision</button></fieldset></form></>}</>}
 </details>;
}
