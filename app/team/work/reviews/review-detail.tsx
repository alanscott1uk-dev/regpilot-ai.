'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {safeWorkSource} from '../../../../lib/work-hub.mjs';
import type {CompletionReceipt} from '../../../../lib/server/work-completion-service';
import type {WorkReviewDetail,WorkReviewFollowUpPreview,WorkReviewVerifyResult} from '../../../../lib/server/work-review-service';
import {downloadReviewJson,reviewDate,reviewLabels} from './review-common';
import styles from './reviews.module.css';

type Props={
 organizationId:string;taskId:string;busy:boolean;
 request:(path:string,options?:RequestInit)=>Promise<unknown>;
 beginAction:()=>boolean;endAction:()=>void;onSaved:()=>void;
};
type FollowUpResult={taskId:string;sourceTaskId:string;eventId:string;reused:boolean};
type Proof=Pick<CompletionReceipt,'source'|'control'|'assessment'|'evidence'>;
const nextWeek=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const taskState=(status:string)=>({OPEN:'Open',IN_PROGRESS:'In progress',COMPLETE:'Completed'}[status]||status.toLowerCase().replaceAll('_',' '));

function ProofSummary({proof}: {proof:Proof}){
 return <div className={styles.proof}>
  {proof.source&&<div><span className={styles.eyebrow}>SOURCE</span><strong>{proof.source.title}</strong><p>Version {proof.source.version} · Reviewed {reviewDate(proof.source.reviewedAt)} UTC</p><code>{proof.source.contentHash}</code>{safeWorkSource(proof.source.url)&&<a href={safeWorkSource(proof.source.url)!} target="_blank" rel="noopener noreferrer">Read source publication ↗</a>}</div>}
  {proof.control&&<div><span className={styles.eyebrow}>CONTROL</span><strong>{proof.control.title}</strong><p>Version {proof.control.version} · {proof.control.enabled?'Enabled at review':'Paused at review'}</p></div>}
  {proof.assessment&&<div><span className={styles.eyebrow}>ASSESSMENT</span><p>Reviewed {reviewDate(proof.assessment.reviewedAt)} UTC<br/>Review due {reviewDate(proof.assessment.validUntil)} UTC</p></div>}
  <div><span className={styles.eyebrow}>SUPPORTING EVIDENCE</span><ul>{proof.evidence.map(file=><li key={file.id}><strong>{file.filename}</strong><span>Review version {file.reviewVersion} · {reviewDate(file.reviewedAt)} UTC</span><code>{file.sha256}</code></li>)}</ul></div>
 </div>;
}

export function ReviewDetail({organizationId,taskId,busy,request,beginAction,endAction,onSaved}:Props){
 const [data,setData]=useState<WorkReviewDetail|null>(null),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false),[operation,setOperation]=useState('');
 const [assigneeId,setAssigneeId]=useState(''),[dueDate,setDueDate]=useState(nextWeek),[reason,setReason]=useState(''),[preview,setPreview]=useState<WorkReviewFollowUpPreview|null>(null);
 const [evidenceIds,setEvidenceIds]=useState<string[]>([]),[notes,setNotes]=useState(''),[confirmed,setConfirmed]=useState(false);
 const mounted=useRef(false),posting=useRef(false),writeAbort=useRef<AbortController|null>(null);
 const formId=useId(),endpoint='/api/workspace/work/'+encodeURIComponent(taskId)+'/review';
 const workHref=(id:string)=>'/team/work?'+new URLSearchParams({organizationId,taskId:id});

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;writeAbort.current?.abort();};},[]);
 useEffect(()=>{
  let active=true;const abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),20000);
  setLoading(true);setData(null);setError('');setPreview(null);setConfirmed(false);setEvidenceIds([]);
  void request(endpoint+'?'+new URLSearchParams({organizationId}),{signal:abort.signal}).then(value=>{
   if(!active)return;
   const next=value as WorkReviewDetail;
   if(next.organizationId!==organizationId||next.item.task.id!==taskId)throw new Error('This review belongs to another task. Refresh its context.');
   setData(next);setNeedsRefresh(false);
   setAssigneeId(current=>next.members.some(member=>member.id===current)?current:next.members.find(member=>member.email===next.item.task.ownerName)?.id||'');
   const required=next.verification.evidence.filter(file=>file.required);
   setEvidenceIds(required.length?required.map(file=>file.id):next.verification.evidence.length<=next.verification.evidenceLimit?next.verification.evidence.map(file=>file.id):[]);
  }).catch(cause=>{if(active)setError(cause instanceof Error&&cause.name!=='AbortError'?cause.message:'The review check did not respond. Refresh to check the latest state.');})
   .finally(()=>{window.clearTimeout(timer);if(active)setLoading(false);});
  return()=>{active=false;window.clearTimeout(timer);abort.abort();};
 },[organizationId,taskId,endpoint,request,refresh]);

 async function write(path:string,body:Record<string,unknown>,kind:string,saved:(value:unknown)=>void){
  if(posting.current||!data||needsRefresh||loading||!beginAction())return;
  posting.current=true;setOperation(kind);setError('');setNotice('');
  const abort=new AbortController();writeAbort.current=abort;
  const timer=window.setTimeout(()=>abort.abort(),30000);
  try{
   const value=await request(endpoint+path,{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,...body})});
   if(mounted.current)saved(value);
  }catch(cause){if(mounted.current){
   const message=cause instanceof Error&&cause.name!=='AbortError'?cause.message:'The save response was not received.';
   setError(message+' Refresh the review to check what was saved before trying again.');
   setNeedsRefresh(true);setPreview(null);setConfirmed(false);
  }}finally{
   window.clearTimeout(timer);writeAbort.current=null;posting.current=false;
   if(mounted.current)setOperation('');endAction();
  }
 }
 function planFollowUp(event:React.FormEvent){
  event.preventDefault();if(!data?.canCreateFollowUp||!data.token||!assigneeId||!dueDate||reason.trim().length<20)return;
  void write('/follow-up',{phase:'preview',reviewToken:data.token,assigneeId,dueDate,reason:reason.trim()},'preview',value=>{
   const next=value as WorkReviewFollowUpPreview;
   if(next.sourceTaskId!==taskId||!next.token)throw new Error('The server did not confirm a follow-up preview for this task.');
   setPreview(next);
  });
 }
 function applyFollowUp(){
  if(!data?.canCreateFollowUp||!data.token||!preview||preview.existing)return;
  void write('/follow-up',{phase:'apply',reviewToken:data.token,assigneeId:preview.assignee.id,dueDate:preview.dueDate,reason:preview.reason,token:preview.token,confirm:true},'follow-up',value=>{
   const result=value as FollowUpResult;
   if(result.sourceTaskId!==taskId||!result.taskId||!result.eventId)throw new Error('The server did not confirm the saved follow-up.');
   setPreview(null);setReason('');setNotice(result.reused?'The existing follow-up has been recovered.':'Follow-up task created with the reviewed owner and deadline.');
   setRefresh(value=>value+1);onSaved();
  });
 }
 function verify(event:React.FormEvent){
  event.preventDefault();if(!data?.verification.canVerify||!data.verification.token||!confirmed||notes.trim().length<20||!evidenceIds.length||evidenceIds.length>data.verification.evidenceLimit)return;
  void write('/verify',{token:data.verification.token,evidenceIds,notes:notes.trim(),confirm:true},'verify',value=>{
   const result=value as WorkReviewVerifyResult;
   if(result.taskId!==taskId||result.record?.organizationId!==organizationId||result.record.originalTaskId!==taskId||!result.eventId||!result.proofHash)throw new Error('The server did not confirm the fresh review.');
   setConfirmed(false);setNotes('');setNotice('Fresh review recorded with verified evidence. The original completion record is preserved.');
   setRefresh(value=>value+1);onSaved();
  });
 }
 function changePlan(change:()=>void){setPreview(null);change();}
 function chooseEvidence(id:string,checked:boolean){setEvidenceIds(current=>checked?[...new Set([...current,id])]:current.filter(value=>value!==id));setConfirmed(false);}
 const admin=!!data&&['OWNER','ADMIN'].includes(data.role),disabled=busy||loading||needsRefresh;
 const tooMany=!!data&&evidenceIds.length>data.verification.evidenceLimit;

 return <section className={styles.detail} aria-label="Completed work review" aria-busy={loading||busy}>
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {error&&<div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh review status</button></div>}
  {loading&&<p role="status">Checking this completed task and its recorded proof…</p>}
  {data&&<>
   <header className={styles.detailHeading}><div><span className={styles.eyebrow}>COMPLETED OUTCOME</span><h2>{data.item.task.title}</h2><p>{data.item.task.ownerName} · Completed {reviewDate(data.item.task.completedAt)} UTC</p></div><button className={styles.secondary} type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh recorded checks</button></header>
   <div className={styles.reviewState} data-state={data.item.state}><span aria-hidden="true">{data.item.state==='NEEDS_REVIEW'?'↻':data.item.state==='NO_RECORDED_CHANGES'?'○':'•'}</span><div><h3>{reviewLabels[data.item.state]}</h3><p>This check compares saved records. File contents are verified when you record a fresh review.</p>{data.item.basis&&<small>Compared with the {data.item.basis.kind==='VERIFICATION'?'fresh review':'completion'} recorded {reviewDate(data.item.basis.checkedAt)} UTC.</small>}</div></div>
   {data.item.findings.length>0&&<section className={styles.card} aria-label="Current review findings"><span className={styles.eyebrow}>WHAT NEEDS A LOOK</span><h3>Changes and review findings</h3><ul className={styles.findings}>{data.item.findings.map((finding,index)=><li key={finding.code+':'+index}><p>{finding.message}</p>{finding.href&&<a href={finding.href}>{finding.label} →</a>}</li>)}</ul></section>}

   <section className={styles.card} aria-label="Owned follow-up"><span className={styles.eyebrow}>GIVE THE NEXT STEP AN OWNER</span><h3>Owned follow-up</h3>
    {data.item.followUp&&<div className={styles.followUp}><span className={styles.stateBadge}>{taskState(data.item.followUp.status)}</span><h4>{data.item.followUp.title}</h4><p>{data.item.followUp.ownerName} · Due {reviewDate(data.item.followUp.dueDate)} UTC</p><a aria-label="Open follow-up task" href={workHref(data.item.followUp.id)}>Open follow-up task <span aria-hidden="true">→</span></a><p className={styles.hint}>This task keeps its own status. Completing it does not record a fresh review of this outcome.</p></div>}
    {admin&&data.canCreateFollowUp&&<form onSubmit={planFollowUp}>
     <p>Review the owner, deadline and purpose before creating a linked task.</p><div className={styles.fields}>
      <label htmlFor={formId+'-assignee'}>Follow-up assignee<select id={formId+'-assignee'} aria-label="Follow-up assignee" required disabled={disabled} value={assigneeId} onChange={event=>changePlan(()=>setAssigneeId(event.target.value))}><option value="">Choose an eligible member</option>{data.members.map(member=><option key={member.id} value={member.id}>{member.email}</option>)}</select></label>
      <label htmlFor={formId+'-due'}>Follow-up due date<input id={formId+'-due'} type="date" min="2000-01-01" max="2100-12-31" required disabled={disabled} value={dueDate} onChange={event=>changePlan(()=>setDueDate(event.target.value))}/></label>
     </div><label className={styles.textField} htmlFor={formId+'-reason'}>Reason for follow-up<textarea id={formId+'-reason'} rows={3} required minLength={20} maxLength={500} disabled={disabled} value={reason} onChange={event=>changePlan(()=>setReason(event.target.value))} placeholder="Explain what needs checking and the outcome the owner should achieve."/></label>
     {data.membersLimited&&<p className={styles.hint}>The picker shows the first eligible members. Team administration has the full membership list.</p>}
     <button type="submit" disabled={disabled||!data.token||!assigneeId||!dueDate||reason.trim().length<20}>{operation==='preview'?'Preparing preview…':'Preview follow-up task'}</button>
    </form>}
    {!admin&&<p className={styles.hint}>An administrator can assign a follow-up and record a fresh review.</p>}
    {admin&&!data.canCreateFollowUp&&!data.item.followUp&&<p className={styles.hint}>A follow-up can be assigned when the recorded check identifies work to review.</p>}
    {preview&&<section className={styles.preview} aria-label="Follow-up preview"><h4>Check the task before creating it</h4><dl><dt>Task</dt><dd>{preview.title}</dd><dt>Owner</dt><dd>{preview.assignee.email}</dd><dt>Due date</dt><dd>{preview.dueDate} UTC</dd><dt>Purpose</dt><dd>{preview.reason}</dd></dl>{preview.findings.length>0&&<ul>{preview.findings.map((finding,index)=><li key={finding.code+':'+index}>{finding.message}</li>)}</ul>}{preview.existing?<p>A follow-up already exists. <a aria-label="Open follow-up task" href={workHref(preview.existing.id)}>Open follow-up task <span aria-hidden="true">→</span></a></p>:<button type="button" disabled={disabled} onClick={applyFollowUp}>{operation==='follow-up'?'Creating follow-up…':'Create reviewed follow-up'}</button>}</section>}
   </section>

   <section className={styles.card} aria-label="Fresh review"><span className={styles.eyebrow}>CHECK THE BASIS AGAIN</span><h3>Record a fresh review</h3><p>Use the current reviewed evidence to record a new basis for this completed task. The original completion remains in its history.</p>
    {data.verification.blockers.length>0&&<ul className={styles.findings}>{data.verification.blockers.map((block,index)=><li key={block.code+':'+index}><p>{block.message}</p>{block.href&&<a href={block.href}>{block.label} →</a>}</li>)}</ul>}
    {admin&&data.verification.canVerify&&<form onSubmit={verify}>
     <fieldset className={styles.evidenceChoices} disabled={disabled}><legend>Current reviewed evidence</legend>{data.verification.evidence.map(file=><label key={file.id}><input type="checkbox" disabled={file.required} checked={evidenceIds.includes(file.id)} onChange={event=>chooseEvidence(file.id,event.target.checked)}/><span><strong>{file.filename}</strong><small>Review version {file.reviewVersion} · {reviewDate(file.reviewedAt)} UTC{file.required?' · Required by assessment':''}</small></span></label>)}</fieldset>
     {data.verification.evidence.length>data.verification.evidenceLimit&&<p className={styles.hint}>Select up to {data.verification.evidenceLimit} supporting files.</p>}
     {tooMany&&<p className={styles.error} role="alert">Select no more than {data.verification.evidenceLimit} files.</p>}
     <label className={styles.textField} htmlFor={formId+'-outcome'}>Fresh review outcome<textarea id={formId+'-outcome'} rows={3} required minLength={20} maxLength={500} disabled={disabled} value={notes} onChange={event=>{setNotes(event.target.value);setConfirmed(false);}} placeholder="Describe what you checked and what the current evidence demonstrates."/></label><p className={styles.hint}>20–500 characters · Saved with this review record.</p>
     <label className={styles.confirm}><input type="checkbox" disabled={disabled||!evidenceIds.length||tooMany} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>I have checked the current evidence and confirm this reviewed basis.</span></label>
     <button type="submit" disabled={disabled||!data.verification.token||!confirmed||!evidenceIds.length||tooMany||notes.trim().length<20}>{operation==='verify'?'Verifying files and recording…':'Verify files and record fresh review'}</button>
    </form>}
    {!admin&&<p className={styles.hint}>A workspace administrator must record the fresh review.</p>}
   </section>

   <section className={styles.card} aria-label="Recorded review bases"><span className={styles.eyebrow}>PRESERVED DECISIONS</span><h3>Completion and review history</h3>
    {data.latestVerification&&<article className={styles.record}><div><h4>Latest fresh review</h4><span>{reviewDate(data.latestVerification.verifiedAt)} UTC</span></div><p>{data.latestVerification.notes}</p><details><summary>Inspect fresh review basis</summary><ProofSummary proof={data.latestVerification.proof}/><dl><dt>Review fingerprint</dt><dd><code>{data.item.basis?.proofHash}</code></dd><dt>Original completion record</dt><dd>{data.latestVerification.completionEventId}</dd></dl></details><button className={styles.secondary} type="button" onClick={()=>downloadReviewJson('regpilot-fresh-review-'+taskId,{record:data.latestVerification,basis:data.item.basis,hashPurpose:'Content integrity only; not a digital signature.'})}>Download fresh review record</button></article>}
    {data.original?<article className={styles.record}><div><h4>Original completion</h4><span>{reviewDate(data.original.completedAt)} UTC</span></div><p>{data.original.receipt.notes}</p><details><summary>Inspect original completion basis</summary><ProofSummary proof={data.original.receipt}/><dl><dt>Completion record</dt><dd>{data.original.eventId}</dd><dt>Original fingerprint</dt><dd><code>{data.original.proofHash}</code></dd></dl></details><button className={styles.secondary} type="button" onClick={()=>downloadReviewJson('regpilot-original-completion-'+taskId,data.original)}>Download original completion record</button></article>:<p>The original verified completion record is unavailable. Inspect the task activity for recorded context.</p>}
    {data.verificationHistory.length>0&&<details className={styles.history}><summary>Verification history ({data.verificationHistory.length})</summary><ol>{data.verificationHistory.map(review=><li key={review.eventId}><strong>{reviewDate(review.verifiedAt)} UTC</strong><p>{review.notes}</p><span>Reviewer ID: {review.verifiedById}</span><code>{review.proofHash}</code></li>)}</ol>{data.historyLimited&&<p className={styles.hint}>Showing the newest 25 verification decisions.</p>}</details>}
    <a href={workHref(taskId)}>Open original task and activity →</a>
   </section>
   <p className={styles.hint}>{data.scope}</p>
  </>}
 </section>;
}
