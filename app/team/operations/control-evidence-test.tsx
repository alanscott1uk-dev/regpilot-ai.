'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import ui from './operations.module.css';
import type {testConnectedControl} from '../../../lib/server/control-policy';
type Receipt=Awaited<ReturnType<typeof testConnectedControl>>;
type Props={organizationId:string;controls:{id:string;title:string;enabled:boolean}[];request:(path:string,options:RequestInit)=>Promise<Response>};
const labels={FINDINGS:'Verified checks found issues',INSUFFICIENT_EVIDENCE:'More evidence needed',BELOW_TARGET:'Below your source target',MEETS_TARGET:'Meets your source target'};
export function ControlEvidenceTest({organizationId,controls,request}:Props){
 const [id,setId]=useState(''),[minimum,setMinimum]=useState(1),[result,setResult]=useState<Receipt|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 async function run(event:FormEvent){
  event.preventDefault();if(!id||pending.current)return;
  const abort=new AbortController();pending.current=abort;setBusy(true);setError('');setResult(null);
  try{
   const response=await request('/api/workspace/controls/test?'+new URLSearchParams({organizationId}),{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({controlId:id,minimumProviders:minimum})});
   const receipt:Receipt=await response.json();
   if(receipt.organizationId!==organizationId||receipt.control.id!==id||receipt.minimumProviders!==minimum)throw Error('The result belongs to another control or scope.');
   if(!abort.signal.aborted)setResult(receipt);
  }catch(problem){if(!abort.signal.aborted)setError(problem instanceof Error?problem.message:'Assessment failed');}
  finally{pending.current=null;if(!abort.signal.aborted)setBusy(false);}
 }
 function download(){
  if(!result)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='regpilot-control-'+result.control.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className={ui.review} aria-labelledby="connected-test-title"><h3 id="connected-test-title">Test a control’s connected evidence</h3>
  <p>Choose how many different providers must supply current, passing checks. An unresolved provider observation leaves the evidence incomplete.</p>
  <form className={ui.formGrid} onSubmit={run}><label>Operating control <select required value={id} disabled={busy} onChange={e=>{setId(e.target.value);setResult(null);}}><option value="">Choose a control</option>{controls.filter(c=>c.enabled).map(c=><option value={c.id} key={c.id}>{c.title}</option>)}</select></label>{' '}
  <label>Minimum providers <select value={minimum} disabled={busy} onChange={e=>{setMinimum(Number(e.target.value));setResult(null);}}>{[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>{' '}
  <button disabled={!id||busy}>{busy?'Testing…':'Run evidence test'}</button></form>
  {error&&<p role="alert">{error}</p>}
  {result&&<div aria-live="polite"><h4>{labels[result.decision.state]}</h4><p>{result.decision.providers.length} qualifying provider types against a target of {minimum}. Tested {new Date(result.checkedAt).toLocaleString('en-GB')}.</p>
   {!result.observations.length&&<p>No active evidence connection was mapped to this control.</p>}
   {result.limited&&<p>The check reached its 100-connection limit.</p>}
   <ul>{result.observations.map(o=><li key={o.connectorId}>{o.provider} · {o.reason}{o.runId?' · Observation '+o.runId:''}</li>)}</ul>
   <button type="button" onClick={download}>Download test result and evidence references</button></div>}
 </section>;
}
