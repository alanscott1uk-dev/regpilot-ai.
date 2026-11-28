"use client";
import {useState} from 'react';
import ui from './operations.module.css';
type Control={id:string;version:number;title:string;enabled:boolean;owner:{email:string}};
type Link={id:string;controlId:string;rationale:string;control:{title:string;enabled:boolean;owner:{email:string}}};
export function ConnectorControls({connection,controls,admin,busy,enabled,onChange}:{connection:{id:string;version:number;controlId:string;controlLinks?:Link[]};controls:Control[];admin:boolean;busy:boolean;enabled:boolean;onChange:(payload:Record<string,unknown>)=>void}){
 const links=connection.controlLinks||[],primary=controls.find(c=>c.id===connection.controlId),[selected,setSelected]=useState(''),[confirm,setConfirm]=useState(false),[removing,setRemoving]=useState('');
 const available=controls.filter(c=>c.enabled&&c.id!==connection.controlId&&!links.some(l=>l.controlId===c.id));
 return <details className={ui.coverage}><summary>Evidence used by {1+links.length} control{links.length?'s':''}</summary>
  <p>Collect once and reuse the observation. Each control keeps its own owner, follow-up work and independent review.</p>
  <p><strong>{primary?.title||'Responsible control'}</strong> · Connection owner{primary?' · '+primary.owner.email:''}</p>
  {links.map(link=><div key={link.id} className={ui.review}><strong>{link.control.title}</strong><p>{link.control.owner.email} · {link.control.enabled?'Active control':'Paused control'}</p><p>{link.rationale}</p>
   {admin&&(removing===link.id?<><p>Remove evidence reuse for this control? Existing tasks and review history stay recorded. Submissions using this link will need fresh evidence.</p><div className={ui.buttons}><button disabled={busy||!enabled} onClick={()=>onChange({action:'UNLINK',version:connection.version,linkId:link.id,confirm:true})}>Confirm removal</button><button disabled={busy} onClick={()=>setRemoving('')}>Keep link</button></div></>:<button disabled={busy||!enabled} onClick={()=>setRemoving(link.id)}>Remove evidence link</button>)}
  </div>)}
  {admin&&<form aria-label="Reuse connected evidence" className={ui.formGrid} onSubmit={e=>{e.preventDefault();const control=available.find(c=>c.id===selected);if(!control)return;onChange({action:'LINK',version:connection.version,controlId:control.id,controlVersion:control.version,rationale:new FormData(e.currentTarget).get('rationale'),confirm:true});}}>
   <label className={ui.full}>Additional control<select aria-label="Additional control" value={selected} onChange={e=>{setSelected(e.target.value);setConfirm(false);}} required disabled={busy||!enabled||links.length>=20}><option value="">Choose a control</option>{available.map(c=><option key={c.id} value={c.id}>{c.title} · {c.owner.email}</option>)}</select></label>
   <label className={ui.full}>Why this evidence supports the control<textarea name="rationale" required minLength={30} maxLength={1200} rows={3} disabled={busy||!enabled}/></label>
   <label className={ui.check}><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} disabled={busy||!enabled}/>I checked the relevance and limitations for this control.</label>
   <button disabled={busy||!enabled||!selected||!confirm||links.length>=20}>Reuse evidence for this control</button>
   <p className={ui.hint}>No additional credential or provider request. Up to twenty additional controls per connection. Linking evidence does not approve compliance.</p>
  </form>}
 </details>;
}
