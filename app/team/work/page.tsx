'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {browserAuth} from '../../../lib/client/supabase-auth';
import {WORK_VIEWS,parseWorkQuery,safeWorkSource,workUuid,type WorkView,type WorkQuery} from '../../../lib/work-hub.mjs';
import type {workInbox,workTask,planWork} from '../../../lib/server/work-hub-service';
import shell from '../../workbench/workbench.module.css';
import styles from './work.module.css';
type Serial<T>=T extends Date?string:T extends Array<infer U>?Serial<U>[]:T extends object?{[K in keyof T]:Serial<T[K]>}:T;
type Inbox=Serial<Awaited<ReturnType<typeof workInbox>>>;
type Detail=Serial<Awaited<ReturnType<typeof workTask>>>;
type Preview=Serial<Awaited<ReturnType<typeof planWork>>>;
type Selection={id:string;title:string;updatedAt:string};
type Session={userId:string;email:string;organisations:{id:string;name:string;role:string}[]};
const date=(value:string)=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const statusLabel=(value:string)=>({OPEN:'Open',IN_PROGRESS:'In progress',COMPLETE:'Completed'}[value]||value.replaceAll('_',' ').toLowerCase());

export default function WorkHub(){
 const [session,setSession]=useState<Session|null>(null),[sessionBusy,setSessionBusy]=useState(true),[orgId,setOrgId]=useState('');
 const [query,setQuery]=useState<WorkQuery>({view:'open',q:'',page:1}),[search,setSearch]=useState(''),[layout,setLayout]=useState<'list'|'board'>('list');
 const [loaded,setLoaded]=useState<{key:string;data:Inbox}|null>(null),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
 const [selected,setSelected]=useState<Selection[]>([]),[assignee,setAssignee]=useState('keep'),[due,setDue]=useState(''),[reason,setReason]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
 const [creating,setCreating]=useState(false),[draft,setDraft]=useState({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});
 const [taskId,setTaskId]=useState(''),[detail,setDetail]=useState<{key:string;data:Detail}|null>(null),[detailError,setDetailError]=useState('');
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sessionRetry,setSessionRetry]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),mutation=useRef(false),generation=useRef(0),identity=useRef(''),sessionUser=useRef('');
 const scope=(session?.userId||'')+':'+orgId,queryKey=scope+':'+JSON.stringify(query);
 identity.current=scope;
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw new Error('Your session ended. Sign in again to continue.');
  const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,authorization:'Bearer '+token}});
  const body=await response.json().catch(()=>({error:'The server returned an unreadable response. Retry the request.'}));
  if(!response.ok)throw new Error(body.error||'The request could not be completed.');
  return body;
 },[]);
 function resetWork(){setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});generation.current++;setLoaded(null);setSelected([]);setPreview(null);setTaskId('');setDetail(null);setNotice('');setError('');setAssignee('keep');setDue('');setReason('');}
 useEffect(()=>{
  let alive=true,serial=0;const abort=new AbortController();let unsubscribe=()=>{};
  async function refreshSession(){const run=++serial;
   try{
    const local=(await browserAuth().auth.getSession()).data.session;
    if(!local){if(alive&&run===serial){identity.current='';generation.current++;setSession(null);setOrgId('');setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});setLoaded(null);setSelected([]);setPreview(null);setTaskId('');}return;}
    const value=await request('/api/ai/context',{signal:abort.signal});
    if(!alive||run!==serial)return;
    const params=new URLSearchParams(window.location.search),desired=params.get('organizationId');
    if(sessionUser.current!==value.userId){setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});generation.current++;setLoaded(null);setSelected([]);setPreview(null);setTaskId('');setDetail(null);setNotice('');setAssignee('keep');setDue('');setReason('');}
    sessionUser.current=value.userId;setSession(value);
    setOrgId(current=>value.organisations.some((o:{id:string})=>o.id===current)?current:value.organisations.find((o:{id:string})=>o.id===desired)?.id||value.organisations[0]?.id||'');
    try{const initial=parseWorkQuery(params);setQuery(initial);setSearch(initial.q);}catch{setQuery({view:'open',q:'',page:1});}
    const selectedTask=params.get('taskId');if(workUuid(selectedTask))setTaskId(selectedTask);
    setError('');
   }catch(e){if(alive&&run===serial){generation.current++;setSession(null);setOrgId('');setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});setLoaded(null);setSelected([]);setPreview(null);setTaskId('');setError(e instanceof Error?e.message:'Sign-in is unavailable.');}}
   finally{if(alive&&run===serial)setSessionBusy(false);}
  }
  try{
   const auth=browserAuth().auth;
   const {data}=auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){serial++;identity.current='';generation.current++;setSession(null);setOrgId('');setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});setLoaded(null);setSelected([]);setPreview(null);setTaskId('');setDetail(null);setNotice('');setError('');setSessionBusy(false);}
    else if(event==='SIGNED_IN'||event==='INITIAL_SESSION')setTimeout(()=>{if(alive)void refreshSession();},0);
   });unsubscribe=()=>data.subscription.unsubscribe();void refreshSession();
  }catch{setError('Private workspace sign-in is not configured in this environment.');setSessionBusy(false);}
  return()=>{alive=false;serial++;abort.abort();unsubscribe();generation.current++;};
 },[request,sessionRetry]);
 useEffect(()=>{
  if(!orgId||!session)return;
  const abort=new AbortController(),key=queryKey;let alive=true;setLoading(true);setError('');
  const params=new URLSearchParams({organizationId:orgId,view:query.view,q:query.q,page:String(query.page)});
  void request('/api/workspace/work?'+params,{signal:abort.signal}).then((data:Inbox)=>{if(alive){setLoaded({key,data});}}).catch(e=>{if(alive){setLoaded(null);setError(e.message);}}).finally(()=>{if(alive)setLoading(false);});
  const url=new URL(window.location.href);url.searchParams.set('organizationId',orgId);url.searchParams.set('view',query.view);url.searchParams.set('page',String(query.page));
  if(query.q)url.searchParams.set('q',query.q);else url.searchParams.delete('q');
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
  window.dispatchEvent(new Event('regpilot-workspace-navigation'));
  return()=>{alive=false;abort.abort();};
 },[queryKey,orgId,query,session,request,reload]);
 useEffect(()=>{
  if(!taskId||!orgId){dialog.current?.close();return;}
  if(!dialog.current?.open)dialog.current?.showModal();
  const abort=new AbortController(),key=scope+':'+taskId;let alive=true;setDetail(null);setDetailError('');
  void request('/api/workspace/work?'+new URLSearchParams({organizationId:orgId,taskId}),{signal:abort.signal}).then((data:Detail)=>{if(alive)setDetail({key,data});}).catch(e=>{if(alive)setDetailError(e.message);});
  return()=>{alive=false;abort.abort();};
 },[taskId,orgId,scope,request,reload]);
 const data=loaded?.key===queryKey?loaded.data:null,current=detail?.key===scope+':'+taskId?detail.data:null;
 const org=session?.organisations.find(o=>o.id===orgId),admin=!!org&&['OWNER','ADMIN'].includes(org.role);
 const selectionChanged=()=>{setPreview(null);setNotice('');};
 function changeView(next:WorkQuery){generation.current++;setSelected([]);setPreview(null);setQuery(next);setNotice('');}
 function pick(task:Selection,checked:boolean){selectionChanged();setSelected(items=>checked?[...items.filter(x=>x.id!==task.id),{id:task.id,title:task.title,updatedAt:task.updatedAt}]:items.filter(x=>x.id!==task.id));}
 const planInput=()=>({items:selected.map(({id,updatedAt})=>({id,updatedAt})),changes:{...(assignee!=='keep'?{assigneeId:assignee==='unassigned'?null:assignee}:{}),...(due?{dueDate:due}:{})},reason});
 async function plan(operation:'preview'|'apply'){
  if(mutation.current)return;mutation.current=true;setBusy(true);setError('');setNotice('');const submitted=scope,epoch=generation.current;
  try{
   const result:Preview=await request('/api/workspace/work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:orgId,operation,...planInput(),...(operation==='apply'?{token:preview?.token}:{})})});
   if(identity.current!==submitted||epoch!==generation.current)return;
   if(operation==='preview')setPreview(result);
   else{setPreview(null);setSelected([]);setAssignee('keep');setDue('');setReason('');setNotice(result.applied+' task plan'+(result.applied===1?'':'s')+' updated. Evidence and approval decisions were not changed.');setReload(x=>x+1);}
  }catch(e){if(identity.current===submitted&&epoch===generation.current){setPreview(null);setError(e instanceof Error?e.message:'Planning failed.');}}
  finally{mutation.current=false;setBusy(false);}
 }
 async function startTask(){
  if(!current?.canStart||mutation.current)return;mutation.current=true;setBusy(true);const submitted=scope,epoch=generation.current;setDetailError('');
  try{await request('/api/workspace/work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:orgId,operation:'start',id:current.task.id,updatedAt:current.task.updatedAt})});if(identity.current===submitted&&epoch===generation.current){setNotice('Task moved to in progress.');setReload(x=>x+1);}}
  catch(e){if(identity.current===submitted&&epoch===generation.current)setDetailError(e instanceof Error?e.message:'Could not start the task.');}finally{mutation.current=false;setBusy(false);}
 }
 async function createTask(e:React.FormEvent){
  e.preventDefault();if(mutation.current)return;mutation.current=true;setBusy(true);setError('');const submitted=scope,epoch=generation.current;
  try{await request('/api/workspace/work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:orgId,operation:'create',...draft})});if(identity.current===submitted&&epoch===generation.current){setCreating(false);setDraft({title:'',category:'Internal',notes:'',dueDate:'',assigneeId:''});setNotice('Task created with a workspace assignee and an audit record.');setReload(x=>x+1);}}
  catch(e){if(identity.current===submitted&&epoch===generation.current)setError(e instanceof Error?e.message:'Could not create the task.');}finally{mutation.current=false;setBusy(false);}
 }
 const taskCard=(task:Inbox['items'][number])=><article className={styles.task} key={task.id}>
  {admin&&<input aria-label={'Select '+task.title} type="checkbox" disabled={busy||!task.canPlan} checked={selected.some(x=>x.id===task.id)} onChange={e=>pick(task,e.target.checked)}/>}
  <button type="button" className={styles.taskOpen} onClick={()=>setTaskId(task.id)}><span className={styles.category}>{task.category}</span><strong>{task.title}</strong><span>{task.assignee?.email||task.ownerName} · Due {date(task.dueDate)}</span><span className={styles.metadata}>{task._count.evidence} evidence file{task._count.evidence===1?'':'s'}{task.evidenceToReview?' · Independent review pending':''}{task.managedControl?' · '+task.managedControl.title:''}</span></button>
  <span className={styles.badge} data-status={task.status}>{statusLabel(task.status)}</span>
 </article>;
 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
  <div className={styles.topline}><span>Workspace / Work hub</span><span>PRIVATE PILOT</span></div>
  <header className={styles.heading}><div><span className={styles.eyebrow}>FROM SIGNAL TO ACTION</span><h1>Move the work forward.</h1><p>Find what matters, see the supporting context and plan the next step without losing your place.</p></div>{orgId&&org?.role!=='VIEWER'&&<button type="button" className={styles.secondary} disabled={busy} onClick={()=>{setCreating(x=>!x);setDraft({title:'',category:'Internal',notes:'',dueDate:new Date().toISOString().slice(0,10),assigneeId:session?.userId||''});}}>{creating?'Close new task':'Create a task'}</button>}</header>
  {error&&<div className={styles.error} role="alert">{error} <button type="button" onClick={()=>{if(session)setReload(x=>x+1);else{setSessionBusy(true);setSessionRetry(x=>x+1);}}}>Retry loading</button></div>}
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {sessionBusy&&<p role="status">Loading your workspace…</p>}
  {!sessionBusy&&!orgId&&<section className={styles.empty}><h2>{session?'Create your organisation':'Sign in to your work hub'}</h2>{session?<a href="/team">Create organisation →</a>:<EmailSignIn destination="/team/work"/>}</section>}
  {orgId&&<>
   <div className={styles.toolbar}><label>Organisation<select aria-label="Organisation" value={orgId} disabled={busy} onChange={e=>{identity.current='';resetWork();setOrgId(e.target.value);setQuery({view:'open',q:'',page:1});setSearch('');}}>{session?.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><span className={styles.hint}>Recorded work, not a compliance score. All deadlines use UTC calendar dates.</span></div>
   {creating&&org?.role!=='VIEWER'&&<section className={styles.planner} aria-label="Create task"><h2>Create an owned task</h2><form onSubmit={e=>void createTask(e)}><div className={styles.fields}>
    <label>Task title<input required maxLength={160} value={draft.title} disabled={busy} onChange={e=>setDraft(x=>({...x,title:e.target.value}))}/></label>
    <label>Task category<input required maxLength={80} value={draft.category} disabled={busy} onChange={e=>setDraft(x=>({...x,category:e.target.value}))}/></label>
    <label>Task assignee<select required value={draft.assigneeId} disabled={busy} onChange={e=>setDraft(x=>({...x,assigneeId:e.target.value}))}><option value="">Choose a member</option>{data?.members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}</select></label>
    <label>Task due date<input required type="date" min="2000-01-01" max="2100-12-31" value={draft.dueDate} disabled={busy} onChange={e=>setDraft(x=>({...x,dueDate:e.target.value}))}/></label>
    </div><label>Task notes<textarea rows={3} maxLength={500} value={draft.notes} disabled={busy} onChange={e=>setDraft(x=>({...x,notes:e.target.value}))}/></label><button disabled={busy||!data} type="submit">Save assigned task</button></form></section>}
   <nav className={styles.views} aria-label="Work views">{(Object.entries(WORK_VIEWS) as [WorkView,string][]).map(([view,label])=><button key={view} type="button" disabled={busy} aria-pressed={query.view===view} onClick={()=>changeView({...query,view,page:1})}><span>{label}</span><strong>{data?.counts[view]??'—'}</strong></button>)}</nav>
   <section className={styles.workspace} aria-label="Task workspace" aria-busy={loading}>
    <div className={styles.searchbar}><form role="search" onSubmit={e=>{e.preventDefault();changeView({...query,q:search.trim(),page:1});}}><label className={styles.srOnly} htmlFor="work-search">Search all tasks</label><input id="work-search" placeholder="Search title, category or owner…" maxLength={120} value={search} disabled={busy} onChange={e=>setSearch(e.target.value)}/><button disabled={busy} type="submit">Search</button></form><div className={styles.display} aria-label="Task display"><button type="button" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}>List</button><button type="button" aria-pressed={layout==='board'} onClick={()=>setLayout('board')}>Board</button></div><button type="button" className={styles.secondary} disabled={busy||loading} onClick={()=>{setSelected([]);setPreview(null);setReload(x=>x+1);}}>Refresh</button></div>
    {loading&&!data&&<p className={styles.empty} role="status">Loading matching work…</p>}
    {data&&<><div className={styles.resultHeading}><h2>{WORK_VIEWS[query.view]}</h2><span>{data.total} matching task{data.total===1?'':'s'} · Page {data.page} of {data.pages}</span>{admin&&data.items.some(t=>t.canPlan)&&<button type="button" disabled={busy} onClick={()=>{selectionChanged();setSelected(data.items.filter(t=>t.canPlan).map(({id,title,updatedAt})=>({id,title,updatedAt})));}}>Select eligible tasks on this page</button>}</div>
     {data.items.length===0?<div className={styles.empty}><h3>No tasks match this view.</h3><p>Try another view or search. An empty list does not establish that the business is compliant.</p><button type="button" onClick={()=>{setSearch('');changeView({view:'open',q:'',page:1});}}>Show all open work</button></div>:layout==='list'?<div className={styles.list}>{data.items.map(taskCard)}</div>:<><p className={styles.hint}>The board shows this results page; use pagination to continue through all matches.</p><div className={styles.board}>{['OPEN','IN_PROGRESS','COMPLETE'].map(status=><section key={status} aria-label={statusLabel(status)}><h3>{statusLabel(status)} <span>{data.items.filter(t=>t.status===status).length}</span></h3>{data.items.filter(t=>t.status===status).map(taskCard)}</section>)}</div></>}
     <div className={styles.pagination}><button type="button" disabled={busy||data.page<=1} onClick={()=>changeView({...query,page:data.page-1})}>Previous page</button><span>Showing {data.total?(data.page-1)*data.pageSize+1:0}–{Math.min(data.page*data.pageSize,data.total)} of {data.total}</span><button type="button" disabled={busy||data.page>=data.pages} onClick={()=>changeView({...query,page:data.page+1})}>Next page</button></div>
    </>}
   </section>
   {admin&&selected.length>0&&<section className={styles.planner} aria-label="Bulk planning"><div className={styles.resultHeading}><div><span className={styles.eyebrow}>PLAN ONCE, APPLY TOGETHER</span><h2>{selected.length} task{selected.length===1?'':'s'} selected</h2></div><button type="button" disabled={busy} onClick={()=>{setSelected([]);setPreview(null);}}>Clear selection</button></div><p>Change ownership or deadlines with a reviewed preview. This does not approve evidence, close work or change control ownership.</p>
    <form onSubmit={e=>{e.preventDefault();void plan('preview');}}><div className={styles.fields}>
     <label>Assign selected work to<select value={assignee} disabled={busy} onChange={e=>{selectionChanged();setAssignee(e.target.value);}}><option value="keep">Keep existing assignees</option><option value="unassigned">Remove workspace assignee</option>{data?.members.map(m=><option value={m.user.id} key={m.user.id}>{m.user.email}</option>)}</select></label>
     <label>New due date<input type="date" min="2000-01-01" max="2100-12-31" value={due} disabled={busy} onChange={e=>{selectionChanged();setDue(e.target.value);}}/><small>Leave blank to keep existing deadlines.</small></label>
    </div><label>Reason for this change<textarea minLength={20} maxLength={500} required rows={3} value={reason} disabled={busy} onChange={e=>{selectionChanged();setReason(e.target.value);}} placeholder="Explain the ownership or scheduling decision for the audit trail."/></label>
    {data?.membersLimited&&<p className={styles.hint}>The picker shows the first 200 eligible members. Manage other assignments through team administration.</p>}
    <button type="submit" disabled={busy||(assignee==='keep'&&!due)||reason.trim().length<20}>{busy?'Working…':'Preview changes'}</button></form>
    {preview&&<section className={styles.preview} aria-label="Change preview"><h3>Check the changes before applying</h3><ul>{preview.items.map(item=><li key={item.id}><strong>{item.title}</strong><span>{item.before.ownerName} → {item.after.ownerName}</span><span>Due {date(item.before.dueDate)} → {date(item.after.dueDate)}</span></li>)}</ul><p>{preview.reason}</p><button type="button" disabled={busy} onClick={()=>void plan('apply')}>Apply {preview.items.length} reviewed change{preview.items.length===1?'':'s'}</button><p className={styles.hint}>Changed records or permissions invalidate this preview. The whole batch succeeds or none of it is saved.</p></section>}
   </section>}
  </>}
  <dialog ref={dialog} className={styles.dialog} aria-labelledby="work-detail-title" onCancel={()=>setTaskId('')} onClose={()=>setTaskId('')}><div className={styles.dialogTop}><span className={styles.eyebrow}>TASK CONTEXT</span><button type="button" aria-label="Close task details" onClick={()=>setTaskId('')}>Close ×</button></div><h2 id="work-detail-title">{current?.task.title||'Task details'}</h2>
   {detailError&&<p className={styles.error} role="alert">{detailError}</p>}{!current&&!detailError&&<p role="status">Loading task context…</p>}
   {current&&<><div className={styles.detailMeta}><span className={styles.badge}>{statusLabel(current.task.status)}</span><span>Due {date(current.task.dueDate)}</span><span>{current.task.assignee?.email||current.task.ownerName}</span></div><p>{current.task.notes||'No additional task notes have been recorded.'}</p>
    <section className={styles.nextStep}><h3>Next step</h3><div className={styles.actions}>{current.canStart&&<button type="button" disabled={busy} onClick={()=>void startTask()}>Start task</button>}<a href={current.workflow.href}>{current.workflow.label} →</a>{current.canPlan&&<button type="button" disabled={busy} onClick={()=>{setSelected([{id:current.task.id,title:current.task.title,updatedAt:current.task.updatedAt}]);setPreview(null);setAssignee('keep');setDue('');setReason('');setTaskId('');setTimeout(()=>document.querySelector('[aria-label="Bulk planning"]')?.scrollIntoView({block:'start'}),0);}}>Plan owner or deadline</button>}</div>{current.planningBlocked&&<p>{current.planningBlocked}</p>}</section>
    <section><h3>Source and control context</h3>{current.task.managedControl?<p>Linked control: <strong>{current.task.managedControl.title}</strong>{!current.task.managedControl.enabled?' (paused)':''}</p>:<p>No managed control is directly linked.</p>}
     {safeWorkSource(current.task.sourceUrl)&&<a href={safeWorkSource(current.task.sourceUrl)!} target="_blank" rel="noopener noreferrer">Open recorded source reference ↗</a>}
     {current.task.intelligenceDecisions.map(decision=><article className={styles.reference} key={decision.id}><strong>{decision.run.snapshot.title}</strong><span>Recorded decision: {statusLabel(decision.decision)} · Source checked {date(decision.run.snapshot.lastCheckedAt)}</span>{safeWorkSource(decision.run.snapshot.url)&&<a href={safeWorkSource(decision.run.snapshot.url)!} target="_blank" rel="noopener noreferrer">Read publication ↗</a>}</article>)}
     <p className={styles.hint}>Recorded references explain provenance; they are not a new legal interpretation or confirmation that the source is current.</p>
    </section>
    <section><h3>Supporting evidence <span className={styles.count}>{current.task._count.evidence}</span></h3>{current.task.evidence.length?<ul className={styles.evidence}>{current.task.evidence.map(file=><li key={file.id}><strong>{file.filename}</strong><span>{file.scanStatus==='CLEAN'?statusLabel(file.reviewStatus):'Quarantined — not available for use'} · Added {date(file.createdAt)}</span></li>)}</ul>:<p>No evidence files have been attached.</p>}{current.evidenceLimited&&<p>Showing the newest 50 files. Open the evidence workspace for the remaining records.</p>}<a href={'/team/evidence?'+new URLSearchParams({organizationId:orgId,taskId:current.task.id})}>Open evidence workspace →</a><p className={styles.hint}>A clean scan or an approved file is not by itself a completed evidence assessment.</p></section>
    {current.task.assuranceAssessments.length>0&&<section><h3>Assessment history</h3><ul className={styles.evidence}>{current.task.assuranceAssessments.map(a=><li key={a.id}><strong>{statusLabel(a.status)}</strong><span>Created {date(a.createdAt)}{a.validUntil?' · Review date '+date(a.validUntil):''}</span></li>)}</ul><a href={'/team/assurance?'+new URLSearchParams({organizationId:orgId,taskId:current.task.id})}>Check current evidence validity →</a></section>}
    <section><h3>Activity</h3>{current.history.length?<ol className={styles.timeline}>{current.history.map(event=><li key={event.id}><strong>{event.action==='work.plan_applied'?'Ownership or deadline plan updated':event.action.replaceAll('.',' · ').replaceAll('_',' ')}</strong><time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol>:<p>No activity has been recorded for this task.</p>}{current.historyLimited&&<p>Showing the latest 30 task events.</p>}</section>
    {current.task.completionException&&<p className={styles.error}>Completed with a recorded exception: {current.task.completionRationale}</p>}
   </>}
  </dialog>
 </main></div>;
}
