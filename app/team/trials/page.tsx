'use client';
import {useEffect,useRef,useState} from 'react';
import {benchmarkProducts,benchmarkProductById} from '../../../lib/benchmark-products';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {useWorkspaceContext} from '../../../lib/client/workspace-context';
import {allTrialTracks as trialTracks,trialTracks as benchmarkTracks,trialEnvironments} from '../../../lib/capability-trials';
import type {trialWorkspace} from '../../../lib/server/capability-trial-service';
import shell from '../../workbench/workbench.module.css';
import ui from '../../sop-builder/sop.module.css';

type Workspace=ReturnType<typeof useWorkspaceContext>;
type View=Awaited<ReturnType<typeof trialWorkspace>>;
type Trial=View['trials'][number];
const moduleFor=(id:string)=>Object.values(trialTracks).flatMap(t=>t.steps).find(s=>s.id===id)!;
const envText={FIXTURE:'Internal test',PARTNER_SANDBOX:'Authorised partner sandbox',PROTECTED_PILOT:'Protected customer pilot'};
export default function Page(){
 const w=useWorkspaceContext();
 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}><div className={ui.body}><header className={ui.intro}><div><h1>Capability trials</h1><p>Time an operating task, attach its evidence and record an independent decision against the release you tested.</p></div></header>
 {w.loading?<p>Loading…</p>:!w.signedIn?<EmailSignIn destination="/team/trials"/>:<><label>Workspace<select aria-label="Workspace" value={w.organizationId} onChange={e=>w.chooseOrganization(e.target.value)}>{w.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{w.organizationId&&<Trials key={w.revision} w={w}/>}</>}</div></main></div>;
}
function Trials({w}:{w:Workspace}){
 const [view,setView]=useState<View|null>(null),[track,choose]=useState('systems'),[busy,lock]=useState(false),[message,tell]=useState(''),[environment,setEnv]=useState<keyof typeof envText>('FIXTURE');
 const [initialRelease,setInitialRelease]=useState('');
 useEffect(()=>{const p=new URLSearchParams(window.location.search),choice=p.get('participant');if(choice==='operator'||choice==='assessor'){choose(choice+'_pilot');setEnv('PARTNER_SANDBOX');}const commit=p.get('release');if(commit&&/^[a-f0-9]{40}$/.test(commit))setInitialRelease(commit);},[]);
 const [release,filter]=useState(''),[releaseInput,setReleaseInput]=useState('');
 const historyEpoch=useRef(0),inFlight=useRef(false);
 const path='/api/workspace/trials?'+new URLSearchParams({organizationId:w.organizationId,...(release?{release}:{})});
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
 async function save(d:Record<string,unknown>){const valid=w.capture();lock(true);tell('');try{await w.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const v=await w.request(path);if(valid()){setView(v);tell('Saved.');}}catch(e){if(valid())tell(e instanceof Error?e.message:'Trial unavailable.');}finally{if(valid())lock(false);}}
 return <>{view&&track==='operator_pilot'&&(!view.hasActiveControl||!view.canManage)&&<section className={ui.card}><h2>Before you start the timer</h2>{!view.hasActiveControl&&<p>A workspace administrator needs to assign an active test control for the connection. <a href={'/team/programmes?organizationId='+view.organizationId}>Open starter programmes</a></p>}{!view.canManage&&<p>Your current workspace role cannot configure a connection. Select the assigned pilot workspace or record this as a blocker in your trial.</p>}</section>}{message&&<p role="status">{message}</p>}<form className={ui.card} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'START',requestKey:crypto.randomUUID(),track,environment,release:f.get('release'),intendedUse:f.get('use'),steps:f.getAll('steps'),...(track==='operator_pilot'?{firstTime:f.get('firstTime')==='on'}:{}),ukExternal:environment!=='FIXTURE'&&f.get('external')==='on'});}}><fieldset disabled={busy}><legend>Start a timed run</legend><label>Trial track<select aria-label="Trial track" value={track} onChange={e=>choose(e.target.value)}>{Object.entries(trialTracks).map(([id,t])=><option key={id} value={id}>{t.title}</option>)}</select></label><label>Release commit<input key={initialRelease} name="release" defaultValue={initialRelease} pattern="[a-f0-9]{40}" required maxLength={40} placeholder="Full Git commit SHA"/></label><label>Intended use and test scope<input key={track} name="use" defaultValue={track==='operator_pilot'?'First-time setup, failed-check review and exact reading export in staging.':track==='assessor_pilot'?'Independent review of isolated access, recovery and excursion evidence in staging.':''} required minLength={15} maxLength={360}/></label><label>Environment<select aria-label="Environment" value={environment} onChange={e=>setEnv(e.target.value as keyof typeof envText)}>{trialEnvironments.map(e=><option key={e} value={e}>{envText[e]}</option>)}</select></label>{environment!=='FIXTURE'&&<label><input name="external" type="checkbox"/> I am an independent UK operator participating in an authorised trial.</label>} {track==='operator_pilot'&&<label><input name="firstTime" type="checkbox" required/>This is my first attempt at the operator pilot.</label>}<div key={track}>{trialTracks[track].steps.map(s=><label key={s.id}><input type="checkbox" name="steps" value={s.id} defaultChecked/> {s.title}</label>)}</div><button>Start timer</button></fieldset></form>
 <form className={ui.card} onSubmit={e=>{e.preventDefault();filter(releaseInput.trim());}}>
  <label>Filter trials by release<input value={releaseInput} onChange={e=>setReleaseInput(e.target.value)} pattern="[a-f0-9]{40}" placeholder="Full Git commit SHA"/></label>
  <button disabled={busy}>Show release history</button>{release&&<button type="button" disabled={busy} onClick={()=>{setReleaseInput('');filter('');}}>Show all releases</button>}
 </form>
 {view?.canManage&&<Coverage view={view}/>}
 {view?.trials.length===0&&<p>No recorded runs in this workspace.</p>}{view?.trials.map(t=><Run key={t.id} t={t} view={view} busy={busy} save={save}/>)}{view?.limited&&<button type="button" disabled={busy} onClick={()=>void older()}>Load earlier trials</button>}</>;
}
function ComparatorOptions(){
 return <>{[...new Set(benchmarkProducts.map(p=>p.category))].map(category=><optgroup key={category} label={category}>
  {benchmarkProducts.filter(p=>p.category===category).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
 </optgroup>)}</>;
}
function Run({t,view,busy,save}:{t:Trial;view:View;busy:boolean;save:(d:Record<string,unknown>)=>Promise<void>}){
 const [outcomes,choose]=useState<Record<string,string>>({});
 const [compare,setCompare]=useState(false);
 return <article className={ui.card}><h2>{trialTracks[t.track].title}</h2><p>{envText[t.environment]} · {t.release.slice(0,10)} · {new Date(t.startedAt).toLocaleString('en-GB')}</p><p>{t.intendedUse}</p>
 {t.track==='operator_pilot'&&<p><a target="_blank" rel="noopener noreferrer" href={'/team/operations?'+new URLSearchParams({view:'connections',register:'DAILYMED_LABEL',organizationId:view.organizationId})}>Connect the test label</a> · <a target="_blank" rel="noopener noreferrer" href={'/team/work?'+new URLSearchParams({view:'sources',organizationId:view.organizationId})}>Open source follow-ups</a></p>}
 {t.track==='assessor_pilot'&&<p><a target="_blank" rel="noopener noreferrer" href={'/team/developers?organizationId='+view.organizationId+'#source-verification'}>Inspect monitoring evidence</a> · <a target="_blank" rel="noopener noreferrer" href={'/team/quality?organizationId='+view.organizationId}>Open quality cases</a></p>}
 {t.canFinish&&!t.stoppedAt&&['operator_pilot','assessor_pilot'].includes(t.track)&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'CHECKPOINT',id:t.id,key:crypto.randomUUID(),step:f.get('step'),kind:f.get('kind'),note:f.get('note')});}}><fieldset disabled={busy}><legend>Record what happened while the timer is running</legend>
 <label>Task<select name="step">{t.steps.map(s=><option key={s} value={s}>{moduleFor(s).title}</option>)}</select></label><label>Event<select name="kind"><option value="HELP">I needed help</option><option value="COMPLETED">Task completed</option><option value="BLOCKED">Task blocked</option></select></label><label>What happened or what help was needed?<input name="note" minLength={3} maxLength={400} required/></label><button>Save timed event</button></fieldset></form>}
 {!!t.checkpoints.length&&<ol>{t.checkpoints.map(p=><li key={p.id}>{p.elapsedSeconds}s · {moduleFor(p.step).title} · {p.kind} · {p.note}</li>)}</ol>}
 {t.canFinish&&!t.stoppedAt&&<button disabled={busy} onClick={()=>void save({action:'STOP',id:t.id})}>Task complete · stop timer</button>}
 {t.canFinish&&t.stoppedAt&&<p>Timer stopped at {new Date(t.stoppedAt).toLocaleTimeString('en-GB')}. Enter the observed results below.</p>}
 {t.canFinish&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'FINISH',id:t.id,...(compare?{comparison:{...(f.get('productId')?{productId:f.get('productId')}:{}),method:f.get('method'),elapsedSeconds:Number(f.get('seconds')),edits:Number(f.get('baselineEdits')),evidenceId:f.get('baselineEvidence'),sameTasks:true}}:{}),results:t.steps.map(step=>({step,outcome:outcomes[step]||'UNOBSERVED',notes:f.get(step+'-notes'),evidenceId:f.get(step+'-file')||null,...(f.get(step+'-run')?{runId:f.get(step+'-run')}:{}),unsupported:Number(f.get(step+'-claims')),edits:Number(f.get(step+'-edits')),assisted:f.get(step+'-assist')==='on'}))});}}><fieldset disabled={busy}><legend>Record observed results</legend>{t.steps.map(step=><section key={step}><h3>{moduleFor(step).title}</h3><label>Result<select value={outcomes[step]||'UNOBSERVED'} onChange={e=>choose({...outcomes,[step]:e.target.value})}><option>UNOBSERVED</option><option>PASS</option><option>FAIL</option></select></label><label>Observed result and source references<textarea name={step+'-notes'} required minLength={10} maxLength={600}/></label>{t.track==='operator_pilot'&&<label>Verified collection ID from this trial<input name={step+'-run'} placeholder="Collection ID from the reading export"/></label>}<label>Reviewed evidence<select name={step+'-file'} required={outcomes[step]==='PASS'&&t.track!=='operator_pilot'}><option value="">Choose a file</option>{view.evidence.map(e=><option key={e.id} value={e.id}>{e.filename}</option>)}</select></label><label>Unsupported claims<input name={step+'-claims'} type="number" min="0" max="1000" defaultValue="0"/></label><label>Reviewer edits<input name={step+'-edits'} type="number" min="0" max="1000" defaultValue="0"/></label><label><input type="checkbox" name={step+'-assist'}/> Human assistance was needed</label></section>)}<label><input type="checkbox" disabled={!t.stoppedAt} checked={compare} onChange={e=>setCompare(e.target.checked)}/> Compare the same tasks with the participant’s existing process</label>
 {compare&&<fieldset><legend>Existing process measurement</legend>
  <label>Product or service tested<select name="productId" aria-label="Product or service tested"><option value="">Existing process or other tool</option><ComparatorOptions/></select></label>
  <label>Tested process, edition or configuration<input name="method" minLength={3} maxLength={120} required/></label>
  <label>Elapsed seconds<input name="seconds" type="number" min={1} max={2592000} required/></label>
  <label>Corrections across the selected tasks<input name="baselineEdits" type="number" min={0} max={6000} required/></label>
  <label>Reviewed timing and correction record<select name="baselineEvidence" required><option value="">Choose a file</option>{view.evidence.map(e=><option key={e.id} value={e.id}>{e.filename}</option>)}</select></label>
  <label><input type="checkbox" required/> I checked that the record covers the same tasks and scope.</label>
 </fieldset>}<button>{t.stoppedAt?'Save observed results':'Finish run and stop timer'}</button></fieldset></form>}
 {t.elapsedSeconds!==null&&<><p>{t.elapsedSeconds} seconds · {t.reviewCount} of {t.required} independent decisions · {t.current?'Evidence current':'Evidence needs review'}</p>{t.results.map(r=><p key={r.step}><strong>{r.outcome} · {moduleFor(r.step).id}</strong> {r.notes} · {r.unsupported} unsupported claims · {r.edits} edits · {r.assisted?'assisted':'unaided'} {r.runId&&<span>Collection {r.runId}</span>} {r.evidenceId&&<a href={'/team/evidence?'+new URLSearchParams({organizationId:view.organizationId,evidenceId:r.evidenceId})}>Review exact supporting file</a>}</p>)}{t.reviewDecisions.length>0&&<p>Recorded decisions {t.reviewDecisions.join(', ')}</p>}</>}
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
