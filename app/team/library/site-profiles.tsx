'use client';
import {useState} from 'react';
import {factDefinitions} from '../../../lib/library/facts';
import {siteNations,siteFactKeys,type SiteProfile} from '../../../lib/library/site-facts';

export default function SiteProfiles({sites,version,disabled,save}:{sites:SiteProfile[];version:number;disabled:boolean;save:(body:Record<string,unknown>)=>Promise<void>}){
 const [id,select]=useState(''),[name,setName]=useState(''),[nation,setNation]=useState(''),[facts,setFacts]=useState<SiteProfile['facts']>({}),[busy,lock]=useState(false),[message,tell]=useState('');
 function open(siteId:string){
  const site=sites.find(s=>s.id===siteId);select(siteId);setName(site?.name??'');setNation(site?.nation??'');setFacts(site?.facts??{});tell('');
 }
 async function submit(archive=false){
  lock(true);tell('');
  try{await save({version,requestKey:crypto.randomUUID(),...(archive?{action:'ARCHIVE',siteId:id}:{action:'SAVE',site:{id:id||crypto.randomUUID(),name:name.trim(),nation,facts}})});}
  catch(e){tell(e instanceof Error?e.message:'Unable to update the site register.');}
  finally{lock(false);}
 }
 return <details><summary>Manage site facts ({sites.length}/12)</summary><p>Each site has its own activities and UK nation. Workforce, turnover, VAT registration and company status come from the organisation profile.</p>
 <form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={disabled||busy}><legend>Site profile</legend>
 <label>Site <select value={id} onChange={e=>open(e.target.value)}><option value="">New site</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>Site name <input required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>UK nation <select required value={nation} onChange={e=>setNation(e.target.value)}><option value="">Choose a nation</option>{siteNations.map(n=><option key={n}>{n}</option>)}</select></label>
 {siteFactKeys.map(k=><label key={k}>{factDefinitions[k].label} <select value={facts[k]==null?'':String(facts[k])} onChange={e=>setFacts({...facts,[k]:e.target.value===''?null:e.target.value==='true'})}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>)}
 <button disabled={!id&&sites.length>=12}>Save site facts</button>{id&&<details><summary>Archive this site</summary><p>Archiving removes the site from future comparisons. Its earlier register revisions remain recorded.</p><button type="button" onClick={()=>void submit(true)}>Archive {sites.find(s=>s.id===id)?.name}</button></details>}
 </fieldset></form>{message&&<p role="alert">{message}</p>}</details>;
}
