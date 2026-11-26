'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {frameworkWorkspace} from '../../../../lib/server/framework-audits';
import {useWorkspaceContext,workspaceHref} from '../../../../lib/client/workspace-context';
import WorkspaceNav from '../../../components/workspace-nav';
import EmailSignIn from '../../../components/email-sign-in';
import css from '../programmes.module.css';
import shell from '../../../workbench/workbench.module.css';

type Workspace=Awaited<ReturnType<typeof frameworkWorkspace>>;
type Row=NonNullable<Workspace['selected']>['rows'][number];
type Owner={id:string;email:string};
function Assessment({row,owners,userId,busy,save}:{row:Row;owners:Owner[];userId:string;busy:boolean;save:(d:Record<string,unknown>)=>Promise<void>}){
  const [decision,setDecision]=useState(row.decision==='UNASSESSED'?'APPLIES':row.decision);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const f=new FormData(event.currentTarget);
    await save({operation:'assess',controlId:row.control.id,version:row.version,decision,reason:String(f.get('reason')??''),
      ...(decision==='APPLIES'?(row.task?{existingTaskId:row.task.id}:{ownerId:f.get('owner'),dueDate:f.get('due')}):{})});
  }
  return <form onSubmit={submit}><fieldset disabled={busy} className={css.fields}><legend>Record scope and evidence responsibility</legend>
    <label>Applicability<select value={decision} onChange={e=>setDecision(e.target.value)}>
      <option value="APPLIES">Applies</option><option value="EXCLUDED">Excluded</option><option value="REVIEW_NEEDED">Needs review</option></select></label>
    <label>Reason<textarea required name="reason" minLength={8} maxLength={1000} defaultValue={row.reason}/></label>
    {decision==='APPLIES'&&!row.task&&<><label>Evidence owner<select name="owner" required defaultValue={userId}>{owners.map(o=><option key={o.id} value={o.id}>{o.email}</option>)}</select></label>
      <label>Working due date<input type="date" name="due" required min={new Date().toISOString().slice(0,10)}/></label></>}
    {decision==='APPLIES'&&row.task&&<p>This scope already has an evidence task owned by {row.task.owner}. Saving links the audit to that task.</p>}
    <button type="submit">Save control decision</button></fieldset></form>;
}
export default function FrameworkWorkspace({framework}:{framework:string}){
  const ctx=useWorkspaceContext(),{organizationId,revision,request,requestResponse,capture}=ctx;
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[search,setSearch]=useState('');
  const [state,setState]=useState<{key:string;data:Workspace}|null>(null),[refresh,reload]=useState(0);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const key=JSON.stringify([organizationId,revision,framework,page,q,refresh]);
  const makeUrl=(format?:string)=>'/api/workspace/framework-audits?'+new URLSearchParams({organizationId,framework,page:String(page),q,...(format?{format}:{})});
  const url=makeUrl(),data=state?.key===key?state.data:null,selected=data?.selected;
  useEffect(()=>{
    if(!organizationId)return;
    let current=true;const controller=new AbortController();setError('');setBusy(false);
    request(url,{signal:controller.signal}).then((value:Workspace)=>{if(current&&value.organizationId===organizationId)setState({key,data:value});}).catch((e:Error)=>{if(current)setError(e.message);});
    return()=>{current=false;controller.abort();};
  },[url,key,organizationId,request]);
  async function save(input:Record<string,unknown>){
    if(!selected||busy)return;
    const valid=capture();setBusy(true);setError('');setNotice('');
    try{
      await request('/api/workspace/framework-audits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,framework,digest:selected.profile.digest,...input})});
      if(valid()){setNotice(input.operation==='enable'?'Framework audit started.':'Control decision saved.');reload(x=>x+1);}
    }catch(e){if(valid())setError(e instanceof Error?e.message:'Could not save the audit change.');}
    finally{if(valid())setBusy(false);}
  }
  async function exportAudit(){
    const valid=capture();setError('');
    try{
      const response=await requestResponse(makeUrl('csv')),blob=await response.blob();if(!valid())return;
      const object=URL.createObjectURL(blob),a=document.createElement('a');a.href=object;a.download=framework+'-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);
    }catch(e){if(valid())setError(e instanceof Error?e.message:'Export failed.');}
  }
  const destination='/team/programmes/frameworks';
  const currentUser=ctx.userId;
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
    <nav className={css.toolbar}><a href="/audit-programmes/frameworks">Framework catalogue</a><a href={workspaceHref('/team/programmes',organizationId)}>Starter programmes</a></nav>
    <header className={css.hero}><h1>Framework audits</h1></header>
    {!ctx.loading&&!ctx.signedIn&&<section className={css.panel}><h2>Sign in to your workspace</h2><EmailSignIn destination={destination}/></section>}
    {ctx.signedIn&&ctx.organisations.length>0&&<label>Organisation<select value={organizationId} disabled={busy} onChange={e=>{setNotice('');setError('');setQ('');setSearch('');setPage(1);ctx.chooseOrganization(e.target.value);}}>
      {!organizationId&&<option value="">Select an organisation</option>}{ctx.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
    {ctx.signedIn&&!ctx.loading&&!ctx.organisations.length&&<a href="/team/setup">Create a workspace</a>}
    {(error||ctx.error)&&<p role="alert">{error||ctx.error} {organizationId&&<button type="button" onClick={()=>reload(v=>v+1)}>Reload</button>}</p>}
    {notice&&<p role="status">{notice}</p>}
    {organizationId&&!data&&!error&&<p role="status">Loading audits…</p>}
    {data&&!selected&&<section className={css.panel}><h2>Your framework audits</h2>
      <p><a href="/audit-programmes/frameworks">Choose a framework</a></p>
      {data.audits.length?<ul>{data.audits.map(a=><li key={a.framework}><a href={workspaceHref('/team/programmes/frameworks',organizationId,{framework:a.framework})}>{a.name}</a> · {a.scope}</li>)}</ul>:<p>This workspace has no active framework audits.</p>}
    </section>}
    {data&&selected&&<><section className={css.panel}><h2>{selected.profile.name}</h2>
      <p><a href={'/audit-programmes/frameworks/'+framework}>Read controls and source references</a></p>
      {!selected.active?(data.canEdit?<form onSubmit={e=>{e.preventDefault();void save({operation:'enable',scope:new FormData(e.currentTarget).get('scope')});}}>
        <label>Audit scope<textarea name="scope" required minLength={8} maxLength={600} placeholder="Organisation, sites and services included"/></label>
        <p>Frameworks with the same recorded scope can share evidence tasks for the same published control.</p><button disabled={busy}>Start framework audit</button>
      </form>:<p>A workspace administrator can start this audit.</p>):<>
        <p>Scope · {selected.scope}</p><p>{selected.assessed} of {selected.profile.count} controls have a recorded scope decision.</p>
        {data.canEdit&&<button onClick={()=>void exportAudit()}>Export full audit CSV</button>}</>}
    </section>
    {selected.active&&<section className={css.panel}><form onSubmit={e=>{e.preventDefault();setQ(search.trim());setPage(1);}}>
      <label>Find controls or references<input type="search" maxLength={150} value={search} onChange={e=>setSearch(e.target.value)}/></label><button>Search</button></form>
      <p>{selected.total} results · Page {selected.page} of {selected.pages}</p>
      {selected.rows.map(r=><details key={r.control.id+'-'+r.version}><summary>{r.control.id} · {r.control.name} · {r.decision.replaceAll('_',' ').toLowerCase()}</summary>
        {r.control.description&&<p>{r.control.description}</p>}<p style={{whiteSpace:'pre-line'}}>{r.control.reference} · <a href={r.control.url}>Source document</a></p>
        {r.control.sourcePassage&&<blockquote>{r.control.sourcePassage}</blockquote>}
        {r.control.objectives.length>0&&<details><summary>Assessment objectives</summary><ul>{r.control.objectives.map(o=><li key={o.id}>{o.id} · {o.text}</li>)}</ul></details>}
        {r.control.evidence.length>0&&<details><summary>{r.control.suggestedEvidence?'Suggested evidence request':'Evidence to collect'}</summary><ul>{r.control.evidence.map(f=><li key={f.id}>{f.name}{f.description&&<p>{f.description}</p>}</li>)}</ul></details>}
        {r.task&&<p><a href={workspaceHref('/team/work',organizationId,{taskId:r.task.id})}>Open evidence task</a> · {r.task.owner} · {r.task.status}</p>}
        {r.decision==='APPLIES'&&<p>{r.reviewedEvidence} independently reviewed evidence files</p>}
        {r.reason&&<p>Recorded reason · {r.reason}</p>}
        {data.canEdit&&<Assessment row={r} owners={data.owners} userId={currentUser} busy={busy} save={save}/>}
      </details>)}
      <nav className={css.toolbar} aria-label="Control pages"><button disabled={selected.page<=1||busy} onClick={()=>setPage(selected.page-1)}>Previous</button><button disabled={selected.page>=selected.pages||busy} onClick={()=>setPage(selected.page+1)}>Next</button></nav>
    </section>}
    {selected.profile.source==='scf'&&<p>Secure Controls Framework® (SCF) 2026.3, © Secure Controls Framework Council, LLC. Published content is unchanged. <a href="https://creativecommons.org/licenses/by-nd/4.0/legalcode.en">CC BY-ND 4.0</a> · <a href={'/audit-programmes/frameworks/'+framework}>Source and attribution</a></p>}
    {selected.profile.source==='uk'&&<p>UK legislation contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>.</p>}
    {selected.profile.source==='eu'&&<p>Source · <a href={selected.profile.url}>Official Journal of the European Union, EUR-Lex</a>.</p>}
    </>}
  </main></div>;
}
