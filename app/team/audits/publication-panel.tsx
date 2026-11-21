'use client';
import {useEffect,useState} from 'react';
import {auditRequest,type Serial} from './audit-session';
import type {trustPublicationAdmin} from '../../../lib/server/trust-publication';
import styles from '../operations/operations.module.css';

type View=Serial<Awaited<ReturnType<typeof trustPublicationAdmin>>>;
export default function PublicationPanel({orgId,roomId,manifestHash}:{orgId:string;roomId:string;manifestHash:string}){
 const url='/api/workspace/trust/'+roomId+'?'+new URLSearchParams({organizationId:orgId});
 const [data,change]=useState<View|null>(null),[title,setTitle]=useState(''),[summary,setSummary]=useState(''),[busy,lock]=useState(false),[message,tell]=useState('');
 useEffect(()=>{let live=true;void auditRequest(url).then(v=>{if(live){change(v);setTitle(v.publicTitle||'');setSummary(v.publicSummary||'');}}).catch(e=>{if(live)tell(e.message);});return()=>{live=false;};},[url]);
 async function save(body:Record<string,unknown>){
  if(!data||busy)return;lock(true);tell('');
  try{await auditRequest(url,{...body,revision:data.publicRevision});const v:View=await auditRequest(url);change(v);setTitle(v.publicTitle||'');setSummary(v.publicSummary||'');tell('Saved.');}
  catch(e){tell(e instanceof Error?e.message:'Could not save the publication.');}finally{lock(false);}
 }
 return <section className={styles.card}><h3>Public trust summary</h3><p>Choose the name and claim buyers can find. They need named approval to open the evidence. Revising or withdrawing the summary revokes access granted through that publication.</p>
 {data&&<><form className={styles.formGrid} onSubmit={e=>{e.preventDefault();void save({action:'PUBLISH',title,summary,manifestHash,confirm:true});}}>
 <label>Public title<input required minLength={4} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Public summary<textarea required minLength={20} maxLength={600} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
 <label><input key={data.publicRevision} type="checkbox" required/> I approve publishing this exact wording to the public directory.</label>
 <button disabled={busy}>{data.publicTitle?'Publish revision':'Publish summary'}</button></form>
 {data.publicTitle&&<p><a href={'/trust/directory?id='+data.publicKey}>View public summary</a> · <button disabled={busy} onClick={()=>void save({action:'WITHDRAW',confirm:true})}>Withdraw summary and buyer access</button></p>}
 {data.requests.length>0&&<div><h4>Named access requests</h4>{data.requests.map(r=><div key={r.id}><strong>{r.email}</strong> <button disabled={busy} onClick={()=>void save({action:'APPROVE',grantId:r.id,grantVersion:r.version})}>Approve access</button> <button disabled={busy} onClick={()=>void save({action:'DENY',grantId:r.id,grantVersion:r.version})}>Decline</button></div>)}</div>}</>}
 {message&&<p role="status">{message}</p>}</section>;
}
