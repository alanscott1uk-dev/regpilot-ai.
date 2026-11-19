'use client';
import {useEffect,useState} from 'react';
import type {workTask} from '../../../lib/server/work-hub-service';
import styles from './task-progress.module.css';

type Serial<T>=T extends Date?string:T extends Array<infer U>?Serial<U>[]:T extends object?{[K in keyof T]:Serial<T[K]>}:T;
type Detail=Serial<Awaited<ReturnType<typeof workTask>>>;
type View='task'|'evidence'|'assessment';
const stageGroup=(stage:string)=>stage==='SOURCE_REVIEW'?'source':stage==='EVIDENCE_REQUIRED'||stage==='FILE_REVIEW'?'files':stage.startsWith('ASSESSMENT_')?'assessment':stage==='COMPLETED'||stage==='READY_TO_COMPLETE'||stage==='COMPLETION_CHECK'?'completion':'';
const stages=[['source','Source context'],['files','Evidence files'],['assessment','Evidence decision'],['completion','Completion']];

export function TaskProgress({data,view='task',canInvite=false,selectedAssessmentId=''}:{data:Detail;view?:View;canInvite?:boolean;selectedAssessmentId?:string}){
 const [copyState,setCopyState]=useState<'idle'|'copied'|'manual'>('idle');
 const {workflow,task,organizationId}=data;
 const taskHref='/team/work?'+new URLSearchParams({organizationId,taskId:task.id});
 const targetAssessment=new URLSearchParams(workflow.href.split('?')[1]||'').get('assessmentId');
 const onThisPage=view==='evidence'&&workflow.href.startsWith('/team/evidence?')||view==='assessment'&&workflow.href.startsWith('/team/assurance?')&&(!targetAssessment||targetAssessment===selectedAssessmentId);
 const actionHref=onThisPage?(view==='evidence'?(workflow.stage==='EVIDENCE_REQUIRED'?'#task-upload':'#task-files'):(workflow.stage==='ASSESSMENT_REQUIRED'?'#task-prepare':'#task-assessment')):workflow.stage==='READY_TO_COMPLETE'&&view==='task'?'#task-completion':workflow.href;
 const nextActor={you:'Your next action',teammate:'An independent colleague is needed',writer:'A task preparer is needed',reviewer:'An independent reviewer is needed',none:'Recorded task status'}[workflow.actor]||'Next action';
 const independent=['FILE_REVIEW','ASSESSMENT_REVIEW'].includes(workflow.stage)&&['teammate','reviewer'].includes(workflow.actor);
 async function copyLink(){
  try{await navigator.clipboard.writeText(new URL(taskHref,window.location.origin).href);setCopyState('copied');}
  catch{setCopyState('manual');}
 }
 return <section className={styles.panel} aria-label="Task progress" data-stage={workflow.stage}>
  <div className={styles.top}><div><span className={styles.eyebrow}>ONE TASK, THROUGH TO COMPLETION</span>{view!=='task'&&<h2>{task.title}</h2>}<p>Responsible person: <strong>{task.assignee?.email||task.ownerName}</strong></p></div><div className={styles.links}>{view!=='task'&&<a href={taskHref}>Open task workspace</a>}<button type="button" onClick={()=>void copyLink()}>Copy task link</button></div></div>
  {copyState==='copied'&&<p className={styles.copyNotice} role="status">Task link copied. The recipient still needs access to this company.</p>}
  {copyState==='manual'&&<label className={styles.copyFallback}>Copy this task address<input readOnly value={typeof window==='undefined'?taskHref:new URL(taskHref,window.location.origin).href} onFocus={event=>event.target.select()}/></label>}
  {workflow.stage!=='SPECIALIST'&&<ol className={styles.stages} aria-label="Task stages">{stages.filter(([key])=>key!=='assessment'||!!task.originKey).map(([key,label],index)=><li key={key} aria-current={stageGroup(workflow.stage)===key?'step':undefined}><span>{index+1}</span><div>{label}{stageGroup(workflow.stage)===key&&<small>{workflow.stage==='COMPLETED'?'Recorded':'Current step'}</small>}</div></li>)}</ol>}
  <div className={styles.next} data-state={workflow.stage==='COMPLETED'?'recorded':workflow.canAct?'action':'waiting'}><div><span className={styles.actor}>{nextActor}</span><h3>{workflow.title}</h3><p>{workflow.detail}</p></div><a className={styles.primary} href={actionHref}>{onThisPage?'Continue below':workflow.label}<span aria-hidden="true"> →</span></a></div>
  {independent&&canInvite&&<p className={styles.handoff}>Bring the right person into this task. <a href={'/team/settings?'+new URLSearchParams({organizationId,taskId:task.id})}>Invite a reviewer</a></p>}
 </section>;
}

/** Read-only handoff. A new response can never be shown for a different account or task. */
export function TaskProgressCard({organizationId,taskId,accountKey,refreshKey,view,canInvite,request,selectedAssessmentId=''}:{organizationId:string;taskId:string;accountKey:string;refreshKey:string;view:View;canInvite:boolean;selectedAssessmentId?:string;request:(path:string,options?:RequestInit)=>Promise<Response>}){
 const key=accountKey+':'+organizationId+':'+taskId+':'+refreshKey;
 const [loaded,setLoaded]=useState<{key:string;data:Detail}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!organizationId||!taskId||!accountKey)return;
  let alive=true;const abort=new AbortController();setError('');setLoaded(null);
  void request('/api/workspace/work?'+new URLSearchParams({organizationId,taskId}),{signal:abort.signal}).then(response=>response.json()).then((body:Detail)=>{
   if(body.organizationId!==organizationId||body.task?.id!==taskId)throw new Error('The requested task could not be confirmed.');
   if(alive)setLoaded({key,data:body});
  }).catch(reason=>{if(alive){setLoaded(null);setError(reason instanceof Error?reason.message:'Task progress could not be checked.');}});
  return()=>{alive=false;abort.abort();};
 },[organizationId,taskId,accountKey,key,request,retry]);
 if(!organizationId||!taskId||!accountKey)return null;
 if(error)return <section className={styles.unavailable} aria-label="Task progress"><p>Task progress could not be checked. {error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Check task progress</button></section>;
 if(loaded?.key!==key)return <section className={styles.loading} aria-label="Task progress"><p role="status">Checking the next step for this task…</p></section>;
 return <TaskProgress key={accountKey+':'+organizationId+':'+taskId} data={loaded.data} view={view} canInvite={canInvite} selectedAssessmentId={selectedAssessmentId}/>;
}
