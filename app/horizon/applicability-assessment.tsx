'use client';
import {useRef,useState} from 'react';
import type {useWorkspaceContext} from '../../lib/client/workspace-context';
import type {applicabilityAssessment} from '../../lib/server/horizon-applicability-assessment';
type View=Awaited<ReturnType<typeof applicabilityAssessment>>;
const percent=(n:number|null)=>n===null?'No measurable denominator':Math.round(n*100)+'%';
export function ApplicabilityAssessment({workspace,profile}:{workspace:ReturnType<typeof useWorkspaceContext>;profile:import('../../lib/horizon/watchlists').WholesaleView}){
 const [data,setData]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),startKey=useRef({identity:'',id:''});
 const url='/api/workspace/horizon/assessment?'+new URLSearchParams({organizationId:workspace.organizationId});
 async function run(input?:Record<string,unknown>,id?:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');const valid=workspace.capture();
  try{if(input){const result=await workspace.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});id=result.id;}
   const next=await workspace.request(url+(id?'&id='+encodeURIComponent(id):''));if(valid())setData(next);}
  catch(e){if(valid())setError(e instanceof Error?e.message:'Assessment unavailable.');}finally{pending.current=false;if(valid())setBusy(false);}
 }
 const selected=data?.selected;
 return <details onToggle={e=>{if(e.currentTarget.open&&!data)void run();}}><summary>Measure missed publications and false alerts for your site</summary>
 <p>Sample up to 20 records directly from the MHRA and legislation indexes, including publications absent from the feed. A second reviewer judges which apply to your site before seeing the alerts.</p>
 <form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),scope=String(form.get('scope')).trim(),method=String(form.get('method')),identity=JSON.stringify([scope,method,profile]);if(startKey.current.identity!==identity)startKey.current={identity,id:crypto.randomUUID()};void run({action:'START',scope,method,profile,requestKey:startKey.current.id});}}>
 <label>Sample source<select name="method" defaultValue="INDEX"><option value="INDEX">Official publisher indexes</option><option value="QUEUE">RegPilot shortlist and collected feed</option></select></label><label>Scottish wholesale site activities<textarea name="scope" required minLength={15} maxLength={400}/></label><button disabled={busy}>Freeze a review sample</button></form>
 {error&&<p role="alert">{error}</p>}{data&&data.recent.length>0&&<label>Past samples<select disabled={busy} value={selected?.id??''} onChange={e=>void run(undefined,e.target.value)}>{data.recent.map(x=><option key={x.id} value={x.id}>{x.at}</option>)}</select></label>}
 {selected&&<div key={selected.id}><p>{selected.scope} · {selected.profile==='scottish-medicines-only'?'Medicines only':'Medicines and devices'} · Snapshot {selected.snapshot} · {selected.rows.length} publications{selected.population?' sampled from '+selected.population+' distinct eligible publisher records':''}</p>{selected.unavailable.length>0&&<p>Limited or unavailable UK feeds: {selected.unavailable.join(', ')}</p>}
 {selected.score?<><p>On this reviewed sample, {selected.score.correctAlert} alerts applied, {selected.score.falseAlert} were outside scope, {selected.score.missed} applicable publications were missed and {selected.score.uncertain} decisions were uncertain.</p>
 {selected.coverage&&<p>{selected.coverage.missedAtCollection} applicable publications were absent from the collected feed. {selected.coverage.unavailableComparisons} labelled records had inconclusive collection evidence and were excluded from the rates.</p>}
 <p>Sample precision {percent(selected.score.precision)} · Sample recall {percent(selected.score.recall)} · Independent decision {selected.reviewedAt}</p>
 <ul>{selected.rows.map(r=><li key={r.id}><a href={r.url}>{r.title}</a> · {r.assessment?.suggested?'Shortlisted':'Outside shortlist'} · {r.assessment?.verdict} · {r.assessment?.reason}{r.assessment?.index&&<> · <a href={r.assessment.index}>Official index</a> · {r.assessment.collection}</>}</li>)}</ul></>:selected.canReview?<form onSubmit={e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);void run({action:'REVIEW',assessmentId:selected.id,sampleHash:selected.sampleHash,labels:selected.rows.map(r=>({id:r.id,verdict:f.get('v'+r.id),reason:f.get('r'+r.id)}))});
 }}><fieldset disabled={busy}><legend>Independent assessment</legend>{selected.rows.map(r=><fieldset key={r.id}><legend><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></legend><label>Site applicability<select name={'v'+r.id} required defaultValue=""><option value="">Choose a decision</option><option value="APPLIES">Applies</option><option value="OUTSIDE_SCOPE">Outside scope</option><option value="UNCERTAIN">Uncertain</option></select></label><label>Reason for this site<input required minLength={10} maxLength={350} name={'r'+r.id}/></label></fieldset>)}<button>Finish independent review and calculate results</button></fieldset></form>:<p>Awaiting assessment by another workspace owner or administrator.</p>}</div>}</details>;
}
