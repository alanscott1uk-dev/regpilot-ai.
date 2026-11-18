'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import WorkspaceNav from '../../../components/workspace-nav';
import EmailSignIn from '../../../components/email-sign-in';
import {browserAuth} from '../../../../lib/client/supabase-auth';
import {workUuid} from '../../../../lib/work-hub.mjs';
import type {WorkReviewQueue} from '../../../../lib/server/work-review-service';
import {ReviewDetail} from './review-detail';
import {reviewDate,reviewLabels} from './review-common';
import shell from '../../../workbench/workbench.module.css';
import styles from './reviews.module.css';

type Session={userId:string;email:string;organisations:{id:string;name:string;role:string}[]};
type Query={q:string;page:number};

function reviewUrl(organizationId:string,query:Query,taskId=''){
 const params=new URLSearchParams({organizationId,page:String(query.page)});
 if(query.q)params.set('q',query.q);if(taskId)params.set('taskId',taskId);
 return '/team/work/reviews?'+params;
}
function rememberUrl(url:string){
 window.history.replaceState(window.history.state,'',url);
 window.dispatchEvent(new Event('regpilot-workspace-navigation'));
}

export default function CompletedWorkReviews(){
 const [session,setSession]=useState<Session|null>(null),[sessionLoading,setSessionLoading]=useState(true),[sessionRetry,setSessionRetry]=useState(0);
 const [organizationId,setOrganizationId]=useState(''),[query,setQuery]=useState<Query>({q:'',page:1}),[search,setSearch]=useState(''),[taskId,setTaskId]=useState('');
 const [loaded,setLoaded]=useState<{key:string;value:WorkReviewQueue}|null>(null),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const identity=useRef(''),mutation=useRef<string|null>(null),sessionUser=useRef('');
 const scope=(session?.userId||'')+':'+organizationId,key=scope+':'+JSON.stringify(query),actionKey=scope+':'+taskId;
 identity.current=scope;
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw new Error('Your session ended. Sign in again to continue.');
  const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,authorization:'Bearer '+token}});
  const body=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if(!response.ok)throw new Error(body.error||'The review could not be loaded.');
  return body;
 },[]);

 useEffect(()=>{
  let active=true,sequence=0,unsubscribe=()=>{};const abort=new AbortController();
  function clearSession(){identity.current='';mutation.current=null;setBusy(false);setSession(null);setOrganizationId('');setTaskId('');setLoaded(null);}
  async function loadSession(){const run=++sequence;
   try{
    const local=(await browserAuth().auth.getSession()).data.session;
    if(!active||run!==sequence)return;
    if(!local){clearSession();return;}
    const next=await request('/api/ai/context',{signal:abort.signal}) as Session;
    if(!active||run!==sequence)return;
    if(sessionUser.current!==next.userId){mutation.current=null;setBusy(false);setLoaded(null);setTaskId('');}
    sessionUser.current=next.userId;setSession(next);
    const params=new URLSearchParams(window.location.search),desired=params.get('organizationId'),selected=params.get('taskId');
    if(desired!==null&&(!workUuid(desired)||!next.organisations.some(org=>org.id===desired))){
     identity.current='';setOrganizationId('');setTaskId('');setLoaded(null);setError('The linked organisation is unavailable for this account. Choose a workspace to continue.');return;
    }
    const q=(params.get('q')||'').trim(),pageValue=params.get('page')||'1';
    if(q.length>120||!/^\d{1,6}$/.test(pageValue)||Number(pageValue)<1)throw new Error('The linked review search is invalid. Open completed work reviews again.');
    if(selected!==null&&!workUuid(selected))throw new Error('The linked task is invalid. Open completed work reviews again.');
    setOrganizationId(desired||next.organisations[0]?.id||'');setQuery({q,page:Number(pageValue)});setSearch(q);setTaskId(selected||'');setError('');
   }catch(cause){if(active&&run===sequence){clearSession();setError(cause instanceof Error?cause.message:'Could not load your workspace.');}}
   finally{if(active&&run===sequence)setSessionLoading(false);}
  }
  try{
   const auth=browserAuth().auth;const {data}=auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){sequence++;clearSession();setError('');setSessionLoading(false);}
    else if(event==='INITIAL_SESSION'||event==='SIGNED_IN')window.setTimeout(()=>{if(active)void loadSession();},0);
   });unsubscribe=()=>data.subscription.unsubscribe();void loadSession();
  }catch{setSessionLoading(false);setError('Private workspace sign-in is not configured in this environment.');}
  return()=>{active=false;sequence++;abort.abort();unsubscribe();identity.current='';};
 },[request,sessionRetry]);

 useEffect(()=>{
  if(!organizationId||!session||taskId){setLoading(false);return;}
  let active=true;const abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),20000);
  setLoading(true);setLoaded(null);setError('');
  void request('/api/workspace/work/reviews?'+new URLSearchParams({organizationId,q:query.q,page:String(query.page)}),{signal:abort.signal})
   .then((value:WorkReviewQueue)=>{if(!active)return;if(value.organizationId!==organizationId)throw new Error('This review list belongs to another workspace. Refresh it.');setLoaded({key,value});})
   .catch(cause=>{if(active)setError(cause instanceof Error&&cause.name!=='AbortError'?cause.message:'The review list did not respond. Refresh to check again.');})
   .finally(()=>{window.clearTimeout(timer);if(active)setLoading(false);});
  rememberUrl(reviewUrl(organizationId,query));
  return()=>{active=false;window.clearTimeout(timer);abort.abort();};
 },[organizationId,session,key,query,taskId,reload,request]);

 const data=loaded?.key===key?loaded.value:null;
 function chooseTask(id:string){setTaskId(id);setError('');rememberUrl(reviewUrl(organizationId,query,id));}
 function choosePage(next:Query){setLoaded(null);setQuery(next);setError('');rememberUrl(reviewUrl(organizationId,next));}
 function chooseOrganisation(id:string){
  identity.current='';setLoaded(null);setTaskId('');setQuery({q:'',page:1});setSearch('');setError('');setOrganizationId(id);
  rememberUrl(reviewUrl(id,{q:'',page:1}));
 }
 const pageCounts=data?Object.fromEntries(Object.keys(reviewLabels).map(state=>[state,data.items.filter(item=>item.state===state).length])):null;

 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
  <div className={styles.topline}><a href={'/team/work'+(organizationId?'?'+new URLSearchParams({organizationId}):'')}>Tasks</a><span>Completed work reviews</span></div>
  <header className={styles.hero}><span className={styles.eyebrow}>AFTER THE WORK IS DONE</span><h1>Keep completed work in view.</h1><p>See what has changed since completion, give follow-up work an owner and record a fresh review of the evidence.</p></header>
  {error&&<div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={()=>{if(session&&organizationId)setReload(value=>value+1);else{setSessionLoading(true);setSessionRetry(value=>value+1);}}}>Refresh review workspace</button></div>}
  {sessionLoading&&<p role="status">Loading your review workspace…</p>}
  {!sessionLoading&&!session&&<section className={styles.empty}><h2>Sign in to review completed work</h2><EmailSignIn destination="/team/work/reviews"/></section>}
  {session&&!organizationId&&<section className={styles.empty}><h2>Choose a workspace</h2>{session.organisations.map(org=><p key={org.id}><a href={reviewUrl(org.id,{q:'',page:1})}>{org.name}</a></p>)}{session.organisations.length===0&&<a href="/team">Create an organisation →</a>}</section>}
  {organizationId&&<>
   <div className={styles.toolbar}><label htmlFor="review-organisation">Organisation<select id="review-organisation" aria-label="Organisation" value={organizationId} disabled={busy} onChange={event=>chooseOrganisation(event.target.value)}>{session?.organisations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label><a href={'/team/work?'+new URLSearchParams({organizationId,view:'complete'})}>Open completed task list →</a></div>
   {taskId?<>
    <button className={styles.back} type="button" disabled={busy} onClick={()=>chooseTask('')}>← Back to completed work reviews</button>
    <ReviewDetail key={scope+':'+taskId} organizationId={organizationId} taskId={taskId} request={request} busy={busy}
     beginAction={()=>{if(mutation.current)return false;mutation.current=actionKey;setBusy(true);return true;}}
     endAction={()=>{if(mutation.current===actionKey){mutation.current=null;setBusy(false);}}}
     onSaved={()=>{if(identity.current===scope)setReload(value=>value+1);}}/>
   </>:<section className={styles.workspace} aria-label="Completed work review list" aria-busy={loading}>
    <div className={styles.searchbar}><form role="search" onSubmit={event=>{event.preventDefault();choosePage({q:search.trim(),page:1});}}><label className={styles.srOnly} htmlFor="review-search">Search completed tasks</label><input id="review-search" maxLength={120} placeholder="Search title, category or owner…" value={search} onChange={event=>setSearch(event.target.value)}/><button type="submit">Search completed work</button></form><button className={styles.secondary} type="button" disabled={loading} onClick={()=>setReload(value=>value+1)}>Refresh checks</button></div>
    <p className={styles.hint}>These checks compare saved records. Original file contents are checked again when you record a fresh review.</p>
    {loading&&<p role="status">Checking completed work on this page…</p>}
    {data&&<>
     <div className={styles.listHeading}><h2>{data.total} completed task{data.total===1?'':'s'}{query.q?' matching your search':''}</h2><span>Page {data.page} of {data.pages}</span></div>
     <div className={styles.pageSummary} aria-label="Review states on this page"><p>On this page</p><div>{Object.entries(reviewLabels).map(([state,label])=><span key={state}><strong>{pageCounts?.[state]||0}</strong>{label}</span>)}</div></div>
     {data.items.length===0?<div className={styles.empty}><h3>No completed tasks match this search.</h3><p>Change your search or return to the work hub.</p></div>:<div className={styles.reviewList}>{data.items.map(item=><article key={item.task.id} className={styles.reviewRow}>
      <a href={reviewUrl(organizationId,query,item.task.id)} onClick={event=>{event.preventDefault();chooseTask(item.task.id);}} className={styles.taskLink}><span className={styles.eyebrow}>{item.task.category}</span><strong>{item.task.title}</strong><span>{item.task.ownerName} · Completed {reviewDate(item.task.completedAt)} UTC</span><span className={styles.rowReason}>{item.findings[0]?.message||(item.state==='NO_RECORDED_CHANGES'?'No recorded change was identified against the saved basis.':'Open the review to inspect the recorded context.')}</span></a>
      <div className={styles.rowState}><span className={styles.stateBadge} data-state={item.state}>{reviewLabels[item.state]}</span>{item.followUp&&<small>Follow-up {item.followUp.status==='COMPLETE'?'completed':item.followUp.status==='IN_PROGRESS'?'in progress':'open'} · {item.followUp.ownerName}</small>}</div>
     </article>)}</div>}
     <div className={styles.pagination}><button className={styles.secondary} type="button" disabled={data.page<=1} onClick={()=>choosePage({...query,page:data.page-1})}>Previous review page</button><span>Showing {data.total?(data.page-1)*data.pageSize+1:0}–{Math.min(data.page*data.pageSize,data.total)} of {data.total}</span><button className={styles.secondary} type="button" disabled={data.page>=data.pages} onClick={()=>choosePage({...query,page:data.page+1})}>Next review page</button></div>
     <p className={styles.hint}>{data.scope}</p>
    </>}
   </section>}
  </>}
 </main></div>;
}
