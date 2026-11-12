"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {browserAuth} from '../../../lib/client/supabase-auth';
import {officialSourceUrl} from '../../../lib/regulatory-sources.mjs';
import {recommendSourcePortfolio} from '../../../lib/regulatory/portfolio-recommendations.mjs';
import type {getSetupWorkspace} from '../../../lib/server/setup-service';
import EmailSignIn from '../../components/email-sign-in';
import shell from '../../workbench/workbench.module.css';
import ui from './setup.module.css';

type Data=Awaited<ReturnType<typeof getSetupWorkspace>>;
type Org={id:string;name:string;role:string};
const activities=[['personal-data','Handling personal data'],['employing-staff','Employing people'],['premises','Operating premises'],['medicines','Medicines'],['controlled-drugs','Controlled drugs'],['food-business','Food business'],['consumer-sales','Selling to consumers'],['vat-registered','VAT registered'],['limited-company','Limited company'],['commercial-waste','Commercial waste'],['supply-chain','Supply chain'],['sponsored-workers','Sponsoring workers']];
const nations=['England','Scotland','Wales','Northern Ireland'];
export default function Setup(){
 const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState(''),[signedIn,setSignedIn]=useState(false);
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [chosenActivities,setActivities]=useState<string[]>([]),[jurisdictions,setJurisdictions]=useState<string[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [hours,setHours]=useState(24),[ack,setAck]=useState(false),[query,setQuery]=useState(''),[captures,setCaptures]=useState<{id:string;message:string}[]>([]);
 const epoch=useRef(0),active=useRef(''),inFlight=useRef(false),mounted=useRef(false);active.current=orgId;
 const request=useCallback(async(path:string,options:RequestInit={},generation?:number)=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if((generation!==undefined&&generation!==epoch.current)||!mounted.current)throw new Error('Workspace changed. Reload before continuing.');
  if(!token)throw new Error('Sign in to your private workspace first.');
  const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,authorization:'Bearer '+token}});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Workspace unavailable. Please try again.');return result;
 },[]);
 const refresh=useCallback(async(id:string,generation:number,reset=false,signal?:AbortSignal)=>{
  const value:Data=await request('/api/workspace/setup?organizationId='+encodeURIComponent(id),{signal},generation);
  if(generation!==epoch.current||active.current!==id)return;
  setData(value);
  if(reset){setActivities(value.profile?.activities||[]);setJurisdictions(value.profile?.jurisdictions||[]);setSelected(value.watches.filter(w=>w.enabled&&value.catalogue.some(s=>s.id===w.sourceId)).slice(0,30).map(w=>w.sourceId));setAck(false);}
 },[request]);
 useEffect(()=>{
  mounted.current=true;let alive=true,serial=0;const controller=new AbortController();let unsubscribe=()=>{};
  async function context(){const attempt=++serial;
   try{const body=await request('/api/ai/context',{signal:controller.signal});if(!alive||attempt!==serial)return;
    setSignedIn(!!body.email);setOrgs(body.organisations||[]);setOrgId(old=>(body.organisations||[]).some((o:Org)=>o.id===old)?old:body.organisations?.[0]?.id||'');setNotice('');
   }catch(e){if(alive&&attempt===serial){epoch.current++;active.current='';setOrgId('');setOrgs([]);setSignedIn(false);setData(null);setNotice(e instanceof Error?e.message:'Sign in to continue.');}}
   finally{if(alive&&attempt===serial)setLoading(false);}
  }
  try{const auth=browserAuth().auth.onAuthStateChange(event=>{
   if(event==='SIGNED_OUT'){serial++;epoch.current++;active.current='';setOrgId('');setOrgs([]);setData(null);setCaptures([]);setSignedIn(false);setLoading(false);}
   else window.setTimeout(()=>{if(alive)void context();},0);
  });unsubscribe=()=>auth.data.subscription.unsubscribe();void context();}catch{setNotice('Private sign-in awaits configuration in this environment.');setLoading(false);}
  return()=>{alive=false;mounted.current=false;epoch.current++;controller.abort();unsubscribe();};
 },[request]);
 useEffect(()=>{
  const generation=++epoch.current,controller=new AbortController();setData(null);setCaptures([]);setSelected([]);setAck(false);
  if(orgId){setLoading(true);void refresh(orgId,generation,true,controller.signal).catch(e=>{if(generation===epoch.current)setNotice(e.message);}).finally(()=>{if(generation===epoch.current)setLoading(false);});}
  return()=>{epoch.current++;controller.abort();};
 },[orgId,refresh]);
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
   const result=await request('/api/workspace/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id,profileVersion:data.profile?.version||0,activities:chosenActivities,jurisdictions,sources:selected.map(sourceId=>({sourceId,version:data.watches.find(w=>w.sourceId===sourceId)?.version||0})),intervalHours:hours,reviewAcknowledged:ack})},generation);
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
    try{await request('/api/workspace/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id,sourceId})},generation);results.push({id:sourceId,message:'Captured or checked successfully. Review the stored source and its relevance.'});}
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
  <aside className={shell.sidebar}><a href="/team/operations" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>YOUR COMPLIANCE, CONNECTED</small></span></a><div className={shell.sideCaption}>PRIVATE WORKSPACE</div><nav className={shell.sideNav}><a href="/team/setup" className={shell.active} aria-current="page">Workspace setup</a><a href="/team/operations">Operations</a><a href="/team/intelligence">Regulatory inbox</a><a href="/team/coverage">Monitoring health</a><a href="/team/evidence">Evidence vault</a><a href="/team/settings">Team &amp; access</a><a href="/team/services">Services &amp; spending</a></nav></aside>
  <main className={shell.main}><div className={shell.topbar}><span className={shell.crumb}>Workspace / Setup</span><span className={shell.demo}>PRIVATE PILOT</span></div>
   <header className={ui.hero}><span className={ui.eyebrow}>FROM SETUP TO DAILY WORK</span><h1>Make your workspace work.</h1><p>Describe your business, choose the publications to watch, then connect the people and evidence behind your programme.</p></header>
   {notice&&<p role="status" className={ui.notice}>{notice}</p>}{loading&&<p role="status">Loading workspace setup…</p>}
   {!orgId&&!loading&&<section className={ui.card}><h2>{signedIn?'Create your first organisation':'Open your private workspace'}</h2>{signedIn?<><p>You are signed in. Create an organisation to save its profile, monitoring and evidence separately.</p><a href="/team">Create organisation →</a></>:<EmailSignIn destination="/team/setup"/>}<p>Use fictional or non-sensitive records during the pilot.</p></section>}
   {orgId&&<div className={ui.toolbar}><label>Organisation<select disabled={busy} value={orgId} onChange={e=>{epoch.current++;active.current=e.target.value;setOrgId(e.target.value);}}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button disabled={busy||loading} onClick={()=>void reload()}>Reload saved setup</button></div>}
   {data&&<>
    <section className={ui.card} aria-label="Recorded workspace progress"><h2>Configured and checked</h2><p>These are recorded activities, not a compliance score. Status was loaded at {new Date(data.generatedAt).toLocaleTimeString('en-GB')}.</p><div className={ui.stats}><article><span>Schedules enabled</span><strong>{enabled}</strong><small>{data.features.monitoring?'Background monitoring enabled':'Background monitoring awaiting activation'}</small></article><article><span>Sources captured</span><strong>{checked}</strong><small>{reviewed} latest versions reviewed</small></article><article><span>Approved clean files</span><strong>{data.evidence.approved}</strong><small>of {data.evidence.total} stored files</small></article><article><span>Current connections</span><strong>{data.connections.observed}</strong><small>of {data.connections.total} displayed connections have current successful observations</small></article></div>{data.connections.listLimitReached&&<p>Connection status is limited to the latest 20 connections.</p>}</section>
    {!admin&&<p className={ui.notice}>You can inspect setup. An owner or administrator must save changes and run captures here.</p>}
    <section className={ui.card}><span className={ui.eyebrow}>01 / YOUR BUSINESS</span><h2>What does your organisation do?</h2><p>These choices suggest research starting points. Confirm the relevant duties, territorial scope and exemptions in the original publications.</p>
     <fieldset disabled={!admin||busy}><legend>Business activities</legend><div className={ui.grid}>{activities.map(([id,label])=><label className={ui.check} key={id}><input type="checkbox" checked={chosenActivities.includes(id)} onChange={e=>{setActivities(toggle(chosenActivities,id,e.target.checked));setAck(false);}}/>{label}</label>)}</div></fieldset>
     <fieldset disabled={!admin||busy}><legend>UK nations where you operate</legend><div className={ui.grid}>{nations.map(n=><label className={ui.check} key={n}><input type="checkbox" checked={jurisdictions.includes(n)} onChange={e=>{setJurisdictions(toggle(jurisdictions,n,e.target.checked));setAck(false);}}/>{n}</label>)}</div></fieldset>
    </section>
    <section className={ui.card}><span className={ui.eyebrow}>02 / YOUR SOURCE PORTFOLIO</span><h2>Choose what to monitor</h2><p>{recommendations.caveat}</p><div className={ui.toolbar}><button disabled={!admin||busy||!recommendations.suggested.length} onClick={()=>{setSelected(recommendations.suggested.slice(0,30).map(s=>s.id));setAck(false);}}>Select suggested sources ({Math.min(30,recommendations.suggested.length)})</button><button disabled={!admin||busy||!selected.length} onClick={()=>{setSelected([]);setAck(false);}}>Clear selection</button><label>Search publications<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Publisher or title"/></label></div>
     <p>{selected.length} selected · maximum 30 per save. {recommendations.uncategorised.length} publications have no activity tags and need manual consideration. <a href="/team/library">Discover more official publications →</a></p>
     <div className={ui.sources}>{visible.map(source=>{const coverage=data.coverage.find(c=>c.sourceId===source.id);return <article className={ui.source} key={source.id}><label><input type="checkbox" disabled={!admin||busy||(!selected.includes(source.id)&&selected.length>=30)} checked={selected.includes(source.id)} onChange={e=>{setSelected(toggle(selected,source.id,e.target.checked));setAck(false);}}/><span>{source.title}</span></label><small>{source.agency} · {reasons.get(source.id)||'No matching discovery tags. Review applicability yourself.'}</small><small>{coverage?.snapshotId?`Latest capture: ${coverage.reviewStatus==='REVIEWED'?'reviewed':'awaiting review'}`:'No captured baseline'} · {coverage?.schedule?.enabled&&!data.features.monitoring?'Schedule saved; awaiting activation':coverage?.monitoring||'Not scheduled'}</small><a href={officialSourceUrl(source)} target="_blank" rel="noreferrer">Read original publication ↗</a> · <a href={"/team/sources?sourceId="+encodeURIComponent(source.id)}>Open captures and review →</a></article>;})}</div>{!visible.length&&<p>No publication matches this search.</p>}
     <div className={ui.toolbar}><label>Selected monitoring interval<select disabled={!admin||busy} value={hours} onChange={e=>{setHours(Number(e.target.value));setAck(false);}}><option value={24}>Daily</option><option value={168}>Weekly</option></select></label></div>
     <div className={ui.summary}>Save {chosenActivities.length} activities and {jurisdictions.length} nations; enable {selected.length} selected schedules at a {hours===24?'daily':'weekly'} interval. Existing schedules outside this selection keep their settings. Saving does not activate providers or paid services.</div>
     <label className={ui.check}><input type="checkbox" disabled={!admin||busy} checked={ack} onChange={e=>setAck(e.target.checked)}/>I have reviewed this profile and source selection. Suggestions do not establish which legal duties apply.</label><div className={ui.toolbar} style={{marginTop:16}}><button disabled={!admin||busy||!ack||!chosenActivities.length||!jurisdictions.length||!selected.length} onClick={()=>void save()}>{busy?'Working…':'Save profile and schedules'}</button></div>
    </section>
    <section className={ui.card}><span className={ui.eyebrow}>03 / FIRST OBSERVATIONS</span><h2>Capture, then review</h2><p>Select one to five publications above to retrieve their current official text. Each source is checked separately. Existing reviewed versions remain in history; changed text needs a fresh review.</p><button disabled={!admin||busy||!selected.length||selected.length>5} onClick={()=>void capture()}>Capture selected sources ({selected.length}/5)</button>{selected.length>5&&<p>Narrow your selection to five or fewer for a manual capture batch. This does not remove saved schedules.</p>}{captures.length>0&&<ul aria-label="Capture results" aria-live="polite">{captures.map(c=><li key={c.id}><strong>{data.catalogue.find(s=>s.id===c.id)?.title||c.id}:</strong> {c.message} <a href={"/team/sources?sourceId="+encodeURIComponent(c.id)}>Inspect source →</a></li>)}</ul>}<p><a href="/team/intelligence">Review captures and turn accepted changes into owned work →</a></p></section>
    <section className={ui.card}><span className={ui.eyebrow}>04 / CONNECT YOUR PROGRAMME</span><h2>Your next steps</h2><div className={ui.steps}>
     <article><span className={ui.status}>{data.independentReviewers>=2?'Two or more eligible reviewers':'Another reviewer needed'}</span><h3>Share responsibility</h3><p>{data.independentReviewers} pilot-allowed owners or administrators. Reviews need a different person from the submitter.</p><a href="/team/settings">Manage team access →</a></article>
     <article><span className={ui.status}>{data.features.evidence?'Storage configured':'Storage awaiting activation'}</span><h3>Add your policies and evidence</h3><p>File protection must be configured before uploads. Configuration alone does not verify storage or scanning.</p><a href="/team/evidence">Open evidence vault →</a></article>
     <article><span className={ui.status}>{data.controls} active controls</span><h3>Turn policies into owned work</h3><p>Import documents, review proposed controls, then assign owners and recurring review dates.</p><a href="/team/operations?view=programme">Build your programme →</a></article>
     <article><span className={ui.status}>{data.connections.needsAttention} connections need attention</span><h3>Collect evidence from your tools</h3><p>{data.features.providers.filter(p=>p.configured).length} providers configured. Connect an account and inspect a real collection before relying on its observations.</p><a href="/team/operations?view=connections">Connect and verify →</a></article>
    </div></section>
   </>}
  </main>
 </div>;
}
