'use client';
import {useState} from 'react';
import WorkspaceNav from '../../../components/workspace-nav';
import EmailSignIn from '../../../components/email-sign-in';
import {useWorkspaceContext} from '../../../../lib/client/workspace-context';
import type {groupRiskReport} from '../../../../lib/server/group-risk-report';
import shell from '../../../workbench/workbench.module.css';
import ui from '../../../sop-builder/sop.module.css';
const gbp=(n:number|null)=>n===null?'Unknown':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n);
type Result=Awaited<ReturnType<typeof groupRiskReport>>;
export default function Group(){
 const w=useWorkspaceContext();
 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}><div className={ui.body}><header className={ui.intro}><div><h1>Group risk report</h1><p>Review expected annual loss, treatment costs and exceptions across the companies you manage.</p></div></header>
 {w.loading?<p>Loading workspace…</p>:!w.signedIn?<EmailSignIn destination="/team/risks/group"/>:<Desk key={w.revision} w={w}/>}</div></main></div>;
}
function Desk({w}:{w:ReturnType<typeof useWorkspaceContext>}){
 const orgs=w.organisations.filter(o=>['OWNER','ADMIN'].includes(o.role)),[choices,select]=useState<Record<string,string>>({}),[missing,setMissing]=useState(''),[scope,setScope]=useState(false),[report,setReport]=useState<Result|null>(null),[busy,lock]=useState(false),[error,tell]=useState('');
 async function run(approve=false){
  const valid=w.capture(),entities=Object.entries(choices).map(([id,c])=>({id,annualTreatmentCostGbp:c===''?null:Number(c)}));if(!entities.length)return;
  lock(true);tell('');
  try{const v=await w.request('/api/workspace/risks/group?'+new URLSearchParams({organizationId:entities[0].id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selection:{entities,missingSites:missing.split('\n').map(x=>x.trim()).filter(Boolean),scopeComplete:scope},...(approve&&report?{approveHash:report.digest}:{})})});if(valid())setReport(v);}
  catch(e){if(valid()){setReport(null);tell(e instanceof Error?e.message:'Report unavailable.');}}finally{if(valid())lock(false);}
 }
 return <><form className={ui.card} onSubmit={e=>{e.preventDefault();void run();}} onChange={()=>setReport(null)}><fieldset disabled={busy}><legend>Entities and finance assumptions</legend>{orgs.map(o=><div key={o.id}><label><input type="checkbox" checked={o.id in choices} onChange={e=>{const next={...choices};if(e.target.checked)next[o.id]='';else delete next[o.id];select(next);}}/> {o.name}</label>{o.id in choices&&<label>Annual treatment cost for {o.name} (£)<input type="number" min="0" max="1000000000" step="1" placeholder="Unknown" value={choices[o.id]} onChange={e=>select({...choices,[o.id]:e.target.value})}/></label>}</div>)}<label>Missing sites or entities, one per line<textarea maxLength={1800} value={missing} onChange={e=>setMissing(e.target.value)}/></label><label><input type="checkbox" checked={scope} onChange={e=>setScope(e.target.checked)}/> I have checked the full reporting scope and possible overlapping losses.</label><button disabled={!Object.keys(choices).length}>Calculate group report</button></fieldset></form>
 {error&&<p role="alert">{error}</p>}{report&&<section className={ui.card}><h2>Reporting coverage</h2><p>Baseline annual loss {gbp(report.baseline)} · After treatment and cost {gbp(report.afterTreatmentAndCost)} · Annual net reduction {gbp(report.annualNetReduction)}</p>{report.missingSites.map(s=><p key={s}>{s} · missing</p>)}{report.rows.map(r=><article key={r.organizationId}><h3>{r.name}</h3><p>{r.risks} active risks · baseline {gbp(r.baseline)} · annual treatment cost {gbp(r.annualTreatmentCostGbp)}</p>{r.exceptions.map((v,i)=><p key={i}>{v}</p>)}</article>)}<p>Expected annual losses add across distinct exposures. Each entity retains its local exceptions. Group loss percentiles require a joint model.</p>{report.reviewedByYouAt?<p>Your finance review was recorded {new Date(report.reviewedByYouAt).toLocaleString('en-GB')}.</p>:<button disabled={busy} onClick={()=>void run(true)}>Record my review of these assumptions and exceptions</button>}</section>}</>;
}
