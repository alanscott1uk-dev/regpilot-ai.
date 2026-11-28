'use client';
import {useEffect,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {StagingProductHistory} from '../../../lib/server/staging-product-probe';
import {profiles,profileFields} from '../../../lib/connectors/resource-control';
import type {ProductRead} from '../../../lib/connectors/product-recipes';
import styles from '../questionnaires/questionnaires.module.css';

type Grant={id:string;name:string;healthy:boolean;canVerify:boolean};
type Preview={count:number;digest:string;reviewDigest?:string;checks?:{id:string;label:string;status:string;observed:string}[];observable?:boolean};
type Schedule={id:string;product:string;action:string;control:string;state:string;failureCode:string|null;lastSuccessAt:string|null;nextRunAt:string|null};
type Paused={id:string;version:number;repository:string};
export default function ProductMonitors({workspace,controls}:{workspace:ReturnType<typeof useWorkspaceContext>;controls:{id:string;title:string}[]}){
 const [query,setQuery]=useState(''),[products,setProducts]=useState<ProductRead[]>([]),[selected,setSelected]=useState('');
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [accounts,setAccounts]=useState<Grant[]>([]),[account,setAccount]=useState(''),[control,setControl]=useState(controls[0]?.id??'');
 const [link,setLink]=useState(''),[sample,setSample]=useState<Preview|null>(null),[paused,setPaused]=useState<Paused[]>([]);
 const [profile,setProfile]=useState(''),[mapping,setMapping]=useState<Record<string,string>>({});
 const [created,setCreated]=useState<{org:string;id:string}|null>(null);
 const [renewal,setRenewal]=useState<{id:string;version:number;requestId:string}|null>(null);
 const {request,organizationId,capture}=workspace;
 const [latest,setLatest]=useState<{org:string;value:StagingProductHistory}|null>(null);
 const history=latest?.org===organizationId?latest?.value:null;
 const [schedulePage,setSchedulePage]=useState<{org:string;rows:Schedule[];next:string|null;asOf:string}|null>(null);
 const page=schedulePage?.org===organizationId?schedulePage:null;
 async function loadSchedules(after?:string){
  const valid=capture();setBusy(true);setError('');
  try{
   const r=await request('/api/workspace/product-monitors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,op:'SCHEDULES',after})});
   if(valid())setSchedulePage({org:organizationId,rows:r.schedules,next:r.next,asOf:r.asOf});
  }catch(e){if(valid())setError(e instanceof Error?e.message:'Could not load hourly schedules.');}
  finally{if(valid())setBusy(false);}
 }
 const utc=(value:string)=>new Date(value).toISOString().replace('T',' ').slice(0,19);
 const current=products.find(p=>p.app+'/'+p.action===selected);
 function clearSelection(){setCreated(null);setProfile('');setMapping({});setAccounts([]);setAccount('');setLink('');setSample(null);setRenewal(null);setNotice('');setError('');}
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
    {app:current?.app,action:current?.action,...(['APPROVE','PREVIEW'].includes(op)?{account,...(profile?{policy:{profile,mapping}}:{})}:{}),...(op==='DISCOVER'?{account,profile}:{}),...(op==='APPROVE'?{digest:sample?.digest,reviewDigest:sample?.reviewDigest,controlId:control,consent:true}:{})})};
  try{const r=await request('/api/workspace/product-monitors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   if(!valid())return;
   if(op==='START_RENEWAL'&&target){setRenewal({id:target.id,version:target.version,requestId:r.requestId});setLink(r.link);}
   if(op==='VERIFY_RENEWAL'){setPaused(old=>old.filter(p=>p.id!==renewal?.id));setRenewal(null);setLink('');setNotice('Account verified. The next scheduled read will record the recovery.');}
   if(op==='CONNECT'){setLink(r.link);setRenewal(null);}
   if(op==='ACCOUNTS'){setAccounts(r.accounts);setAccount(r.accounts.find((g:Grant)=>g.canVerify)?.id??'');setSample(null);setNotice(r.accounts.length+' linked accounts.');}
   if(op==='DISCOVER'){
    setSample(null);setMapping(Object.fromEntries(profileFields(profile).map(field=>[field,r.suggestions[field]??''])));
    setNotice(Object.keys(r.suggestions).length+' field paths matched. Review the mapping and enter any missing paths.');
   }
   if(op==='PREVIEW')setSample(r);
   if(op==='APPROVE'){setSample(null);setCreated({org:organizationId,id:r.id});setNotice('Hourly monitor enabled.');}
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
  <button type="button" disabled={busy} onClick={()=>loadSchedules()}>{page?'Refresh hourly schedules':'View approved hourly schedules'}</button>
  {page&&<section aria-label="Approved hourly schedules"><h3>Approved hourly schedules</h3>
   {page.rows.length?<><p>As of {utc(page.asOf)} UTC</p><table><thead><tr><th>Product and control</th><th>Collection status</th><th>Last successful read (UTC)</th><th>Next due (UTC)</th></tr></thead>
    <tbody>{page.rows.map(row=><tr key={row.id}><td><a href={'/team/operations?'+new URLSearchParams({organizationId,view:'connections',connectionId:row.id})}>{row.product} · {row.action}</a><br/>{row.control}</td>
     <td>{row.state}{row.failureCode&&' · '+row.failureCode}</td><td>{row.lastSuccessAt?utc(row.lastSuccessAt):'Awaiting first read'}</td><td>{row.nextRunAt?utc(row.nextRunAt):'Paused'}</td></tr>)}</tbody></table>
    {page.next&&<button type="button" disabled={busy} onClick={()=>loadSchedules(page.next!)}>Next schedules</button>}</>:<p>No approved hourly product monitors in this workspace.</p>}</section>}
  <fieldset disabled={busy}><label>Find a product <input value={query} maxLength={100} onChange={e=>{clearSelection();setSelected('');setProducts([]);setQuery(e.target.value);}}/></label>
  <label>Inventory read <select value={selected} onChange={e=>{clearSelection();setSelected(e.target.value);}}>{products.map(p=><option key={p.app+'/'+p.action} value={p.app+'/'+p.action}>{p.name} · {p.action}</option>)}</select></label>
  {enabled&&current?<><button type="button" onClick={()=>operate('CONNECT')}>Authorise account</button> <button type="button" onClick={()=>operate('ACCOUNTS')}>Refresh linked accounts</button></>:<p>Hosted reads require a Pipedream Connect project in this deployment. <a href="/product-monitors/setup.txt">Set up a project</a></p>}
  {!!accounts.length&&<><label>Customer account <select value={account} onChange={e=>{setAccount(e.target.value);setSample(null);}}>{accounts.filter(g=>g.canVerify).map(g=><option key={g.id} value={g.id}>{g.name}{g.healthy?'':' · verify with a read'}</option>)}</select></label>
   <label>Checks to run hourly<select value={profile} onChange={e=>{const id=e.target.value;setProfile(id);setMapping(Object.fromEntries(profileFields(id).map(field=>[field,field])));setSample(null);}}>
    <option value="">Inventory only</option>{Object.entries(profiles).map(([id,p])=><option key={id} value={id}>{p.name} and inventory</option>)}</select></label>
   {profile&&<fieldset><legend>Source field paths for {profiles[profile].name}</legend>
    <button type="button" disabled={!account} onClick={()=>operate('DISCOVER')}>Find matching source fields</button>
    {profileFields(profile).map(field=><label key={field}>{field}<input value={mapping[field]??''} maxLength={150} onChange={e=>{setSample(null);setMapping({...mapping,[field]:e.target.value});}}/></label>)}
    <small>Use the field names returned by the product. Separate nested fields with a dot.</small></fieldset>}
   <button type="button" disabled={!account||Object.values(mapping).some(path=>!path.trim())} onClick={()=>operate('PREVIEW')}>Read sample</button></>}
  {sample&&<><p>{sample.count} unique identifiers returned. Hourly reads flag added and missing identifiers in this sample.</p>{sample.checks&&<><table><caption>Mapped checks on the returned sample</caption><thead><tr><th>Check</th><th>Result</th><th>Resources</th></tr></thead><tbody>{sample.checks.map(c=><tr key={c.id}><td>{c.label}</td><td>{c.status}</td><td>{c.observed}</td></tr>)}</tbody></table>
    {sample.observable===false&&<p>At least one rule has no observable result. Check its field paths and read the sample again.</p>}</>}
   <label>Workspace control <select value={control} onChange={e=>setControl(e.target.value)}>{controls.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label> <button type="button" disabled={!control||sample.observable===false} onClick={()=>operate('APPROVE')}>Approve sample and enable hourly monitoring</button></>}
  {!!paused.length&&<div><h3>Accounts requiring renewal</h3>{paused.map(p=><p key={p.id}>{p.repository.split(':').slice(1).join(' / ')} <button type="button" onClick={()=>operate('START_RENEWAL',p)}>Renew original account</button></p>)}</div>}
  {link&&<p><a href={link} target="_blank" rel="noreferrer">Open secure account authorisation ↗</a></p>}{renewal&&<button type="button" onClick={()=>operate('VERIFY_RENEWAL')}>Verify renewed grant</button>}
  </fieldset>{notice&&<p role="status">{notice}</p>}{created?.org===organizationId&&created&&<p><a href={'/team/operations?'+new URLSearchParams({organizationId,view:'connections',connectionId:created.id})}>View this monitor’s readings and recovery history</a></p>}{error&&<p role="alert">{error}</p>}</section>;
}
