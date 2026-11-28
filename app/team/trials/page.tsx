'use client';
import {useEffect,useRef,useState} from 'react';
import {benchmarkProducts,benchmarkProductById} from '../../../lib/benchmark-products';
import ProductChoice from './product-choice';
import ReadingPicker,{ReadingControls,useTrialReadings} from './reading-picker';
import ReceiptHandoff from './receipt-handoff';
import {githubTrialTrack} from '../../../lib/pilot-receipt';
import SiteDecision from './site-decision';
import {protocolTemplate,type ProtocolTemplate} from '../../../lib/site-qualification';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {useWorkspaceContext} from '../../../lib/client/workspace-context';
import {isExcursionTrial,isTimedPilot,allTrialTracks as trialTracks,trialTracks as benchmarkTracks,trialEnvironments} from '../../../lib/capability-trials';
import type {trialWorkspace} from '../../../lib/server/capability-trial-service';
import shell from '../../workbench/workbench.module.css';
import ui from './trials.module.css';
import {LaunchTrials,TrialList,trialHref,trialStatus} from './trial-directory';

type Workspace=ReturnType<typeof useWorkspaceContext>;
type View=Awaited<ReturnType<typeof trialWorkspace>>;
type Trial=View['trials'][number];
const moduleFor=(id:string)=>Object.values(trialTracks).flatMap(t=>t.steps).find(s=>s.id===id)!;
const envText={FIXTURE:'Internal test',PARTNER_SANDBOX:'Authorised partner sandbox',PROTECTED_PILOT:'Protected customer pilot'};
export default function Page(){
 const w=useWorkspaceContext();
 return <div className={shell.app}><WorkspaceNav/><main className={ui.main}><div className={ui.body}>
 <header className={ui.intro}><div><h1>Capability trials</h1><p>Run a test, inspect the evidence and record an independent review.</p></div>
 {w.signedIn&&<label className={ui.workspace}>Workspace<select aria-label="Workspace" value={w.organizationId} onChange={e=>w.chooseOrganization(e.target.value)}>{w.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}</header>
 {w.loading?<p role="status">Loading workspace…</p>:!w.signedIn?<section className={ui.card}><h2>Sign in to your workspace</h2><EmailSignIn destination="/team/trials"/></section>:<>{w.error&&<p role="alert">{w.error}</p>}{w.organizationId&&<Trials key={w.revision} w={w}/>}</>}</div></main></div>;
}
function Trials({w}:{w:Workspace}){
 const [view,setView]=useState<View|null>(null),[track,choose]=useState('systems'),[busy,lock]=useState(false),[message,tell]=useState(''),[environment,setEnv]=useState<keyof typeof envText>('FIXTURE');
 const [initialRelease,setInitialRelease]=useState(''),[caseId,setCaseId]=useState('');
 const [siteSteps,setSiteSteps]=useState(['stock-count']);
 const [linkedId,setLinkedId]=useState('');
 const [screen,setScreen]=useState<'overview'|'history'|'new'|null>(null);
 const isGitHub=track===githubTrialTrack;
 const isSite=track==='site_qualification';
 const [template,setTemplate]=useState<ProtocolTemplate|null>(null),[templateVersion,newTemplate]=useState(0);
 async function importProtocol(file:File){
  const valid=w.capture();
  try{
   if(file.size>24000)throw new Error();
   const data=protocolTemplate.parse(JSON.parse(await file.text()));
   if(valid()){setTemplate(data);setSiteSteps(data.criteria.map(c=>c.step));newTemplate(n=>n+1);tell('Protocol loaded. Review the criteria and identify the site and configuration for this run.');}
  }catch{if(valid())tell('Choose a RegPilot protocol template with supported site tests and acceptance criteria.');}
 }
 useEffect(()=>{const p=new URLSearchParams(window.location.search),choice=p.get('participant');setScreen(choice||p.has('release')||p.get('screen')==='new'?'new':p.get('screen')==='history'?'history':'overview');if(choice==='site')choose('site_qualification');if(p.has('trialId'))setLinkedId(p.get('trialId')||'invalid');if(choice==='github'){choose(githubTrialTrack);setEnv('PROTECTED_PILOT');}if(choice==='operator'||choice==='assessor'){choose(choice+'_pilot');setEnv('PARTNER_SANDBOX');}if(choice&&isExcursionTrial(choice)){choose(choice);setEnv('FIXTURE');setCaseId(p.get('caseId')??'');}const commit=p.get('release');if(commit&&/^[a-f0-9]{40}$/.test(commit))setInitialRelease(commit);},[]);
 const [release,filter]=useState(''),[releaseInput,setReleaseInput]=useState('');
 const historyEpoch=useRef(0),inFlight=useRef(false);
 const path='/api/workspace/trials?'+new URLSearchParams({organizationId:w.organizationId,...(linkedId?{trialId:linkedId}:release?{release}:{})});
 async function older(){
  if(inFlight.current||!view?.nextCursor)return;
  const valid=w.capture(),epoch=historyEpoch.current;
  inFlight.current=true;lock(true);
  try{
   const page:View=await w.request(path+'&before='+encodeURIComponent(view.nextCursor));
   if(valid()&&epoch===historyEpoch.current)setView(previous=>previous&&({...page,trials:[...previous.trials,...page.trials]}));
  }catch(e){if(valid()&&epoch===historyEpoch.current)tell(e instanceof Error?e.message:'Could not load earlier trials.');}
  finally{inFlight.current=false;if(valid()&&epoch===historyEpoch.current)lock(false);}
 }

 useEffect(()=>{const valid=w.capture(),epoch=++historyEpoch.current;setView(null);void w.request(path).then(v=>{if(valid()&&epoch===historyEpoch.current)setView(v);}).catch(e=>{if(valid()&&epoch===historyEpoch.current)tell(e.message);});return ()=>{historyEpoch.current++;};},[w.capture,w.request,path]);
 async function save(d:Record<string,unknown>){const valid=w.capture();lock(true);tell('');try{const saved=await w.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!valid())return;
 if(d.action==='START'){
  const url=new URL(window.location.href);url.searchParams.set('trialId',saved.id);url.hash='trial-'+saved.id;
  window.history.replaceState(null,'',url);setLinkedId(saved.id);tell('Trial started.');return;
 }
 const v=await w.request(path);if(valid()){setView(v);tell('Saved.');}}catch(e){if(valid())tell(e instanceof Error?e.message:'Trial unavailable.');}finally{if(valid())lock(false);}}
 const back=<a className={ui.back} href={trialHref(w.organizationId)}>← Trial overview</a>;
 if(!screen)return <p role="status">Loading trials…</p>;
 if(linkedId)return <>{back}{message&&<p role="status">{message}</p>}{!view&&!message&&<p role="status">Loading trial…</p>}{view&&!view.trials.length&&<p>This trial is unavailable in the selected workspace.</p>}{view?.trials.filter(t=>t.id===linkedId).map(t=><Run key={t.id} w={w} t={t} view={view} busy={busy} save={save}/>)}</>;
 if(screen==='overview')return <><LaunchTrials org={w.organizationId}/>{view?<TrialList trials={view.trials} org={w.organizationId}/>:<p role="status">{message||'Loading recent trials…'}</p>}</>;
 if(screen==='history')return <>{back}{message&&<p role="status">{message}</p>}<details className={ui.card}><summary>Filter by exact release</summary><form onSubmit={e=>{e.preventDefault();filter(releaseInput.trim());}}>
 <label>Release commit<input value={releaseInput} onChange={e=>setReleaseInput(e.target.value)} pattern="[a-f0-9]{40}" placeholder="Full Git commit SHA"/></label>
 <button disabled={busy}>Apply release filter</button>{release&&<button type="button" disabled={busy} onClick={()=>{setReleaseInput('');filter('');}}>Clear release filter</button>}</form></details>
 {view?<><TrialList trials={view.trials} org={w.organizationId} history limited={view.limited}/>{view.limited&&<button disabled={busy} onClick={()=>void older()}>Load earlier trials</button>}{view.canManage&&<Coverage view={view}/>}</>:!message&&<p role="status">Loading trial history…</p>}</>;
 return <>{back}{view&&track==='operator_pilot'&&(!view.hasActiveControl||!view.canManage)&&<section className={ui.card}><h2>Before you start the timer</h2>{!view.hasActiveControl&&<p>A workspace administrator needs to assign an active test control for the connection. <a href={'/team/programmes?organizationId='+view.organizationId}>Open starter programmes</a></p>}{!view.canManage&&<p>Your current workspace role cannot configure a connection. Select the assigned pilot workspace or record this as a blocker in your trial.</p>}</section>}{message&&<p role="status">{message}</p>}<form className={ui.card} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'START',requestKey:crypto.randomUUID(),track,environment:isGitHub?'PROTECTED_PILOT':environment,...(isGitHub?{receiptWindow:f.get('receiptWindow')}:{}),...(track==='operator_pilot'?{operatorProduct:f.get('operatorProduct')}:{}),release:f.get('release'),intendedUse:f.get('use'),steps:f.getAll('steps'),...(isSite?{siteProtocol:{
 operator:f.get('operator'),site:f.get('site'),licence:f.get('licence'),configuration:f.get('configuration'),
 criteria:f.getAll('steps').map(step=>({step,expected:f.get('expected-'+step)}))}}:{}),...(isExcursionTrial(track)?{caseId}:{}),...(track==='operator_pilot'||track==='excursion_operator'?{firstTime:f.get('firstTime')==='on'}:{}),ukExternal:environment!=='FIXTURE'&&f.get('external')==='on'});}}><fieldset disabled={busy}><legend>Configure trial</legend><label>Trial track<select aria-label="Trial track" value={track} onChange={e=>{choose(e.target.value);if(e.target.value===githubTrialTrack)setEnv('PROTECTED_PILOT');}}>{Object.entries(trialTracks).map(([id,t])=><option key={id} value={id}>{t.title}</option>)}</select></label><label>Release commit<input key={isSite||isGitHub?track+view?.deployedRelease:initialRelease||view?.deployedRelease} name="release" defaultValue={isSite||isGitHub?view?.deployedRelease??'':initialRelease||view?.deployedRelease||''} readOnly={isSite||isGitHub} pattern="[a-f0-9]{40}" required maxLength={40} placeholder="Full Git commit SHA"/></label>
 {track==='operator_pilot'&&<ProductChoice/>}
 {isGitHub&&<label>GitHub inventory receipt<select name="receiptWindow"><option value="previous_day">Latest successful read yesterday (UTC)</option><option value="today">Latest successful read today (UTC)</option></select></label>}
 {isSite&&<fieldset><legend>Site protocol</legend>
 <label>Reuse a test protocol<input type="file" accept=".json,application/json" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void importProtocol(file);}}/></label>
 <label>Licensed operator or company<input name="operator" minLength={3} maxLength={240} required/></label>
 <label>Site name and address<input name="site" minLength={3} maxLength={240} required/></label>
 <label>Applicable licence reference<input name="licence" minLength={3} maxLength={240} required/></label>
 <label>Configuration or controlled document revision<input name="configuration" minLength={3} maxLength={240} required/></label>
 {!view?.deployedRelease&&<p role="status">Site protocols require a deployment with an identified Git commit.</p>}
 </fieldset>}{isExcursionTrial(track)&&<label>Assigned quality case ID<input value={caseId} required onChange={e=>setCaseId(e.target.value.trim())}/></label>}<label>Intended use and test scope<input key={isSite?'site-use-'+templateVersion:track} name="use" defaultValue={isGitHub?'Review the GitHub inventory receipt and explain its settings and connection health.':isSite?template?.intendedUse??'':isExcursionTrial(track)?'Timed temperature excursion in a fictional workspace.':track==='operator_pilot'?'First-time setup, failed-check review and exact reading export in staging.':track==='assessor_pilot'?'Independent review of isolated access, recovery and excursion evidence in staging.':''} required minLength={15} maxLength={360}/></label><label>Environment<select aria-label="Environment" disabled={isGitHub} value={environment} onChange={e=>setEnv(e.target.value as keyof typeof envText)}>{trialEnvironments.map(e=><option key={e} value={e}>{envText[e]}</option>)}</select></label>{environment!=='FIXTURE'&&<label><input name="external" type="checkbox"/> I am an independent UK operator participating in an authorised trial.</label>} {(track==='operator_pilot'||track==='excursion_operator')&&<label><input name="firstTime" type="checkbox" required/>This is my first attempt at the operator pilot.</label>}<div className={ui.tasks} key={track}><h3>Tasks to observe</h3>{trialTracks[track].steps.map(s=>isSite?<div key={s.id}>
 <label><input name="steps" type="checkbox" value={s.id} checked={siteSteps.includes(s.id)} onChange={e=>{const checked=e.currentTarget.checked;setSiteSteps(old=>checked?[...old,s.id]:old.filter(id=>id!==s.id));}}/> {s.title}</label>
 {siteSteps.includes(s.id)&&<label>Acceptance criterion for this test<textarea key={templateVersion} defaultValue={template?.criteria.find(c=>c.step===s.id)?.expected??''} name={'expected-'+s.id} required minLength={15} maxLength={500}/></label>}
 </div>:<label key={s.id}><input type="checkbox" name="steps" value={s.id} defaultChecked/> {s.title}</label>)}</div><button className={ui.primary} disabled={!view||isSite&&(!view.deployedRelease||!siteSteps.length)}>Start timer</button></fieldset></form>
 </>;
}
function ComparatorOptions(){
 return <>{[...new Set(benchmarkProducts.map(p=>p.category))].map(category=><optgroup key={category} label={category}>
  {benchmarkProducts.filter(p=>p.category===category).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
 </optgroup>)}</>;
}
function Run({t,view,busy,save,w}:{w:Workspace;t:Trial;view:View;busy:boolean;save:(d:Record<string,unknown>)=>Promise<void>}){
 const readings=useTrialReadings(w,t.id,t.track==='operator_pilot'&&t.canFinish&&view.canManage&&!!t.stoppedAt);
 const [outcomes,choose]=useState<Record<string,string>>({});
 const [compare,setCompare]=useState(false);
 return <article id={'trial-'+t.id} className={ui.card}><header className={ui.runHeader}><h2>{trialTracks[t.track].title}</h2><span className={ui.status} data-state={trialStatus(t)}>{trialStatus(t)}</span></header><p>{envText[t.environment]} · {t.release.slice(0,10)} · {new Date(t.startedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p><p>{t.intendedUse}</p>
 {t.receipt&&<ReceiptHandoff receipt={t.receipt} organizationId={view.organizationId} trialId={t.id}/>}
 {t.siteProtocol&&<section><h3>Site protocol</h3><p>{t.siteProtocol.operator} · {t.siteProtocol.site} · {t.siteProtocol.licence}</p>
 <p>Configuration {t.siteProtocol.configuration}</p>
 <ul>{t.siteProtocol.criteria.map(c=><li key={c.step}><strong>{moduleFor(c.step).title}</strong> {c.expected}</li>)}</ul>
 <button type="button" onClick={()=>{
  const contents=protocolTemplate.parse({format:'regpilot-site-protocol-v1',intendedUse:t.intendedUse,criteria:t.siteProtocol!.criteria});
  const url=URL.createObjectURL(new Blob([JSON.stringify(contents,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='regpilot-site-protocol.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }}>Download reusable test protocol</button>
 <p>The template contains the intended use and test criteria. Review their wording before sharing.</p>
 <a href={'/team/quality?'+new URLSearchParams({organizationId:view.organizationId})} target="_blank" rel="noopener noreferrer">Open quality cases</a>
 {view.canManage&&<SiteDecision key={t.id+'-'+t.reviewCount+'-'+t.elapsedSeconds} w={w} id={t.id} files={view.evidence} participant={w.userId===t.participantId}/>}
 </section>}
 {t.caseId&&<p><a target="_blank" rel="noopener noreferrer" href={'/team/quality?'+new URLSearchParams({organizationId:view.organizationId,caseId:t.caseId})}>Open assigned excursion case</a> · Record each request for help and each correction while the timer runs.</p>}
 {t.track==='operator_pilot'&&<p><a target="_blank" rel="noopener noreferrer" href={t.operatorProduct&&t.operatorProduct!=='DAILYMED_LABEL'?'/team/developers?'+new URLSearchParams({organizationId:view.organizationId,monitorProduct:t.operatorProduct})+'#product-monitors':'/team/operations?'+new URLSearchParams({view:'connections',register:'DAILYMED_LABEL',organizationId:view.organizationId})}>Set up {t.operatorProduct&&t.operatorProduct!=='DAILYMED_LABEL'?t.operatorProduct:'the DailyMed test label'}</a> · <a target="_blank" rel="noopener noreferrer" href={'/team/work?'+new URLSearchParams({view:'sources',organizationId:view.organizationId})}>Open source follow-ups</a></p>}
 {t.track==='assessor_pilot'&&<p><a target="_blank" rel="noopener noreferrer" href={'/team/developers?organizationId='+view.organizationId+'#source-verification'}>Inspect monitoring evidence</a> · <a target="_blank" rel="noopener noreferrer" href={'/team/quality?organizationId='+view.organizationId}>Open quality cases</a></p>}
 {t.canFinish&&!t.stoppedAt&&isTimedPilot(t.track)&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'CHECKPOINT',id:t.id,key:crypto.randomUUID(),step:f.get('step'),kind:f.get('kind'),note:f.get('note')});}}><fieldset disabled={busy}><legend>Record what happened while the timer is running</legend>
 <label>Task<select name="step">{t.steps.map(s=><option key={s} value={s}>{moduleFor(s).title}</option>)}</select></label><label>Event<select name="kind"><option value="HELP">I needed help</option><option value="CORRECTION">I corrected an error</option><option value="COMPLETED">Task completed</option><option value="BLOCKED">Task blocked</option></select></label><label>What happened or what help was needed?<input name="note" minLength={3} maxLength={400} required/></label><button>Save timed event</button></fieldset></form>}
 {!!t.checkpoints.length&&<ol>{t.checkpoints.map(p=><li key={p.id}>{p.elapsedSeconds}s · {moduleFor(p.step).title} · {p.kind} · {p.note}</li>)}</ol>}
 {t.canFinish&&!t.stoppedAt&&<button disabled={busy} onClick={()=>void save({action:'STOP',id:t.id})}>Task complete · stop timer</button>}
 {t.canFinish&&t.stoppedAt&&<p>Timer stopped at {new Date(t.stoppedAt).toLocaleTimeString('en-GB')}. Enter the observed results below.</p>}
 {t.canFinish&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'FINISH',id:t.id,...(compare?{comparison:{...(f.get('productId')?{productId:f.get('productId')}:{}),method:f.get('method'),elapsedSeconds:Number(f.get('seconds')),edits:Number(f.get('baselineEdits')),evidenceId:f.get('baselineEvidence'),sameTasks:true}}:{}),results:t.steps.map(step=>({step,outcome:outcomes[step]||'UNOBSERVED',notes:f.get(step+'-notes'),evidenceId:f.get(step+'-file')||null,...(!f.get(step+'-file')&&f.get(step+'-run')?{runId:f.get(step+'-run')}:{}),unsupported:Number(f.get(step+'-claims')),edits:Number(f.get(step+'-edits')),assisted:f.get(step+'-assist')==='on'}))});}}><fieldset disabled={busy}><legend>Record observed results</legend>{t.track==='operator_pilot'&&view.canManage&&<ReadingControls readings={readings}/>} {t.steps.map(step=><section key={step}><h3>{moduleFor(step).title}</h3><label>Result<select value={outcomes[step]||'UNOBSERVED'} onChange={e=>choose({...outcomes,[step]:e.target.value})}><option>UNOBSERVED</option><option>PASS</option><option>FAIL</option></select></label><label>Observed result and source references<textarea name={step+'-notes'} required minLength={10} maxLength={600}/></label>{t.track==='operator_pilot'&&view.canManage&&<ReadingPicker page={readings.page} step={step}/>}{!t.receipt&&<label>Reviewed evidence<select name={step+'-file'} required={outcomes[step]==='PASS'&&t.track!=='operator_pilot'&&!t.receipt&&!t.caseId}><option value="">Choose a file</option>{view.evidence.map(e=><option key={e.id} value={e.id}>{e.filename}</option>)}</select></label>}<label>Unsupported claims<input name={step+'-claims'} type="number" min="0" max="1000" defaultValue="0"/></label><label>Corrections or reviewer edits<input name={step+'-edits'} type="number" min="0" max="1000" defaultValue="0"/></label><label><input type="checkbox" name={step+'-assist'}/> Human assistance was needed</label></section>)}<label><input type="checkbox" disabled={!t.stoppedAt} checked={compare} onChange={e=>setCompare(e.target.checked)}/> Compare the same tasks with the participant’s existing process</label>
 {compare&&<fieldset><legend>Existing process measurement</legend>
  <label>Product or service tested<select name="productId" aria-label="Product or service tested"><option value="">Existing process or other tool</option><ComparatorOptions/></select></label>
  <label>Tested process, edition or configuration<input name="method" minLength={3} maxLength={120} required/></label>
  <label>Elapsed seconds<input name="seconds" type="number" min={1} max={2592000} required/></label>
  <label>Corrections across the selected tasks<input name="baselineEdits" type="number" min={0} max={6000} required/></label>
  <label>Reviewed timing and correction record<select name="baselineEvidence" required><option value="">Choose a file</option>{view.evidence.map(e=><option key={e.id} value={e.id}>{e.filename}</option>)}</select></label>
  <label><input type="checkbox" required/> I checked that the record covers the same tasks and scope.</label>
 </fieldset>}<button>{t.stoppedAt?'Save observed results':'Finish run and stop timer'}</button></fieldset></form>}
 {!!t.caseReceipts.length&&<ul>{t.caseReceipts.map(r=><li key={r.id}>{moduleFor(r.step).title} · {r.at} · Case receipt {r.id}</li>)}</ul>}
 {t.elapsedSeconds!==null&&<><p>{t.elapsedSeconds} seconds · {t.reviewCount} of {t.required} independent decisions · {t.current?'Evidence current':'Evidence needs review'}</p>{t.results.map(r=><p key={r.step}><strong>{r.outcome} · {moduleFor(r.step).id}</strong> {r.notes} · {r.unsupported} unsupported claims · {r.edits} edits · {r.assisted?'assisted':'unaided'} {r.runId&&<a href={'/team/trials?'+new URLSearchParams({organizationId:view.organizationId,trialId:t.id})+'#reading-'+r.runId}>Review attached collection</a>} {r.evidenceId&&<a href={'/team/evidence?'+new URLSearchParams({organizationId:view.organizationId,evidenceId:r.evidenceId})}>Review exact supporting file</a>}</p>)}{t.reviewDecisions.length>0&&<p>Recorded decisions {t.reviewDecisions.join(', ')}</p>}</>}
 {t.readingDetails.map(r=><section id={'reading-'+r.id} key={r.id}><h3>Verified collection</h3><p>{r.id} · {t.readings.find(x=>x.id===r.id)?.collectedAt}</p><ul>{r.checks.map((c,i)=><li key={i}>{c.label} · {c.status}</li>)}</ul></section>)}
 {t.comparison&&t.elapsedSeconds!==null&&<section><h3>Same-task comparison</h3>{t.comparison.productId&&<p>{benchmarkProductById.get(t.comparison.productId)?.name}</p>}
  <p>{t.comparison.method} took {t.comparison.elapsedSeconds} seconds and required {t.comparison.edits} corrections. RegPilot took {t.elapsedSeconds} seconds and required {t.results.reduce((n,r)=>n+r.edits,0)} corrections.</p>
  <p>{t.accepted?'Independently accepted':t.current?(t.reviewCount>=t.required?'Review rejected':'Awaiting independent review'):'Evidence needs review'} · <a href={'/team/evidence?'+new URLSearchParams({organizationId:view.organizationId,evidenceId:t.comparison.evidenceId})}>Open original timing record</a></p>
 </section>}
 {t.canReview&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'REVIEW',id:t.id,decision:f.get('decision'),notes:f.get('notes')});}}><fieldset disabled={busy}><legend>Independent review</legend><label>Decision<select name="decision"><option value="ACCEPT">Accept this account of the observed outcomes</option><option value="REJECT">Reject this account</option></select></label><label>Review reasoning<textarea name="notes" minLength={20} maxLength={800} required/></label><button>Record independent decision</button></fieldset></form>}</article>;
}

function Coverage({view}:{view:View}){
 const [release,setRelease]=useState(''),[productId,chooseProduct]=useState('');
 const product=benchmarkProductById.get(productId);
 const [allCriteria,setAllCriteria]=useState(false);
 const relevant=new Set<number>(product?.criteria??[]);
 const criteria=Object.values(benchmarkTracks).flatMap(t=>t.steps).sort((a,b)=>a.row-b.row).filter(s=>!product||allCriteria||relevant.has(s.row));
 const releases=[...new Set(view.trials.map(t=>t.release))],current=releases.includes(release)?release:releases[0];
 return <details className={ui.card}><summary>Evidence against the 22 workbook criteria</summary>
 {current&&<label>Release under review<select value={current} onChange={e=>setRelease(e.target.value)}>{releases.map(r=><option key={r}>{r}</option>)}</select></label>}
 <label>Comparison baseline<select aria-label="Comparison baseline" value={productId} onChange={e=>{chooseProduct(e.target.value);setAllCriteria(false);}}><option value="">All eligible trials</option><ComparatorOptions/></select></label>
 {product&&<section><h3>{product.name}</h3><p>{product.implemented}.</p><p><strong>Remaining comparison</strong> · {product.remaining}</p><a href={product.source} rel="noreferrer">Published product or service</a><label><input type="checkbox" checked={allCriteria} onChange={e=>setAllCriteria(e.target.checked)}/> Show all 22 criteria</label></section>}
 <table><thead><tr><th>Criterion</th><th>Accepted external participants</th><th>Observed failures</th><th>Evidence status</th></tr></thead><tbody>{criteria.map(s=>{
  const runs=view.trials.filter(t=>t.release===current&&(!productId||t.comparison?.productId===productId)&&t.steps.includes(s.id)&&t.ukExternal&&t.environment!=='FIXTURE'&&(s.id!=='hosted'||t.environment==='PROTECTED_PILOT'));
  const people=new Set(runs.filter(t=>t.accepted&&t.results.some(r=>r.step===s.id&&r.outcome==='PASS'&&(!['onboard','help'].includes(s.id)||!r.assisted)&&(s.id!=='answer'||r.unsupported===0))).map(t=>t.participantId)),failed=runs.filter(t=>t.current&&t.results.some(r=>r.step===s.id&&r.outcome==='FAIL')).length,needed=['onboard','help'].includes(s.id)?5:1;
  return <tr key={s.row}><td>{s.row} · {s.title}</td><td>{people.size} / {needed}</td><td>{failed}</td><td>{failed?'Failure recorded':view.limited?'History incomplete':people.size>=needed?'Evidence for assessment':people.size?'Partial evidence':'Awaiting evidence'}</td></tr>;
 })}</tbody></table>{view.limited&&<p>Earlier trials are available. Load them to include older evidence and failures.</p>}</details>;
}
