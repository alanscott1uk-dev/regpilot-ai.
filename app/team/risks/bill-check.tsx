'use client';
import {useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {accountingAction} from '../../../lib/server/accounting-service';
import type {checkRiskBill} from '../../../lib/server/risk-bills';

type Verified={id:string;reference:string;name:string};
type Grants=Extract<Awaited<ReturnType<typeof accountingAction>>,{type:'grants'}>;
export default function BillCheck({workspace,riskId,version}:{workspace:ReturnType<typeof useWorkspaceContext>;riskId:string;version:number}){
 const [provider,choose]=useState('xero'),[grants,setGrants]=useState<Verified[]>([]),[connection,select]=useState(''),[bill,setBill]=useState(''),[busy,lock]=useState(false),[message,tell]=useState('');
 const {organizationId,capture,request}=workspace;
 async function run(mode:'connections'|'bill'){
  const valid=capture(),target=grants.find(g=>g.id===connection);
  lock(true);tell('');
  try{
   const send=(fields:Record<string,unknown>)=>request('/api/workspace/accounting-software',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,provider,...fields})});
   if(mode==='connections'){
    setGrants([]);select('');
    const result:Grants=await send({action:'CHECK'});
    if(!valid()||result.organizationId!==organizationId)return;
    const verified=result.grants.flatMap(g=>g.state==='authorised'&&g.lastCheck?[{id:g.id,name:g.lastCheck.name,reference:g.lastCheck.reference}]:[]);
    setGrants(verified);select(verified[0]?.id??'');
    if(!verified.length)tell('Verify a business in Accounting software, then refresh connections here.');
   }else if(target){
    const result:{organizationId:string;receipt:Awaited<ReturnType<typeof checkRiskBill>>}=await send({action:'RISK_BILL',requestKey:crypto.randomUUID(),riskId,riskVersion:version,connectionId:target.id,business:target.reference,externalId:bill.trim()});
    if(!valid()||result.organizationId!==organizationId)return;
    const obs=result.receipt.observation;
    tell('reason' in obs?'Bill excluded. '+obs.reason:'Checked '+obs.issuedOn+' · £'+(obs.grossPence/100).toFixed(2)+' gross. Included in the group report for that month.');
   }
  }catch(e){if(valid())tell(e instanceof Error?e.message:'The accounting check was unavailable.');}
  finally{if(valid())lock(false);}
 }
 return <details><summary>Link a treatment bill from accounting</summary><p>Choose a bill whose full gross amount belongs to this risk. Refreshing the same bill replaces its previous observation.</p>
 <p><a href={'/team/accounting?'+new URLSearchParams({organizationId})}>Manage accounting connections</a></p>
 <fieldset disabled={busy}><legend>Source bill</legend><label>Package <select value={provider} onChange={e=>{choose(e.target.value);setGrants([]);select('');setBill('');tell('');}}><option value="xero">Xero</option><option value="quickbooks">QuickBooks Online</option></select></label>
 <button type="button" onClick={()=>void run('connections')}>Refresh verified connections</button>
 {grants.length>0&&<><label>Business <select value={connection} onChange={e=>{select(e.target.value);setBill('');tell('');}}>{grants.map(g=><option key={g.id} value={g.id}>{g.name} · {g.reference} · {g.id}</option>)}</select></label>
 <label>{provider==='xero'?'Xero purchase bill UUID':'QuickBooks bill ID'} <input value={bill} maxLength={100} onChange={e=>{setBill(e.target.value);tell('');}}/></label><button type="button" disabled={!bill.trim()} onClick={()=>void run('bill')}>Check and link whole bill</button></>}</fieldset>
 {message&&<p role="status">{message}</p>}</details>;
}
