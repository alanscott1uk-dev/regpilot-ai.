'use client';
import {MIN_RESEARCH_QUESTION, publicationResearchHref} from "../../lib/regulatory/publication-query.mjs";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {PUBLISHERS,rankItem,describeFeedIssue,type HorizonItem,type HorizonReport} from '../../lib/horizon/model';
import {useWorkspaceContext,workspaceHref} from '../../lib/client/workspace-context';
import {horizonTopics, searchPhrases, sameHorizonFilters, matchesHorizonView, matchingPhrase, type HorizonFilters, type HorizonWatch, type WatchlistMutation} from '../../lib/horizon/watchlists';
import {WatchlistControls} from './watchlist-controls';
import ui from './horizon.module.css';
type Workspace={watchlists:HorizonWatch[];role:string;members:{id:string;email:string}[];activities:string[];decisions:{itemId:string;revision:string;state:string;taskId:string|null;notes:string;watchlist?:{name:string;version:number;matchedPhrase:string|null}}[];limited:boolean};
const date=(s:string)=>new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
export default function Horizon(){
 const context=useWorkspaceContext();
 const [report,setReport]=useState<HorizonReport|null>(null),[state,setState]=useState('loading'),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);try{const r=await fetch('/api/horizon',{cache:'no-store',signal}),data=await r.json();if(!r.ok)throw Error(data.error||'Feed unavailable');if(signal?.aborted)return;setReport(data.report);setState(data.state);setError('');}catch(e){if(!signal?.aborted){setError(e instanceof Error?e.message:'Feed unavailable');setState('unavailable');}}finally{if(!signal?.aborted)setLoading(false);}},[]);
 useEffect(()=>{const a=new AbortController();void load(a.signal);return()=>a.abort();},[load]);
 return <HorizonDesk key={context.revision} context={context} report={report} state={state} error={error} loading={loading} reloadReport={load}/>;
}
type DeskProps = {
 context: ReturnType<typeof useWorkspaceContext>;
 report: HorizonReport|null;
 state: string;
 error: string;
 loading: boolean;
 reloadReport: () => Promise<void>;
};
function HorizonDesk({context,report,state,error,loading,reloadReport}:DeskProps){
 const {organisations:orgs, organizationId:orgId, chooseOrganization:setOrgId, request, capture}=context;
 const [search,setSearch]=useState(''),[publisher,setPublisher]=useState(''),[kind,setKind]=useState<HorizonFilters['kind']>(''),[topic,setTopic]=useState(''),[updatedWithin,setUpdatedWithin]=useState<HorizonFilters['updatedWithin']>('window'),[changedOnly,setChangedOnly]=useState(false),[onlyOpen,setOnlyOpen]=useState(false),[limit,setLimit]=useState(20);
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[workspaceLoading,setWorkspaceLoading]=useState(false);
 const [selectedWatch,setSelectedWatch]=useState<HorizonWatch|null>(null);
 const [selected,setSelected]=useState<HorizonItem|null>(null),[owner,setOwner]=useState(''),[due,setDue]=useState(new Date(Date.now()+7*86400000).toISOString().slice(0,10)),[notes,setNotes]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const readWorkspace=useCallback(async(signal?:AbortSignal)=>{
  const valid=capture();
  const data:Workspace=await request('/api/workspace/horizon?organizationId='+encodeURIComponent(orgId),{signal});
  if(!signal?.aborted&&valid()){setWorkspace(data);setOwner(previous=>data.members.some(member=>member.id===previous)?previous:data.members[0]?.id||'');}
  return data.watchlists;
 },[capture,orgId,request]);
 useEffect(()=>{if(!orgId)return;const a=new AbortController();setWorkspaceLoading(true);
  void readWorkspace(a.signal).catch(e=>{if(!a.signal.aborted)setMessage(e.message);}).finally(()=>{if(!a.signal.aborted)setWorkspaceLoading(false);});
  return ()=>a.abort();
 },[orgId,readWorkspace]);
 const filters=useMemo<HorizonFilters>(()=>({publisher,kind,topic,phrases:searchPhrases(search),updatedWithin,onlyOpen,changedOnly}),[publisher,kind,topic,search,updatedWithin,onlyOpen,changedOnly]);
 function applyFilters(view:HorizonFilters){
  setPublisher(view.publisher);setKind(view.kind);setTopic(view.topic);setSearch(view.phrases.join(', '));
  setUpdatedWithin(view.updatedWithin);setOnlyOpen(view.onlyOpen);setChangedOnly(view.changedOnly);setSelected(null);setAck(false);setNotes('');
 }
 async function saveWatchlist(change:WatchlistMutation):Promise<HorizonWatch>{
  const valid=capture();
  const saved:HorizonWatch=await request('/api/workspace/horizon/watchlists?organizationId='+encodeURIComponent(orgId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(change)});
  if(valid())setWorkspace(w=>w?{...w,watchlists:[...w.watchlists.filter(row=>row.id!==saved.id),...(saved.archived?[]:[saved])].sort((a,b)=>a.name.localeCompare(b.name))}:w);
  return saved;
 }
 useEffect(()=>setLimit(20),[filters]);
 const topics=topic?[topic]:workspace?.activities||[];
 const decisions=useMemo(()=>new Map((workspace?.decisions||[]).map(d=>[d.itemId+':'+d.revision,d])),[workspace]);
 const items=useMemo(()=>(report?.items||[]).filter(item=>matchesHorizonView(item,filters,report!.generatedAt,decisions.has(item.id+':'+item.revision)))
  .map(item=>({item,...rankItem(item,topics)})).sort((a,b)=>b.score-a.score||b.item.updatedAt.localeCompare(a.item.updatedAt)||a.item.id.localeCompare(b.item.id)),[report,filters,decisions,workspace]);
 const canWrite=!!workspace&&['OWNER','ADMIN','EDITOR'].includes(workspace.role);
 function select(item:HorizonItem){setSelected(item);setNotes('');setAck(false);setMessage('');}
 async function decide(action:'queue'|'dismiss'){
  if(!selected||!canWrite||busy)return;const org=orgId,valid=capture();setBusy(true);setMessage('');
  try{
   const watch=selectedWatch&&sameHorizonFilters(selectedWatch.filters,filters)?{id:selectedWatch.id,version:selectedWatch.version}:null;
   const result=await request('/api/workspace/horizon',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    organizationId:org,itemId:selected.id,revision:selected.revision,action,notes,reviewAcknowledged:ack,
    ...(watch?{watchlist:watch}:{}),...(action==='queue'?{ownerId:owner,dueDate:due}:{})
   })});
   if(!valid())return;
   if(result.reused)await readWorkspace();
   else setWorkspace(w=>w?{...w,decisions:[{itemId:selected.id,revision:selected.revision,state:result.state,taskId:result.taskId||null,notes,watchlist:result.watchlist},...w.decisions.filter(d=>d.itemId!==selected.id||d.revision!==selected.revision)]}:w);
   if(!valid())return;
   setSelected(null);setMessage(result.reused?'Existing review decision found.':action==='queue'?'Review task created with the selected owner and date.':'This publication revision was dismissed with your rationale.');
  }catch(e){if(valid())setMessage(e instanceof Error?e.message:'Could not save review');}finally{if(valid())setBusy(false);}
 }
 return <div className={ui.page}><header className={ui.top}><a href='/workbench' className={ui.brand}>RegPilot <span>AI</span></a><nav aria-label='Workspace navigation'><a href='/team/operations'>Operations</a><a href='/team/sources'>Source history</a><a href='/team/changes'>Change response</a><a href='/team/setup'>Workspace setup</a></nav></header>
 <main className={ui.main}><header className={ui.hero}><div><span className={ui.eyebrow}>LIVE UK HORIZON FEED</span><h1>Know what’s coming.<br/><em>Decide what matters.</em></h1><p>Newly discovered and updated official publications, brought into one review queue. Filter by your activities, inspect the source, then assign the next step.</p></div><aside className={ui.pulse}><span className={ui.status}>{loading?'CHECKING FEED':state.toUpperCase()}</span><strong>{report?.items.length??'—'}</strong><span>publication records · last 30 days</span><small>{report?'Collected '+date(report.generatedAt):'Waiting for verified collection'}</small><button onClick={()=>void reloadReport()} disabled={loading}>Refresh feed</button></aside></header>
 {context.error&&context.signedIn&&<p className={ui.alert} role='alert'>{context.error}</p>}
 {error&&<p className={ui.alert} role='alert'>{error}</p>}
 {report&&<><div className={ui.context}><p><b>Discovery, ready for review.</b> Headlines and publisher timestamps are not verified obligations or legal deadlines. Priority reflects document category and selected activities.</p><a href='https://github.com/alanscott1uk-dev/regpilot-ai./actions/workflows/continuous-public-watch.yml' target='_blank' rel='noreferrer'>View collection runs ↗</a></div>
 <details className={ui.health}>
   <summary>{report.feeds.filter(f=>f.state!=='unavailable').length} of {report.feeds.length} publisher feeds responded · {report.feeds.filter(f=>f.state==='limited').length} limited · {report.feeds.filter(f=>f.state==='unavailable').length} unavailable</summary>
   <div>{report.feeds.map(feed=><p key={feed.id}>
     <b>{PUBLISHERS.find(p=>p.id===feed.id)?.name}</b>
     <span>{feed.state} · {feed.retrieved} of {feed.total??'unknown'} results</span>
     {feed.reason&&<span>{describeFeedIssue(feed.reason)}</span>}
     {feed.state!=='available'&&<span>Last checked {new Date(feed.checkedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</span>}
     {feed.retryAt&&<span>Retry after {new Date(feed.retryAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</span>}
   </p>)}</div>
   <small>Each hourly collection reads up to 2,000 results per selected GOV.UK publisher. When a feed is unavailable, retained publications keep their earlier observation time.</small>
 </details>
 {report.pipeline&&<details className={ui.health}><summary>Collection reliability · {report.pipeline.requests} reads · {report.pipeline.retries} retries · {report.pipeline.history.length} earlier published runs</summary><p>Latest collection took {Math.ceil(report.pipeline.durationMs/1000)} seconds. A feed older than three hours is marked stale. This history covers published reports; a missed job is detected through the report age.</p><div>{report.pipeline.history.slice(0,12).map(h=><p key={h.generatedAt}><b>{new Date(h.generatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</b><span>{h.publications} records · {h.unavailable} unavailable · {h.limited} limited</span></p>)}</div><a href='/api/horizon/health' target='_blank' rel='noreferrer'>Machine-readable collection health ↗</a></details>}
 {workspace&&<WatchlistControls selected={selectedWatch} setSelected={setSelectedWatch} watches={workspace.watchlists} filters={filters} organizationId={orgId} canManage={['ADMIN','OWNER'].includes(workspace.role)} apply={applyFilters} save={saveWatchlist} reload={readWorkspace}/>}
 <section className={ui.filters} aria-label='Publication filters'><label>Search<input aria-label="Search" maxLength={640} aria-describedby="phrase-help" value={search} onChange={e=>setSearch(e.target.value)} placeholder='e.g. GMP, cold chain'/><small id="phrase-help">Separate alternative words or phrases with commas.</small></label><label>Publisher<select aria-label="Publisher" value={publisher} onChange={e=>setPublisher(e.target.value)}><option value=''>All publishers</option>{PUBLISHERS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Document category<select aria-label="Document category" value={kind} onChange={e=>setKind(e.target.value as HorizonFilters['kind'])}><option value=''>All categories</option>{['Safety alert','Consultation','Regulation or decision','Guidance','Policy','News','Other publication'].map(k=><option key={k}>{k}</option>)}</select></label><label>Activity focus<select aria-label="Activity focus" value={topic} onChange={e=>setTopic(e.target.value)}><option value=''>{workspace?'Use workspace activities':'All activities'}</option>{horizonTopics.map(t=><option key={t} value={t}>{t.replaceAll('-',' ')}</option>)}</select></label><label>Publisher updated<select aria-label="Publisher updated" value={updatedWithin} onChange={e=>setUpdatedWithin(e.target.value as HorizonFilters['updatedWithin'])}><option value="window">Full collection window</option><option value="day">Past 24 hours</option><option value="week">Past 7 days</option></select></label><label className={ui.check}><input type='checkbox' checked={changedOnly} onChange={e=>setChangedOnly(e.target.checked)}/>New or updated in this collection</label></section>
 <section className={ui.workspace} aria-label='Review workspace'>{orgs.length?<><label>Workspace<select aria-label="Workspace" value={orgId} onChange={e=>setOrgId(e.target.value)}><option value='' disabled>Choose a workspace</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label className={ui.check}><input type='checkbox' checked={onlyOpen} onChange={e=>setOnlyOpen(e.target.checked)}/>Awaiting a decision</label><span>{workspaceLoading?'Loading review permissions…':!workspace?'Review workspace unavailable.':canWrite?'Assign owned reviews or record a dismissal.':'Read-only workspace access.'}</span></>:<p>Browse the live feed freely. <a href='/team/setup'>Sign in and choose a workspace</a> to assign review work.</p>}</section>
 {workspace?.limited&&<p className={ui.alert}>The latest 500 review decisions are displayed. Older decisions may not be shown; duplicate task prevention remains enforced when saving.</p>}
 {message&&<p className={ui.message} role='status'>{message}</p>}
 <div className={ui.results}><h2>{items.length} publications</h2><span>Sorted by review priority, then publisher update</span></div>
 <section aria-label='Publications' className={ui.cards}>{items.slice(0,limit).map(({item,reasons})=>{const decision=decisions.get(item.id+':'+item.revision),stale=Date.now()-Date.parse(item.observedAt)>12*3600000;
 const reviewable=canWrite&&!stale&&state!=='stale'&&state!=='unavailable'&&item.publisherIds.some(id=>report.feeds.some(f=>f.id===id&&f.state!=='unavailable'));
 return <article key={item.id} className={ui.card}><div className={ui.tags}><span>{item.kind}</span><span>{item.discovery.replaceAll('_',' ').toLowerCase()}</span>{decision&&<span>{decision.state}</span>}{stale&&<span>Older observation</span>}</div><h3><a href={item.url} target='_blank' rel='noreferrer'>{item.title} ↗</a></h3><p>{item.summary||'Open the official publication to inspect its contents.'}</p><div className={ui.meta}>{item.publisherIds.map(id=>PUBLISHERS.find(p=>p.id===id)?.name).join(' · ')}<br/>Publisher update {date(item.updatedAt)} · Observed {date(item.observedAt)}</div><p className={ui.reason}>Why surfaced: {reasons.join('; ')}.{filters.phrases.length>0&&<> Matched “{matchingPhrase(item,filters.phrases)}”.</>}</p>{decision?.watchlist&&<p>Reviewed from {decision.watchlist.name}, version {decision.watchlist.version}{decision.watchlist.matchedPhrase&&<> · Matched “{decision.watchlist.matchedPhrase}”</>}</p>}<div className={ui.cardActions}>{decision?.taskId?<a href={workspaceHref('/team',orgId,{taskId:decision.taskId})}>Open assigned review</a>:<button onClick={()=>select(item)} disabled={!reviewable||busy}>{decision?.state==='dismissed'?'Reconsider revision':'Review publication'}</button>}<a href={item.url} target='_blank' rel='noreferrer'>Official source ↗</a></div>
 {selected?.id===item.id&&selected.revision===item.revision&&reviewable&&<form className={ui.review} onSubmit={e=>{e.preventDefault();void decide('queue')}}><h4>Review context and ownership</h4><label>Responsible person<select aria-label="Responsible person" value={owner} onChange={e=>setOwner(e.target.value)} required>{workspace?.members.map(m=><option key={m.id} value={m.id}>{m.email}</option>)}</select></label><label>Internal review date<input type='date' value={due} onChange={e=>setDue(e.target.value)} required/></label><label>Rationale / what needs checking<textarea value={notes} onChange={e=>setNotes(e.target.value)} minLength={20} maxLength={800} required rows={3}/></label><label className={ui.check}><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)}/>I understand this is a review decision, not acceptance of a legal obligation.</label><div className={ui.cardActions}><button type='submit' disabled={busy||!ack||notes.trim().length<20||!owner}>Create review task</button><button type='button' disabled={busy||!ack||notes.trim().length<20} onClick={()=>void decide('dismiss')}>Dismiss this revision</button><button type='button' onClick={()=>setSelected(null)} disabled={busy}>Cancel</button></div></form>}</article>})}</section>
 {!items.length&&<p className={ui.empty}>No recent publications match these filters. {search.trim().length>=MIN_RESEARCH_QUESTION&&<a href={publicationResearchHref(search)}>Ask RegPilot about this topic in published guidance</a>}</p>}
 {items.length>limit&&<button className={ui.more} onClick={()=>setLimit(n=>n+20)}>Show 20 more</button>}
 <footer className={ui.foot}>{report.limitations.map(s=><p key={s}>{s}</p>)}<a href='https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/' target='_blank' rel='noreferrer'>Open Government Licence v3.0 ↗</a></footer></>}
 </main></div>;
}
