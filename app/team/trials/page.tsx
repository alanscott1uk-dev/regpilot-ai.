'use client';
import {useEffect,useState} from 'react';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {useWorkspaceContext} from '../../../lib/client/workspace-context';
import {trialTracks,trialEnvironments} from '../../../lib/capability-trials';
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
 const path='/api/workspace/trials?'+new URLSearchParams({organizationId:w.organizationId});
 useEffect(()=>{const valid=w.capture();void w.request(path).then(v=>{if(valid())setView(v);}).catch(e=>{if(valid())tell(e.message);});},[w.capture,w.request,path]);
 async function save(d:Record<string,unknown>){const valid=w.capture();lock(true);tell('');try{await w.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const v=await w.request(path);if(valid()){setView(v);tell('Saved.');}}catch(e){if(valid())tell(e instanceof Error?e.message:'Trial unavailable.');}finally{if(valid())lock(false);}}
 return <>{message&&<p role="status">{message}</p>}<form className={ui.card} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'START',requestKey:crypto.randomUUID(),track,environment,release:f.get('release'),intendedUse:f.get('use'),steps:f.getAll('steps'),ukExternal:environment!=='FIXTURE'&&f.get('external')==='on'});}}><fieldset disabled={busy}><legend>Start a timed run</legend><label>Trial track<select aria-label="Trial track" value={track} onChange={e=>choose(e.target.value)}>{Object.entries(trialTracks).map(([id,t])=><option key={id} value={id}>{t.title}</option>)}</select></label><label>Release commit<input name="release" pattern="[a-f0-9]{40}" required maxLength={40} placeholder="Full Git commit SHA"/></label><label>Intended use and test scope<input name="use" required minLength={15} maxLength={360}/></label><label>Environment<select aria-label="Environment" value={environment} onChange={e=>setEnv(e.target.value as keyof typeof envText)}>{trialEnvironments.map(e=><option key={e} value={e}>{envText[e]}</option>)}</select></label>{environment!=='FIXTURE'&&<label><input name="external" type="checkbox"/> I am an independent UK operator participating in an authorised trial.</label>}<div key={track}>{trialTracks[track].steps.map(s=><label key={s.id}><input type="checkbox" name="steps" value={s.id} defaultChecked/> {s.title}</label>)}</div><button>Start timer</button></fieldset></form>
 {view?.canManage&&<Coverage view={view}/>}
 {view?.trials.length===0&&<p>No recorded runs in this workspace.</p>}{view?.trials.map(t=><Run key={t.id} t={t} view={view} busy={busy} save={save}/>)}{view?.limited&&<p>Showing the 50 most recent runs.</p>}</>;
}
function Run({t,view,busy,save}:{t:Trial;view:View;busy:boolean;save:(d:Record<string,unknown>)=>Promise<void>}){
 const [outcomes,choose]=useState<Record<string,string>>({});
 return <article className={ui.card}><h2>{trialTracks[t.track].title}</h2><p>{envText[t.environment]} · {t.release.slice(0,10)} · {new Date(t.startedAt).toLocaleString('en-GB')}</p><p>{t.intendedUse}</p>
 {t.canFinish&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'FINISH',id:t.id,results:t.steps.map(step=>({step,outcome:outcomes[step]||'UNOBSERVED',notes:f.get(step+'-notes'),evidenceId:f.get(step+'-file')||null,unsupported:Number(f.get(step+'-claims')),edits:Number(f.get(step+'-edits')),assisted:f.get(step+'-assist')==='on'}))});}}><fieldset disabled={busy}><legend>Record observed results</legend>{t.steps.map(step=><section key={step}><h3>{moduleFor(step).title}</h3><label>Result<select value={outcomes[step]||'UNOBSERVED'} onChange={e=>choose({...outcomes,[step]:e.target.value})}><option>UNOBSERVED</option><option>PASS</option><option>FAIL</option></select></label><label>Observed result and source references<textarea name={step+'-notes'} required minLength={10} maxLength={600}/></label><label>Reviewed evidence<select name={step+'-file'} required={outcomes[step]==='PASS'}><option value="">Choose a file</option>{view.evidence.map(e=><option key={e.id} value={e.id}>{e.filename}</option>)}</select></label><label>Unsupported claims<input name={step+'-claims'} type="number" min="0" max="1000" defaultValue="0"/></label><label>Reviewer edits<input name={step+'-edits'} type="number" min="0" max="1000" defaultValue="0"/></label><label><input type="checkbox" name={step+'-assist'}/> Human assistance was needed</label></section>)}<button>Finish run and stop timer</button></fieldset></form>}
 {t.elapsedSeconds!==null&&<><p>{t.elapsedSeconds} seconds · {t.reviewCount} of {t.required} independent decisions · {t.current?'Evidence current':'Evidence needs review'}</p>{t.results.map(r=><p key={r.step}><strong>{r.outcome} · {moduleFor(r.step).id}</strong> {r.notes} · {r.unsupported} unsupported claims · {r.edits} edits · {r.assisted?'assisted':'unaided'} {r.evidenceId&&<a href={'/team/evidence?'+new URLSearchParams({organizationId:view.organizationId,evidenceId:r.evidenceId})}>Review exact supporting file</a>}</p>)}{t.reviewDecisions.length>0&&<p>Recorded decisions {t.reviewDecisions.join(', ')}</p>}</>}
 {t.canReview&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'REVIEW',id:t.id,decision:f.get('decision'),notes:f.get('notes')});}}><fieldset disabled={busy}><legend>Independent review</legend><label>Decision<select name="decision"><option value="ACCEPT">Accept this account of the observed outcomes</option><option value="REJECT">Reject this account</option></select></label><label>Review reasoning<textarea name="notes" minLength={20} maxLength={800} required/></label><button>Record independent decision</button></fieldset></form>}</article>;
}

function Coverage({view}:{view:View}){
 const [release,setRelease]=useState('');
 const releases=[...new Set(view.trials.map(t=>t.release))],current=releases.includes(release)?release:releases[0];
 return <details className={ui.card}><summary>Evidence against the 22 workbook criteria</summary>
 {current&&<label>Release under review<select value={current} onChange={e=>setRelease(e.target.value)}>{releases.map(r=><option key={r}>{r}</option>)}</select></label>}
 <table><thead><tr><th>Criterion</th><th>Accepted external participants</th><th>Observed failures</th><th>Evidence status</th></tr></thead><tbody>{Object.values(trialTracks).flatMap(t=>t.steps).sort((a,b)=>a.row-b.row).map(s=>{
  const runs=view.trials.filter(t=>t.release===current&&t.steps.includes(s.id)&&t.ukExternal&&t.environment!=='FIXTURE'&&(s.id!=='hosted'||t.environment==='PROTECTED_PILOT'));
  const people=new Set(runs.filter(t=>t.accepted&&t.results.some(r=>r.step===s.id&&r.outcome==='PASS')).map(t=>t.participantId)),failed=runs.filter(t=>t.current&&t.results.some(r=>r.step===s.id&&r.outcome==='FAIL')).length,needed=['onboard','help'].includes(s.id)?5:1;
  return <tr key={s.row}><td>{s.row} · {s.title}</td><td>{people.size} / {needed}</td><td>{failed}</td><td>{failed?'Failure recorded':people.size>=needed?'Evidence for assessment':people.size?'Partial evidence':'Awaiting evidence'}</td></tr>;
 })}</tbody></table>{view.limited&&<p>The table covers the latest 50 visible runs.</p>}</details>;
}
