'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {CompletionReadiness as Readiness,CompletionResult} from '../../../lib/server/work-completion-service';
import {safeWorkSource} from '../../../lib/work-hub.mjs';
import styles from './work.module.css';

type Props={
 organizationId:string;
 taskId:string;
 currentStatus:string;
 busy:boolean;
 request:(path:string,options?:RequestInit)=>Promise<unknown>;
 beginAction:()=>boolean;
 endAction:()=>void;
 onStatusChanged:()=>void;
 onCompleted:(result:CompletionResult)=>void;
};

const formattedDate=(value:string|null|undefined)=>value?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'Not recorded';

/** A fresh preview is required after any uncertain write; completion is never retried automatically. */
export function CompletionPanel({organizationId,taskId,currentStatus,busy,request,beginAction,endAction,onStatusChanged,onCompleted}:Props){
 const [readiness,setReadiness]=useState<Readiness|null>(null),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [selected,setSelected]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false),[notes,setNotes]=useState('');
 const [error,setError]=useState(''),[submitting,setSubmitting]=useState(false);
 const mounted=useRef(false),posting=useRef(false),postController=useRef<AbortController|null>(null);
 const notesId=useId();
 const endpoint='/api/workspace/work/'+encodeURIComponent(taskId)+'/completion';

 useEffect(()=>{
  mounted.current=true;
  return()=>{mounted.current=false;postController.current?.abort();};
 },[]);

 useEffect(()=>{
  const abort=new AbortController();let active=true;
  const timer=window.setTimeout(()=>abort.abort(),20000);
  setLoading(true);setReadiness(null);setSelected([]);setConfirmed(false);setError('');
  void request(endpoint+'?'+new URLSearchParams({organizationId}),{signal:abort.signal}).then(value=>{
   if(!active)return;
   const next=value as Readiness;
   if(next.organizationId!==organizationId||next.task.id!==taskId)throw new Error('This completion check belongs to another task. Refresh its context.');
   if(next.task.status!==currentStatus){onStatusChanged();return;}
   setReadiness(next);
   const required=next.evidence.filter(file=>file.required);
   setSelected(required.length?required.map(file=>file.id):next.evidence.length<=next.evidenceLimit?next.evidence.map(file=>file.id):[]);
  }).catch(cause=>{if(active)setError(cause instanceof Error&&cause.name!=='AbortError'?cause.message:'The completion check did not respond. Check the latest task status.');})
   .finally(()=>{window.clearTimeout(timer);if(active)setLoading(false);});
  return()=>{active=false;window.clearTimeout(timer);abort.abort();};
 },[endpoint,organizationId,taskId,currentStatus,onStatusChanged,request,refresh]);

 function selectEvidence(id:string,checked:boolean){
  setSelected(ids=>checked?[...new Set([...ids,id])]:ids.filter(value=>value!==id));
  setConfirmed(false);
 }

 async function complete(event:React.FormEvent){
  event.preventDefault();
  if(posting.current||!readiness?.ready||!readiness.canComplete||!readiness.token||!confirmed||!selected.length||selected.length>readiness.evidenceLimit||notes.trim().length<20||!beginAction())return;
  posting.current=true;setSubmitting(true);setError('');
  const abort=new AbortController();postController.current=abort;
  const timer=window.setTimeout(()=>abort.abort(),30000);
  try{
   const value=await request(endpoint,{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,token:readiness.token,evidenceIds:selected,confirm:true,notes:notes.trim()})});
   const saved=value as CompletionResult;
   if(saved.taskId!==taskId||saved.status!=='COMPLETE')throw new Error('The server did not confirm completion.');
   if(mounted.current)onCompleted(saved);
  }catch(cause){
   if(mounted.current){
    const message=cause instanceof Error&&cause.name!=='AbortError'?cause.message:'The completion response was not received.';
    setError(message+' Check the latest task status before trying again.');
    setReadiness(null);setSelected([]);setConfirmed(false);
   }
  }finally{
   window.clearTimeout(timer);postController.current=null;posting.current=false;
   if(mounted.current)setSubmitting(false);
   endAction();
  }
 }

 function downloadRecord(){
  if(!readiness?.receipt||!readiness.completed)return;
  const body={receipt:readiness.receipt,record:readiness.completed,hashPurpose:'Content integrity only; not a digital signature or a statement of continuing compliance.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='regpilot-completion-'+taskId+'.json';link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }

 const completed=readiness?.task.status==='COMPLETE';
 const tooMany=!!readiness&&selected.length>readiness.evidenceLimit;
 return <section className={styles.completion} aria-label="Task completion" aria-busy={loading||submitting}>
  <div className={styles.completionHeading}><div><span className={styles.eyebrow}>FROM EVIDENCE TO OUTCOME</span><h3>{completed?readiness?.completed?'Completion record':'Recorded outcome':'Complete this task'}</h3></div>{!loading&&readiness&&!completed&&<button className={styles.secondary} type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh completion check</button>}</div>
  {loading&&<p role="status">Checking evidence and review requirements…</p>}
  {error&&<div className={styles.error} role="alert"><p>{error}</p><button className={styles.secondary} type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Check latest task status</button></div>}
  {readiness&&<>
   <div className={styles.completionState} data-ready={readiness.ready} data-completed={completed} role="status">
    <span aria-hidden="true">{completed?'✓':readiness.ready?'○':'•'}</span>
    <div><h4>{completed?'Task completed':readiness.ready?'Ready to complete':'Before you can finish'}</h4><p>{completed?readiness.completed?'The completed outcome and supporting evidence are recorded below.':'This task is marked complete. Review its activity below for the recorded context.':readiness.ready?'Choose the reviewed evidence supporting this work. The original files are checked again when you complete it.':'Follow the steps below, then refresh this check.'}</p></div>
   </div>
   {readiness.blockers.length>0&&<ul className={styles.completionBlockers}>{readiness.blockers.map((block,index)=><li key={block.code+':'+index}><p>{block.message}</p>{block.href&&<a href={block.href}>{block.label} →</a>}</li>)}</ul>}
   {completed&&<p><a aria-label="Review this completed task" href={'/team/work/reviews?'+new URLSearchParams({organizationId,taskId})}>Review this completed task <span aria-hidden="true">→</span></a></p>}
   {readiness.completed&&<div className={styles.completionRecord}>
    <strong>Completion record saved</strong><p>{formattedDate(readiness.completed.completedAt)} UTC · {readiness.completed.evidenceCount} verified evidence file{readiness.completed.evidenceCount===1?'':'s'}</p>
    {readiness.receipt&&<>
     <p className={styles.hint}>This record preserves the evidence and reviews used at completion.</p>
     <details><summary>Inspect completion record</summary>
      {readiness.receipt.notes&&<p><strong>Recorded outcome</strong><br/>{readiness.receipt.notes}</p>}
      {readiness.receipt.source&&<div className={styles.completionProvenance}><p>Source at completion: <strong>{readiness.receipt.source.title}</strong> · Version {readiness.receipt.source.version}</p><span>Checked {formattedDate(readiness.receipt.source.lastCheckedAt)} UTC · Reviewed {formattedDate(readiness.receipt.source.reviewedAt)} UTC</span><code>{readiness.receipt.source.contentHash}</code>{safeWorkSource(readiness.receipt.source.url)&&<a href={safeWorkSource(readiness.receipt.source.url)!} target="_blank" rel="noopener noreferrer">Source publication ↗</a>}</div>}
      {readiness.receipt.control&&<p>Control at completion: <strong>{readiness.receipt.control.title}</strong> · Version {readiness.receipt.control.version}</p>}
      {readiness.receipt.assessment&&<p>Accepted assessment at completion: reviewed {formattedDate(readiness.receipt.assessment.reviewedAt)} UTC · Review due {formattedDate(readiness.receipt.assessment.validUntil)} UTC.</p>}
      <ul>{readiness.receipt.evidence.map(file=><li key={file.id}><strong>{file.filename}</strong><span>Review version {file.reviewVersion} · {formattedDate(file.reviewedAt)} UTC</span><span>Reviewer ID: {file.reviewerId}</span><code>{file.sha256}</code></li>)}</ul>
      <dl><dt>Record ID</dt><dd>{readiness.completed.eventId}</dd><dt>Record fingerprint</dt><dd>{readiness.completed.proofHash}</dd></dl>
     </details>
     <button type="button" className={styles.secondary} onClick={downloadRecord}>Download completion record</button>
    </>}
   </div>}
   {!completed&&readiness.ready&&<form onSubmit={event=>void complete(event)}>
    {readiness.assessment&&<p className={styles.completionAssessment}>Independent assessment recorded {formattedDate(readiness.assessment.reviewedAt)} UTC{readiness.assessment.validUntil?' · Review due '+formattedDate(readiness.assessment.validUntil)+' UTC':''}. Its supporting files are fixed for this completion.</p>}
    <fieldset className={styles.completionFiles} disabled={busy||!readiness.canComplete}><legend>Reviewed evidence</legend>{readiness.evidence.map(file=><label key={file.id}>
     <input type="checkbox" checked={selected.includes(file.id)} disabled={file.required} onChange={event=>selectEvidence(file.id,event.target.checked)}/>
     <span><strong>{file.filename}</strong><small>Review version {file.reviewVersion} · Reviewed {formattedDate(file.reviewedAt)} UTC{file.required?' · Required by assessment':''}</small></span>
    </label>)}</fieldset>
    {readiness.evidence.length>readiness.evidenceLimit&&<p className={styles.hint}>Select up to {readiness.evidenceLimit} supporting files.</p>}
    {tooMany&&<p className={styles.error} role="alert">Select no more than {readiness.evidenceLimit} files for this completion.</p>}
    {readiness.canComplete&&<>
     <div className={styles.completionNotes}><label htmlFor={notesId}>What was completed?</label><textarea id={notesId} aria-describedby={notesId+'-help'} rows={3} required minLength={20} maxLength={500} disabled={busy} value={notes} onChange={event=>{setNotes(event.target.value);setConfirmed(false);}} placeholder="Describe the work finished and how the selected evidence supports it."/><small id={notesId+'-help'}>20–500 characters · Saved with the completion record.</small></div>
     <label className={styles.completionConfirm}><input type="checkbox" disabled={busy||!selected.length||tooMany} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>I have checked the selected evidence and confirm this work is complete.</span></label>
     <button type="submit" disabled={busy||!confirmed||!selected.length||tooMany||notes.trim().length<20}>{submitting?'Verifying files and completing…':'Complete with verified evidence'}</button>
    </>}
   </form>}
   <p className={styles.hint}>{readiness.scope}</p>
  </>}
 </section>;
}
