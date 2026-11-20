"use client";
import WorkspaceNav from "../../components/workspace-nav";
import {OfficialLink} from "../../components/regulator-account-links";
import {regulatorServices} from "../../../lib/regulator-services";
import {accountingIds,accountingSoftware} from "../../../lib/accounting-software";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useWorkspaceContext,workspaceHref} from '../../../lib/client/workspace-context';
import {officialSourceUrl} from '../../../lib/regulatory-sources.mjs';
import {recommendSourcePortfolio} from '../../../lib/regulatory/portfolio-recommendations.mjs';
import type {getSetupWorkspace} from '../../../lib/server/setup-service';
import EmailSignIn from '../../components/email-sign-in';
import shell from '../../workbench/workbench.module.css';
import ui from './setup.module.css';

type Data=Awaited<ReturnType<typeof getSetupWorkspace>>;
const activities=[['personal-data','Handling personal data'],['employing-staff','Employing people'],['premises','Operating premises'],['medicines','Medicines'],['controlled-drugs','Controlled drugs'],['food-business','Food business'],['consumer-sales','Selling to consumers'],['vat-registered','VAT registered'],['limited-company','Limited company'],['commercial-waste','Commercial waste'],['supply-chain','Supply chain'],['sponsored-workers','Sponsoring workers']];
const nations=['England','Scotland','Wales','Northern Ireland'];
export default function Setup(){
 const workspace=useWorkspaceContext();
 const {organisations:orgs,organizationId:orgId,signedIn,request,chooseOrganization,refreshContext,capture:scopeCapture}=workspace;
 const dataRevision=useRef(-1);
 const [company,setCompany]=useState(''),[creating,setCreating]=useState(false),[creationUncertain,setCreationUncertain]=useState(false);
 const [storedData,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const data=dataRevision.current===workspace.revision?storedData:null;
 const [chosenActivities,setActivities]=useState<string[]>([]),[jurisdictions,setJurisdictions]=useState<string[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [hours,setHours]=useState(24),[ack,setAck]=useState(false),[query,setQuery]=useState(''),[sourceLimit,setSourceLimit]=useState(8),[captures,setCaptures]=useState<{id:string;message:string}[]>([]);
 const epoch=useRef(0),active=useRef(''),inFlight=useRef(false),mounted=useRef(false);active.current=orgId;
 const scopedRequest=useCallback(async(path:string,options:RequestInit={},generation?:number)=>{
  if((generation!==undefined&&generation!==epoch.current)||!mounted.current)throw new Error('Workspace changed. Reload before continuing.');
  return request(path,options);
 },[request]);
 const refresh=useCallback(async(id:string,generation:number,reset=false,signal?:AbortSignal)=>{
  const value:Data=await scopedRequest('/api/workspace/setup?organizationId='+encodeURIComponent(id),{signal},generation);
  if(generation!==epoch.current||active.current!==id)return;
  dataRevision.current=workspace.revision;setData(value);
  if(reset){setActivities(value.profile?.activities||[]);setJurisdictions(value.profile?.jurisdictions||[]);setSelected(value.watches.filter(w=>w.enabled&&value.catalogue.some(s=>s.id===w.sourceId)).slice(0,30).map(w=>w.sourceId));setAck(false);}
 },[scopedRequest,workspace.revision]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 useEffect(()=>{
  const generation=++epoch.current,controller=new AbortController();setData(null);setCaptures([]);setSelected([]);setSourceLimit(8);setAck(false);setNotice('');setCreationUncertain(false);setBusy(false);setCreating(false);
  if(orgId){setLoading(true);void refresh(orgId,generation,true,controller.signal).catch(e=>{if(generation===epoch.current)setNotice(e.message);}).finally(()=>{if(generation===epoch.current)setLoading(false);});}
  else setLoading(false);
  return()=>{epoch.current++;controller.abort();};
 },[orgId,workspace.revision,refresh]);
 const href=(path:string,values:Record<string,string>={})=>workspaceHref(path,orgId,values);
 async function createWorkspace(event:React.FormEvent){
  event.preventDefault();if(creating||creationUncertain||!signedIn||orgs.length)return;
  const current=scopeCapture();setCreating(true);setNotice('');
  try{
   const saved=await request('/api/ai/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company:company.trim()})});
   if(!current())return;
   if(!saved.organisation?.id)throw new Error('Workspace creation could not be confirmed.');
   await refreshContext(saved.organisation.id);
  }catch(error){if(current()){setCreationUncertain(true);setNotice((error instanceof Error?error.message:'Workspace creation could not be confirmed.')+' Check saved workspaces before trying again.');}}
  finally{if(current())setCreating(false);}
 }
 const admin=!!data&&['OWNER','ADMIN'].includes(data.role);
 const recommendations=useMemo(()=>recommendSourcePortfolio(data?.catalogue||[],{activities:chosenActivities,jurisdictions}),[data,chosenActivities,jurisdictions]);
 const reasons=new Map(recommendations.suggested.map(s=>[s.id,s.reason]));
 const visible=(data?.catalogue||[]).filter(s=>(s.title+' '+s.agency).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(reasons.has(b.id))-Number(reasons.has(a.id))||a.title.localeCompare(b.title));
 function toggle(values:string[],id:string,checked:boolean){return checked?[...values,id]:values.filter(v=>v!==id);}
 async function reload(){
  const generation=epoch.current;setLoading(true);
  try{await refresh(orgId,generation,true);}catch(e){if(generation===epoch.current)setNotice(e instanceof Error?e.message:'Could not refresh setup.');}
  finally{if(generation===epoch.current)setLoading(false);}
 }
 async function save(){
  if(!data||!admin||inFlight.current)return;
  inFlight.current=true;setBusy(true);setNotice('');const id=orgId,generation=epoch.current;
  try{
   const result=await scopedRequest('/api/workspace/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id,profileVersion:data.profile?.version||0,activities:chosenActivities,jurisdictions,sources:selected.map(sourceId=>({sourceId,version:data.watches.find(w=>w.sourceId===sourceId)?.version||0})),intervalHours:hours,reviewAcknowledged:ack})},generation);
   if(generation!==epoch.current)return;setAck(false);
   setNotice(`Setup saved. ${result.created} new schedules, ${result.updated} updated, ${result.unchanged} already matched. ${data.features.monitoring?'Monitoring is enabled; inspect the recorded checks below.':'Background monitoring awaits activation. You can capture up to five selected sources now.'}`);
   try{await refresh(id,generation);}catch{if(generation===epoch.current)setNotice('Setup saved, but the updated status could not be loaded. Refresh before making another change.');}
  }catch(e){if(generation===epoch.current)setNotice(e instanceof Error?e.message:'Setup could not be saved.');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 async function capture(){
  if(!admin||inFlight.current||!selected.length||selected.length>5)return;
  inFlight.current=true;setBusy(true);setCaptures([]);setNotice('Capturing selected official sources. Each result will appear below.');const generation=epoch.current,id=orgId;
  const results:{id:string;message:string}[]=[];
  try{
   for(const sourceId of selected){
    if(generation!==epoch.current)break;
    try{await scopedRequest('/api/workspace/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id,sourceId})},generation);results.push({id:sourceId,message:'Captured or checked successfully. Review the stored source and its relevance.'});}
    catch(e){results.push({id:sourceId,message:e instanceof Error?e.message:'Capture failed. Try again from the source inbox.'});}
    if(generation===epoch.current)setCaptures([...results]);
   }
   if(generation===epoch.current){setNotice('Capture requests finished. Review each result below; failed requests have not been retried.');await refresh(id,generation);}
  }catch{if(generation===epoch.current)setNotice('Capture requests finished, but status could not be refreshed. Open the regulatory inbox to inspect stored results.');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const enabled=data?.watches.filter(w=>w.enabled).length||0;
 const checked=data?.coverage.filter(c=>c.snapshotId).length||0;
 const reviewed=data?.coverage.filter(c=>c.reviewStatus==='REVIEWED').length||0;
 return <div className={shell.app}>
  <WorkspaceNav/>
  <main className={shell.main}><div className={shell.topbar}><span className={shell.crumb}>Workspace / Setup</span><span className={shell.demo}>PRIVATE PILOT</span></div>
   <header className={ui.hero}><span className={ui.eyebrow}>FROM SETUP TO DAILY WORK</span><h1>Make your workspace work.</h1><p>Describe your business, choose the publications to watch, then connect the people and evidence behind your programme.</p></header>
   {(notice||workspace.error)&&<p role="status" className={ui.notice}>{notice||workspace.error}</p>}{(loading||workspace.loading)&&<p role="status">Loading workspace setup…</p>}
   {!orgId&&!loading&&!workspace.loading&&<section className={ui.card}>
    <h2>{signedIn?(orgs.length?'Choose your organisation':'Create your organisation'):'Open your private workspace'}</h2>
    {!signedIn?<EmailSignIn destination="/team/setup"/>:!orgs.length?<><p>Create a workspace for your business, then choose the activities and publications you want to review.</p><form className={ui.toolbar} onSubmit={createWorkspace}><label>Company name<input required minLength={3} maxLength={100} autoComplete="organization" value={company} onChange={e=>setCompany(e.target.value)} disabled={creating||creationUncertain}/></label><button type="submit" disabled={creating||creationUncertain||company.trim().length<3}>{creating?'Creating workspace…':'Create workspace'}</button></form>{creationUncertain&&<button type="button" onClick={()=>void refreshContext().then(ok=>{if(ok){setCreationUncertain(false);setNotice('Saved workspaces checked.');}else setNotice('Saved workspaces could not be checked. Refresh again before creating a workspace.');})}>Check saved workspaces</button>}</>:<p>Select an available organisation below. The organisation from this link has not been loaded.</p>}
    <p>Use fictional or non-sensitive records during the pilot.</p>
   </section>}
   {orgs.length>0&&<div className={ui.toolbar}><label>Organisation<select aria-label="Organisation" disabled={busy} value={orgId} onChange={e=>{epoch.current++;active.current=e.target.value;chooseOrganization(e.target.value);}}>{!orgId&&<option value="" disabled>Choose an organisation</option>}{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{orgId&&<><button disabled={busy||loading} onClick={()=>void reload()}>Reload saved setup</button><a href={href('/team/operations')}>Back to Today →</a></>}</div>}
   {data&&<>
    <section className={ui.card}><h2>Workspace accounts</h2>
     {data.accountShortcuts?.length>0&&<ul>{regulatorServices.filter(s=>data.accountShortcuts.includes(s.id)).map(s=><li key={s.id}><OfficialLink href={s.href}>{s.action}</OfficialLink> · {s.territory}</li>)}
       {accountingIds.filter(id=>data.accountShortcuts.includes(id)).map(id=><li key={id}><OfficialLink href={accountingSoftware[id].login}>Open {accountingSoftware[id].name}</OfficialLink></li>)}</ul>}
     <div className={ui.toolbar}><a href={href('/regulator-accounts')}>Open regulator accounts and workspace shortcuts</a><a href={href('/team/accounting')}>Manage accounting software</a></div></section>
    <section className={ui.card} aria-label="Recorded workspace progress"><h2>Configured and checked</h2><p>These are recorded activities, not a compliance score. Status was loaded at {new Date(data.generatedAt).toLocaleTimeString('en-GB')}.</p><div className={ui.stats}><article><span>Schedules enabled</span><strong>{enabled}</strong><small>{data.features.monitoring?'Background monitoring enabled':'Background monitoring awaiting activation'}</small></article><article><span>Sources captured</span><strong>{checked}</strong><small>{reviewed} latest versions reviewed</small></article><article><span>Approved clean files</span><strong>{data.evidence.approved}</strong><small>of {data.evidence.total} stored files</small></article><article><span>Current connections</span><strong>{data.connections.observed}</strong><small>of {data.connections.total} displayed connections have current successful observations</small></article></div>{data.connections.listLimitReached&&<p>Connection status is limited to the latest 20 connections.</p>}</section>
    {!admin&&<p className={ui.notice}>You can inspect setup. An owner or administrator must save changes and run captures here.</p>}
    <section className={ui.card}><span className={ui.eyebrow}>01 / YOUR BUSINESS</span><h2>What does your organisation do?</h2><p>These choices suggest research starting points. Confirm the relevant duties, territorial scope and exemptions in the original publications.</p>
     <fieldset disabled={!admin||busy}><legend>Business activities</legend><div className={ui.grid}>{activities.map(([id,label])=><label className={ui.check} key={id}><input type="checkbox" checked={chosenActivities.includes(id)} onChange={e=>{setActivities(toggle(chosenActivities,id,e.target.checked));setAck(false);}}/>{label}</label>)}</div></fieldset>
     <fieldset disabled={!admin||busy}><legend>UK nations where you operate</legend><div className={ui.grid}>{nations.map(n=><label className={ui.check} key={n}><input type="checkbox" checked={jurisdictions.includes(n)} onChange={e=>{setJurisdictions(toggle(jurisdictions,n,e.target.checked));setAck(false);}}/>{n}</label>)}</div></fieldset>
    </section>
    <section className={ui.card}><span className={ui.eyebrow}>02 / YOUR SOURCE PORTFOLIO</span><h2>Choose what to monitor</h2><p>{recommendations.caveat}</p><div className={ui.toolbar}><button disabled={!admin||busy||!recommendations.suggested.length} onClick={()=>{setSelected(recommendations.suggested.slice(0,30).map(s=>s.id));setAck(false);}}>Select suggested sources ({Math.min(30,recommendations.suggested.length)})</button><button disabled={!admin||busy||!selected.length} onClick={()=>{setSelected([]);setAck(false);}}>Clear selection</button><label>Search publications<input value={query} onChange={e=>{setQuery(e.target.value);setSourceLimit(8);}} placeholder="Publisher or title"/></label></div>
     <p>{selected.length} selected · maximum 30 per save. {recommendations.uncategorised.length} publications have no activity tags and need manual consideration. <a href={href('/team/library')}>Discover more official publications →</a></p>
     <div className={ui.sources} role="region" aria-label="Publication choices">{visible.slice(0,sourceLimit).map(source=>{const coverage=data.coverage.find(c=>c.sourceId===source.id);return <article className={ui.source} key={source.id}><label><input type="checkbox" disabled={!admin||busy||(!selected.includes(source.id)&&selected.length>=30)} checked={selected.includes(source.id)} onChange={e=>{setSelected(toggle(selected,source.id,e.target.checked));setAck(false);}}/><span>{source.title}</span></label><small>{source.agency} · {reasons.get(source.id)||'No matching discovery tags. Review applicability yourself.'}</small><small>{coverage?.snapshotId?`Latest capture: ${coverage.reviewStatus==='REVIEWED'?'reviewed':'awaiting review'}`:'No captured baseline'} · {coverage?.schedule?.enabled&&!data.features.monitoring?'Schedule saved; awaiting activation':coverage?.monitoring||'Not scheduled'}</small><a href={officialSourceUrl(source)} target="_blank" rel="noreferrer">Read original publication ↗</a> · <a href={href('/team/sources',{sourceId:source.id})}>Open captures and review →</a></article>;})}</div>{!visible.length&&<p>No publication matches this search.</p>}{visible.length>0&&<p>Showing {Math.min(sourceLimit,visible.length)} of {visible.length} matching publications.</p>}{sourceLimit<visible.length&&<button onClick={()=>setSourceLimit(n=>n+8)}>Show more publications</button>}
     <div className={ui.toolbar}><label>Selected monitoring interval<select disabled={!admin||busy} value={hours} onChange={e=>{setHours(Number(e.target.value));setAck(false);}}><option value={24}>Daily</option><option value={168}>Weekly</option></select></label></div>
     <div className={ui.summary}>Save {chosenActivities.length} activities and {jurisdictions.length} nations; enable {selected.length} selected schedules at a {hours===24?'daily':'weekly'} interval. Existing schedules outside this selection keep their settings. Saving does not activate providers or paid services.{selected.length>0&&<details><summary>Review the {selected.length} selected publications</summary><ul>{selected.map(id=><li key={id}>{data.catalogue.find(s=>s.id===id)?.title||id}</li>)}</ul></details>}</div>
     <label className={ui.check}><input type="checkbox" disabled={!admin||busy} checked={ack} onChange={e=>setAck(e.target.checked)}/>I have reviewed this profile and source selection. Suggestions do not establish which legal duties apply.</label><div className={ui.toolbar} style={{marginTop:16}}><button disabled={!admin||busy||!ack||!chosenActivities.length||!jurisdictions.length||!selected.length} onClick={()=>void save()}>{busy?'Working…':'Save profile and schedules'}</button></div>
    </section>
    <section className={ui.card}><span className={ui.eyebrow}>03 / FIRST OBSERVATIONS</span><h2>Capture, then review</h2><p>Select one to five publications above to retrieve their current official text. Each source is checked separately. Existing reviewed versions remain in history; changed text needs a fresh review.</p><button disabled={!admin||busy||!selected.length||selected.length>5} onClick={()=>void capture()}>Capture selected sources ({selected.length}/5)</button>{selected.length>5&&<p>Narrow your selection to five or fewer for a manual capture batch. This does not remove saved schedules.</p>}{captures.length>0&&<ul aria-label="Capture results" aria-live="polite">{captures.map(c=><li key={c.id}><strong>{data.catalogue.find(s=>s.id===c.id)?.title||c.id}:</strong> {c.message} <a href={href('/team/sources',{sourceId:c.id})}>Inspect source →</a></li>)}</ul>}<p><a href={href('/team/intelligence')}>Review captures and turn accepted changes into owned work →</a></p></section>
    <section className={ui.card}><span className={ui.eyebrow}>04 / CONNECT YOUR PROGRAMME</span><h2>Your next steps</h2><div className={ui.steps}>
     <article><span className={ui.status}>{data.independentReviewers>=2?'Two or more eligible reviewers':'Another reviewer needed'}</span><h3>Share responsibility</h3><p>{data.independentReviewers} pilot-allowed owners or administrators. Reviews need a different person from the submitter.</p><a href={href('/team/settings')}>Manage team access →</a></article>
     <article><span className={ui.status}>{data.features.evidence?'Storage configured':'Storage awaiting activation'}</span><h3>Add your policies and evidence</h3><p>File protection must be configured before uploads. Configuration alone does not verify storage or scanning.</p><a href={href('/team/evidence')}>Open evidence vault →</a></article>
     <article><span className={ui.status}>{data.controls} active controls</span><h3>Turn policies into owned work</h3><p>Choose and adapt a starter plan, or import your documents and review proposed controls.</p><a href={href('/team/programmes')}>Start with a ready-made plan →</a><a href={href('/team/operations?view=programme')}>Import your existing programme →</a></article>
     <article><span className={ui.status}>{data.connections.needsAttention} connections need attention</span><h3>Collect evidence from your tools</h3><p>{data.features.providers.filter(p=>p.configured).length} providers configured. Connect an account and inspect a real collection before relying on its observations.</p><a href={href('/team/operations?view=connections')}>Connect and verify →</a></article>
    </div></section>
   </>}
  </main>
 </div>;
}
