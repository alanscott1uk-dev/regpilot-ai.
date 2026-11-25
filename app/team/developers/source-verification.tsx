'use client';

import {useState} from 'react';
import {monitoringGaps,type MonitoringGap} from '../../../lib/monitoring-criteria';
import {workspaceHref,type useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {customerBenchmarkPage,customerSourceProof,proofTargets} from '../../../lib/server/customer-source-proof';

type Proof=Awaited<ReturnType<typeof customerSourceProof>>;
type Targets=Awaited<ReturnType<typeof proofTargets>>;
const names:Record<string,string>={UBIBOT:'Calibrated UbiBot logger',BENCHLING:'Benchling decision',OPENAI_PROJECT_MODEL:'OpenAI project',PRIVATE_AI_MODEL:'Private AI model'};

export default function SourceVerification({workspace,locked}:{workspace:ReturnType<typeof useWorkspaceContext>;locked:boolean}){
 const [targets,setTargets]=useState<Targets|null>(null),[selected,select]=useState(''),[proof,show]=useState<Proof|null>(null);
 const [category,classify]=useState('UNCONFIRMED'),[confirmed,confirm]=useState(false),[busy,lock]=useState(false),[error,tell]=useState('');
 type Page=Awaited<ReturnType<typeof customerBenchmarkPage>>;
 const [score,setScore]=useState<Page['connections']|null>(null);
 const [filter,setFilter]=useState<MonitoringGap|'all'|'qualified'>('all');
 function exportPortfolio(rows:Page['connections']){
  const contents={format:'regpilot-monitoring-portfolio-v1',organizationId:org,target:500,generatedAt:new Date().toISOString(),qualifiedProducts:[...new Set(rows.filter(row=>row.qualified).map(row=>row.product))].sort(),criteria:monitoringGaps,connections:rows};
  const url=URL.createObjectURL(new Blob([JSON.stringify(contents,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='regpilot-customer-monitoring.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function benchmark(){
  const valid=workspace.capture(),rows:Page['connections']=[],seen=new Set<string>();let cursor:string|null=null;
  lock(true);setScore(null);tell('');
  try{do{
   const params=new URLSearchParams({organizationId:org,benchmark:'1',...(cursor?{after:cursor}:{})});
   const page:Page=await workspace.request(base+'?'+params);
   if(!valid())return;
   if(page.organizationId!==org||page.after&&seen.has(page.after))throw new Error('Refresh the benchmark to verify this workspace.');
   rows.push(...page.connections);cursor=page.after;if(cursor)seen.add(cursor);
  }while(cursor);setScore(rows);}catch(e){if(valid())tell(e instanceof Error?e.message:'Could not complete the customer benchmark.');}finally{if(valid())lock(false);}
 }
 const base='/api/workspace/connectors/proof',org=workspace.organizationId;
 async function read(action:'list'|'proof'|'declare',id=selected){
  const valid=workspace.capture(),params=new URLSearchParams({organizationId:org});
  lock(true);tell('');show(null);confirm(false);
  try{
   if(action==='list'){
    const {targets:rows}:{targets:Targets}=await workspace.request(base+'?'+params);
    if(!valid()) return;
    setTargets(rows);id=rows.find(t=>t.id===id)?.id??rows[0]?.id??'';select(id);
   }
   if(!id)return;
   if(action==='declare'&&proof&&proof.connectorId===id&&confirmed){
    await workspace.request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:org,connectionId:id,configVersion:proof.version,category,confirm:true})});
    if(!valid())return;
    setScore(null);
   }
   params.set('connectionId',id);
   const {proof:value}:{proof:Proof}=await workspace.request(base+'?'+params);
   if(valid()){if(value.connectorId!==id)throw new Error('The receipt belongs to a different connection.');show(value);classify(value.category);}
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Unable to read verification records.');}finally{if(valid())lock(false);}
 }
 const visible=score?.filter(row=>filter==='all'||(filter==='qualified'?row.qualified:row.gaps.includes(filter)))??[];
 return <><h2>Customer source verification</h2>
 <p>Inspect checks, scheduled reads and credential recovery for a connected product. Ownership is recorded separately for each workspace connection.</p>
 <fieldset disabled={busy||locked}><legend>Verification records</legend>
 <button type="button" onClick={()=>void benchmark()}>Check customer monitoring coverage</button>
 {score&&<><p role="status">{new Set(score.filter(r=>r.qualified).map(r=>r.product)).size} of 500 distinct products qualified across {score.length} active workspace connections.</p>
 {score.length>0&&<><label>Filter monitoring evidence<select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
 <option value="all">All connections</option><option value="qualified">Qualified connections</option>
 {(Object.keys(monitoringGaps) as MonitoringGap[]).map(key=><option key={key} value={key}>{monitoringGaps[key]} ({score.filter(row=>row.gaps.includes(key)).length})</option>)}</select></label>
 {visible.length===0&&<p>No connections match this filter.</p>}
 <ul>{visible.map(row=><li key={row.id}>
 <strong>{row.product}</strong> · {row.target} · {row.qualified?'Qualified':row.gaps.map(key=>monitoringGaps[key]).join(' · ')}
 <button type="button" onClick={()=>{select(row.id);void read('proof',row.id);}}>Inspect connection {row.id.slice(0,8)}</button>
 </li>)}</ul><button type="button" onClick={()=>exportPortfolio(score)}>Download full monitoring benchmark</button></>}</>}
 <button type="button" onClick={()=>void read('list')}>Refresh verification records</button>
 {targets&&targets.length>0&&<label>Source connection <select value={selected} onChange={event=>{const id=event.target.value;select(id);void read('proof',id);}}>
 {targets.map(t=><option key={t.id} value={t.id}>{names[t.provider]??t.provider} · {t.repository}{t.enabled?'':' (paused)'}</option>)}</select></label>}
 {targets?.length===0&&<p>No source is enrolled in this workspace.</p>}
 {proof&&<><h3>{names[proof.provider]??proof.provider} · {proof.customerVerified?'Customer source verified':'Evidence still needed'}</h3>
 <ul>{[[proof.current,'Current qualifying source receipt'],[proof.repeat,'Two qualifying reads at least '+proof.intervalHours+' hours apart'],[proof.rotated,'Successful reads before and after credential replacement'],[proof.category==='CUSTOMER','Customer ownership confirmed by a second workspace administrator'],...(proof.inference===null?[]:[[proof.inference,'Successful generation with the linked account']])].map(([met,label])=><li key={String(label)}>{met?'Confirmed':'Pending'} · {String(label)}</li>)}</ul>
 <h4>Evidence for the 500-product target</h4>
 {proof.depth.latestScheduledAt&&<p>Latest scheduled reading {new Date(proof.depth.latestScheduledAt).toLocaleString('en-GB')}. {proof.depth.cadence?'Current scheduled cadence verified.':'Current scheduled cadence still needs evidence.'}</p>}
 <p>{proof.qualifies?'This customer connection meets the monitoring criteria.':'Awaiting qualifying customer monitoring evidence.'} {proof.depth.scheduledReads} scheduled reads · {proof.depth.failures.length} recorded collection failures · {proof.depth.recoveries.length} evidenced credential recoveries.</p>
 <details><summary>Read history and checks</summary>{proof.depth.reads.map(r=><p key={r.id}>{r.at} · {r.mode.toLowerCase()} · {r.checks.map(c=>c.label+' ('+c.status+')').join(', ')}</p>)}{proof.depth.failures.map(f=><p key={f.id}>{f.at} · {f.code}{f.stage&&<> · <strong>{f.stage.label}</strong><br/>{f.stage.guidance}</>}</p>)}
 <button type="button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='regpilot-monitoring-'+proof.connectorId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download monitoring evidence</button></details>
 <p>Checked {new Date(proof.checkedAt).toLocaleString('en-GB')}. Source classification: {proof.category.toLowerCase()}.</p>
 {proof.sourceReceiptId&&<p>Collection receipt {proof.sourceReceiptId}</p>}{proof.inferenceReceiptId&&<p>Generation receipt {proof.inferenceReceiptId}</p>}
 {proof.historyTruncated&&<p>This view covers the most recent 100 collections and 50 configuration changes.</p>}
 <label>Source classification <select value={category} onChange={e=>{classify(e.target.value);confirm(false);}}><option value="UNCONFIRMED">Unconfirmed</option><option value="STAGING">Staging or test system</option><option value="CUSTOMER">Customer-owned system</option></select></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I reviewed the source ownership and confirm this classification for the selected configuration.</label>
 <button type="button" disabled={!confirmed||category===proof.category} onClick={()=>void read('declare')}>Record source classification</button></>}
 </fieldset><p><a href={workspaceHref('/team/operations?view=connections',org)}>Configure a source in Operations</a></p>
 {error&&<p role="alert">{error}</p>}</>;
}
