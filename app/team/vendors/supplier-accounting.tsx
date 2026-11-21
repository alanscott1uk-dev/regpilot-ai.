'use client';
import {useEffect,useRef,useState} from 'react';
import {auditRequest} from '../audits/audit-session';
import {workspaceHref} from '../../../lib/client/workspace-context';
import type {vendorDetail} from '../../../lib/server/vendor-service';
import type {accountingAction} from '../../../lib/server/accounting-service';
import ui from '../operations/operations.module.css';

type Checks=Awaited<ReturnType<typeof vendorDetail>>['accountingChecks'];
type Grants=Extract<Awaited<ReturnType<typeof accountingAction>>,{type:'grants'}>['grants'];
export default function SupplierAccounting({orgId,vendor,checks}:{orgId:string;vendor:{id:string;version:number;active:boolean};checks:Checks}){
 const [provider,choose]=useState<'xero'|'quickbooks'>('xero'),[grants,setGrants]=useState<Grants|null>(null);
 const [connection,select]=useState(''),[externalId,enter]=useState(''),[latest,save]=useState<Checks[number]|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),pending=useRef(false),retry=useRef<{input:string;key:string}|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const selected=grants?.find(g=>g.id===connection);
 async function submit(load:boolean){
  if(pending.current||!vendor.active)return;
  pending.current=true;setBusy(true);setError('');
  try{
   if(load){
    setGrants(null);select('');
    const result=await auditRequest('/api/workspace/accounting-software',{organizationId:orgId,action:'CHECK',provider});
    if(result.organizationId!==orgId||result.type!=='grants'||result.provider!==provider)throw Error('Check the accounting workspace again.');
    if(alive.current)setGrants(result.grants.filter((g:Grants[number])=>g.state==='authorised'&&g.lastCheck));
   }else if(selected?.lastCheck&&externalId.trim()){
    const input={organizationId:orgId,action:'SUPPLIER',vendorId:vendor.id,version:vendor.version,provider,connectionId:connection,business:selected.lastCheck.reference,externalId:externalId.trim()};
    const identity=JSON.stringify(input);
    if(retry.current?.input!==identity)retry.current={input:identity,key:crypto.randomUUID()};
    const result=await auditRequest('/api/workspace/accounting-software',{...input,requestKey:retry.current.key});
    if(result.organizationId!==orgId||result.type!=='supplier')throw Error('Reload the supplier record.');
    if(alive.current){save(result.receipt);retry.current=null;}
   }
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'The accounting check could not be completed.');}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 function download(check:Checks[number]){
  const {requestHash,...record}=check;
  const report={format:'regpilot-supplier-accounting-comparison-v1',organizationId:orgId,vendorId:vendor.id,...record};
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
  link.href=url;link.download='supplier-comparison-'+check.comparisonHash.slice(0,12)+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const history=latest?[latest,...checks.filter(c=>c.requestHash!==latest.requestHash)].slice(0,10):checks;
 return <details className={ui.review}><summary>Accounting supplier checks</summary>
  <p>Compare the supplier’s name and active status with its record in a verified accounting business. Differences create a task for the supplier owner.</p>
  {vendor.active&&<fieldset disabled={busy}><label>Accounting package<select value={provider} onChange={e=>{choose(e.target.value as typeof provider);setGrants(null);select('');enter('');setError('');}}>
   <option value="xero">Xero</option><option value="quickbooks">QuickBooks Online</option></select></label>
   <button type="button" onClick={()=>void submit(true)}>Find verified businesses</button>
   {grants?.length===0&&<p>Verify the business in <a href={workspaceHref('/team/accounting',orgId)}>Accounting software</a> before checking a supplier.</p>}
   {!!grants?.length&&<form onSubmit={e=>{e.preventDefault();void submit(false);}}>
    <label>Verified accounting business<select required value={connection} onChange={e=>select(e.target.value)}>
     <option value="">Choose a business</option>{grants.map(g=><option key={g.id} value={g.id}>{g.lastCheck?.name} · {g.lastCheck?.reference}</option>)}</select></label>
    <label>{provider==='xero'?'Xero contact ID':'QuickBooks vendor ID'}<input required maxLength={100} value={externalId} onChange={e=>enter(e.target.value)}/></label>
    <button disabled={!selected||!externalId.trim()}>Compare supplier record</button></form>}
  </fieldset>}{error&&<p role="alert">{error} <a href={workspaceHref('/team/accounting',orgId)}>Open accounting software</a></p>}
  {history.length>0&&<ul>{history.map(c=><li key={c.requestHash}><strong>{c.name}</strong> · {c.provider==='xero'?'Xero':'QuickBooks'} · {new Date(c.checkedAt).toLocaleString('en-GB')}
   <p>Business {c.business} · supplier {c.externalId} · RegPilot supplier revision {c.vendorVersion}</p><p>{c.issues.length?c.issues.join(' · '):'Name and active supplier status matched at the time of this check.'}</p>
   <button type="button" onClick={()=>download(c)}>Download comparison record</button>
   {c.taskId&&<a href={workspaceHref('/team/work',orgId,{taskId:c.taskId})}>Open reconciliation task</a>}</li>)}</ul>}
 </details>;
}
