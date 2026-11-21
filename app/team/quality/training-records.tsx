'use client';
import {useState} from 'react';
import {trainingOutcome,type CaseTrainingRecord} from '../../../lib/quality-training';
import {workspaceHref,type useWorkspaceContext} from '../../../lib/client/workspace-context';
import css from './quality.module.css';

type Choice={id:string;learnerName:string;policyTitle:string;revisionNumber:number;cycle:number;title:string};
type Props={
 records:CaseTrainingRecord[];organizationId:string;occurredAt:string;cycle:number;blocked:boolean;editable:boolean;
 request:ReturnType<typeof useWorkspaceContext>['request'];save:(fields:Record<string,string>)=>void;
};

export default function TrainingRecords({records,organizationId,occurredAt,cycle,blocked,editable,request,save}:Props){
 const [query,setQuery]=useState(''),[choices,setChoices]=useState<Choice[]>([]),[page,setPage]=useState(1),[pages,setPages]=useState(0);
 const [selection,setSelection]=useState(''),[finding,setFinding]=useState(''),[time,setTime]=useState(''),[notes,setNotes]=useState('');
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 async function search(next:number){
  setLoading(true);setError('');setSelection('');
  try{
   const params=new URLSearchParams({organizationId,q:query.trim(),page:String(next)});
   const result=await request('/api/workspace/training?'+params);
   if(result.organizationId!==organizationId||!Array.isArray(result.items))throw new Error('Training records could not be verified for this organisation.');
   setChoices(result.items);setPage(result.page);setPages(result.pages);
  }catch(e){setChoices([]);setPages(0);setError(e instanceof Error?e.message:'Training search failed.');}
  finally{setLoading(false);}
 }
 const incidentRecords=records.filter(entry=>entry.cycle===cycle&&entry.finding.purpose==='INCIDENT');
 return <section className={css.section} aria-label="Operator training evidence">
  <h3>Operator training evidence</h3>
  {records.map(({key,cycle:recordCycle,finding:r,recordedAt})=><details key={key} className={css.form}>
   <summary>Cycle {recordCycle} · {r.purpose==='INCIDENT'?'Incident':'Retraining'} · {r.learner} · {r.procedure} v{r.revision}</summary>
   <p>{r.asOf} · {trainingOutcome[r.outcome]}{r.validUntil&&' · Valid until '+r.validUntil}</p>
   <p>Latest published revision at that time: {r.publishedRevision??'None recorded'}. Assignment revision: {r.revision}.</p>
   <p>Reading acknowledgement: {r.acknowledgedAt??'None recorded by that time'}. {r.decisionAt&&'Assessed '+r.decisionAt+'.'}</p>
   <p>{r.notes}</p><p>Recorded {recordedAt} · <a href={workspaceHref('/team/training',organizationId,{trainingId:r.assignmentId})}>Open exact training assignment</a></p>
  </details>)}
  {editable&&<details className={css.form}><summary>Link operator training evidence</summary>
   <form onSubmit={event=>{event.preventDefault();if(!selection)return;
    save(finding?{purpose:'RETRAINING',incidentKey:finding,assignmentId:selection,notes}:
     {purpose:'INCIDENT',asOf:new Date(occurredAt.slice(0,10)+'T'+time+'Z').toISOString(),assignmentId:selection,notes});
   }}><fieldset disabled={blocked||loading}>
    <label>Evidence purpose<select aria-label="Evidence purpose" value={finding} onChange={e=>setFinding(e.target.value)}>
     <option value="">Training at incident time</option>{incidentRecords.map(entry=><option key={entry.key} value={entry.key}>Retraining for {entry.finding.learner} · {entry.finding.procedure} · {entry.finding.asOf}</option>)}
    </select></label>
    {!finding&&<label>Time of incident on {occurredAt.slice(0,10)} (UTC)<input aria-label="Incident time UTC" type="time" step="0.001" required value={time} onChange={e=>setTime(e.target.value)}/></label>}
    <label>Operator or procedure<input aria-label="Operator or procedure" value={query} maxLength={120} onChange={e=>{setQuery(e.target.value);setChoices([]);setPages(0);setSelection('');}}/></label>
    <button type="button" onClick={()=>void search(1)}>Find training assignments</button>
    {pages>0&&<><label>Training assignment<select aria-label="Training assignment" required value={selection} onChange={e=>setSelection(e.target.value)}>
     <option value="">Choose an assignment</option>{choices.map(item=><option key={item.id} value={item.id}>{item.learnerName} · {item.policyTitle} v{item.revisionNumber} · {item.title} · Cycle {item.cycle} · {item.id.slice(0,8)}</option>)}
    </select></label>{!choices.length&&<p>No matching assignments.</p>}{pages>1&&<div>
     <button type="button" disabled={page===1} onClick={()=>void search(page-1)}>Previous assignments</button> Page {page} of {pages} <button type="button" disabled={page===pages} onClick={()=>void search(page+1)}>Next assignments</button>
    </div>}</>}
    <label>Why this record applies<textarea aria-label="Why this record applies" required minLength={10} maxLength={800} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <button type="submit" disabled={!selection||notes.trim().length<10||(!finding&&!time)}>Save training evidence</button>
   </fieldset></form>{error&&<p role="alert">{error}</p>}
  </details>}
 </section>;
}
