'use client';
import {useEffect,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {StagingProductHistory} from '../../../lib/server/staging-product-probe';
import type {ProductRead} from '../../../lib/connectors/product-recipes';
import styles from '../questionnaires/questionnaires.module.css';

type Grant={id:string;name:string;healthy:boolean;canVerify:boolean};
type Paused={id:string;version:number;repository:string};
export default function ProductMonitors({workspace,controls}:{workspace:ReturnType<typeof useWorkspaceContext>;controls:{id:string;title:string}[]}){
 const [query,setQuery]=useState(''),[products,setProducts]=useState<ProductRead[]>([]),[selected,setSelected]=useState('');
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [accounts,setAccounts]=useState<Grant[]>([]),[account,setAccount]=useState(''),[control,setControl]=useState(controls[0]?.id??'');
 const [link,setLink]=useState(''),[sample,setSample]=useState<{count:number;digest:string}|null>(null),[paused,setPaused]=useState<Paused[]>([]);
 const [renewal,setRenewal]=useState<{id:string;version:number;requestId:string}|null>(null);
 const {request,organizationId,capture}=workspace;
 const [latest,setLatest]=useState<{org:string;value:StagingProductHistory}|null>(null);
 const history=latest?.org===organizationId?latest?.value:null;
 const current=products.find(p=>p.app+'/'+p.action===selected);
 function clearSelection(){setAccounts([]);setAccount('');setLink('');setSample(null);setRenewal(null);setNotice('');setError('');}
 useEffect(()=>{
  let stale=false;const valid=capture();
  const timer=window.setTimeout(async()=>{
   try{const r=await request('/api/workspace/product-monitors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,op:'SEARCH',q:query})});
    if(stale||!valid())return;setProducts(r.products);setLatest(r.history?{org:organizationId,value:r.history}:null);setEnabled(r.enabled);setPaused(r.paused);setSelected(r.products[0]?r.products[0].app+'/'+r.products[0].action:'');clearSelection();
   }catch(e){if(!stale&&valid())setError(e instanceof Error?e.message:'Could not load product reads.');}
  },200);
  return ()=>{stale=true;window.clearTimeout(timer);};
 },[query,organizationId,request,capture]);
 async function operate(op:string,target?:Paused){
  const valid=capture();setBusy(true);setNotice('');setError('');
  const data={organizationId,op,...(op==='START_RENEWAL'?{id:target?.id,version:target?.version}:op==='VERIFY_RENEWAL'?renewal:
    {app:current?.app,action:current?.action,...(['APPROVE','PREVIEW'].includes(op)?{account}:{}),...(op==='APPROVE'?{digest:sample?.digest,controlId:control,consent:true}:{})})};
  try{const r=await request('/api/workspace/product-monitors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   if(!valid())return;
   if(op==='START_RENEWAL'&&target){setRenewal({id:target.id,version:target.version,requestId:r.requestId});setLink(r.link);}
   if(op==='VERIFY_RENEWAL'){setPaused(old=>old.filter(p=>p.id!==renewal?.id));setRenewal(null);setLink('');setNotice('Account verified. The next scheduled read will record the recovery.');}
   if(op==='CONNECT'){setLink(r.link);setRenewal(null);}
   if(op==='ACCOUNTS'){setAccounts(r.accounts);setAccount(r.accounts.find((g:Grant)=>g.canVerify)?.id??'');setSample(null);setNotice(r.accounts.length+' linked accounts.');}
   if(op==='PREVIEW')setSample(r);
   if(op==='APPROVE'){setSample(null);setNotice('Hourly monitor enabled. Monitor ID '+r.id+'.');}
  }catch(e){if(valid())setError(e instanceof Error?e.message:'The product operation failed.');}
  finally{if(valid())setBusy(false);}
 }
 return <section className={styles.panel} id="product-monitors"><h2>Hourly product monitoring</h2>
  <p>Connect a customer account and choose the inventory that an hourly control should track. <a href="/product-integrations">Browse supported product reads</a></p>
  {history&&<section aria-label="Connected account monitoring"><h3>{history.product} · {history.action.replace(/-/g,' ')}</h3>
   {history.lastReadAt?<p>{history.reads} successful worker {history.reads===1?'read':'reads'} across {history.hours} UTC {history.hours===1?'hour':'hours'} in the past 24 hours.
    Latest inventory at {new Date(history.lastReadAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC contained {history.count} {history.count===1?'record':'records'}.</p>:<p>Awaiting the first successful worker read.</p>}
   <p>{history.previousDay.date} UTC · {history.previousDay.hours}/24 hours observed · {history.previousDay.failures} failed reads · {history.previousDay.changed} inventory changes · {history.previousDay.providerWarnings} provider warnings.
    {!!history.previousDay.missing.length&&<> Missing hours (UTC): {history.previousDay.missing.join(', ')}.</>}</p>
   {history.providerHealth===false&&<p role="status">Pipedream flagged the account on the latest successful inventory read.</p>}
   {!!history.checks.length&&<table><caption>Latest repository checks</caption><thead><tr><th scope="col">Setting</th><th scope="col">Result</th></tr></thead>
    <tbody>{history.checks.map(row=><tr key={row.id}><td>{row.label}</td><td>{row.status}</td></tr>)}</tbody></table>}
   {history.latestError&&<p role="status">The latest read needs attention ({history.latestError}).</p>}
  </section>}
  <fieldset disabled={busy}><label>Find a product <input value={query} maxLength={100} onChange={e=>{clearSelection();setSelected('');setProducts([]);setQuery(e.target.value);}}/></label>
  <label>Inventory read <select value={selected} onChange={e=>{clearSelection();setSelected(e.target.value);}}>{products.map(p=><option key={p.app+'/'+p.action} value={p.app+'/'+p.action}>{p.name} · {p.action}</option>)}</select></label>
  {enabled&&current?<><button type="button" onClick={()=>operate('CONNECT')}>Authorise account</button> <button type="button" onClick={()=>operate('ACCOUNTS')}>Refresh linked accounts</button></>:<p>Hosted reads require a Pipedream Connect project in this deployment. <a href="/product-monitors/setup.txt">Set up a project</a></p>}
  {!!accounts.length&&<><label>Customer account <select value={account} onChange={e=>{setAccount(e.target.value);setSample(null);}}>{accounts.filter(g=>g.canVerify).map(g=><option key={g.id} value={g.id}>{g.name}{g.healthy?'':' · verify with a read'}</option>)}</select></label> <button type="button" disabled={!account} onClick={()=>operate('PREVIEW')}>Read sample</button></>}
  {sample&&<><p>{sample.count} unique identifiers returned. Hourly reads flag added and missing identifiers in this sample.</p><label>Workspace control <select value={control} onChange={e=>setControl(e.target.value)}>{controls.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label> <button type="button" disabled={!control} onClick={()=>operate('APPROVE')}>Approve sample and enable hourly monitoring</button></>}
  {!!paused.length&&<div><h3>Accounts requiring renewal</h3>{paused.map(p=><p key={p.id}>{p.repository.split(':').slice(1).join(' / ')} <button type="button" onClick={()=>operate('START_RENEWAL',p)}>Renew original account</button></p>)}</div>}
  {link&&<p><a href={link} target="_blank" rel="noreferrer">Open secure account authorisation ↗</a></p>}{renewal&&<button type="button" onClick={()=>operate('VERIFY_RENEWAL')}>Verify renewed grant</button>}
  </fieldset>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
