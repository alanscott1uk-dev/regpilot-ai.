'use client';

import {useState} from 'react';
import {workspaceHref,type useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {customerSourceProof,proofTargets} from '../../../lib/server/customer-source-proof';

type Proof=Awaited<ReturnType<typeof customerSourceProof>>;
type Targets=Awaited<ReturnType<typeof proofTargets>>;
const names:Record<string,string>={UBIBOT:'Calibrated UbiBot logger',BENCHLING:'Benchling decision',OPENAI_PROJECT_MODEL:'OpenAI project',PRIVATE_AI_MODEL:'Private AI model'};

export default function SourceVerification({workspace,locked}:{workspace:ReturnType<typeof useWorkspaceContext>;locked:boolean}){
 const [targets,setTargets]=useState<Targets|null>(null),[selected,select]=useState(''),[proof,show]=useState<Proof|null>(null);
 const [category,classify]=useState('UNCONFIRMED'),[confirmed,confirm]=useState(false),[busy,lock]=useState(false),[error,tell]=useState('');
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
   }
   params.set('connectionId',id);
   const {proof:value}:{proof:Proof}=await workspace.request(base+'?'+params);
   if(valid()){show(value);classify(value.category);}
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Unable to read verification records.');}finally{if(valid())lock(false);}
 }
 return <><h2>Customer source verification</h2>
 <p>Check the collection receipts for a logger, laboratory decision or AI account. Ownership is recorded separately for each workspace connection.</p>
 <fieldset disabled={busy||locked}><legend>Verification records</legend>
 <button type="button" onClick={()=>void read('list')}>Refresh verification records</button>
 {targets&&targets.length>0&&<label>Source connection <select value={selected} onChange={event=>{const id=event.target.value;select(id);void read('proof',id);}}>
 {targets.map(t=><option key={t.id} value={t.id}>{names[t.provider]} · {t.repository}{t.enabled?'':' (paused)'}</option>)}</select></label>}
 {targets?.length===0&&<p>No logger, laboratory or AI source is enrolled in this workspace.</p>}
 {proof&&<><h3>{proof.customerVerified?'Customer source verified':'Evidence still needed'}</h3>
 <ul>{[[proof.current,'Current qualifying source receipt'],[proof.repeat,'Two qualifying reads at least '+proof.intervalHours+' hours apart'],[proof.rotated,'Successful reads before and after credential replacement'],[proof.category==='CUSTOMER','Customer ownership confirmed by a second workspace administrator'],...(proof.inference===null?[]:[[proof.inference,'Successful generation with the linked account']])].map(([met,label])=><li key={String(label)}>{met?'Confirmed':'Pending'} · {String(label)}</li>)}</ul>
 <p>Checked {new Date(proof.checkedAt).toLocaleString('en-GB')}. Source classification: {proof.category.toLowerCase()}.</p>
 {proof.sourceReceiptId&&<p>Collection receipt {proof.sourceReceiptId}</p>}{proof.inferenceReceiptId&&<p>Generation receipt {proof.inferenceReceiptId}</p>}
 {proof.historyTruncated&&<p>This view covers the most recent 100 collections and 50 configuration changes.</p>}
 <label>Source classification <select value={category} onChange={e=>{classify(e.target.value);confirm(false);}}><option value="UNCONFIRMED">Unconfirmed</option><option value="STAGING">Staging or test system</option><option value="CUSTOMER">Customer-owned system</option></select></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I reviewed the source ownership and confirm this classification for the selected configuration.</label>
 <button type="button" disabled={!confirmed||category===proof.category} onClick={()=>void read('declare')}>Record source classification</button></>}
 </fieldset><p><a href={workspaceHref('/team/operations?view=connections',org)}>Configure a source in Operations</a></p>
 {error&&<p role="alert">{error}</p>}</>;
}
