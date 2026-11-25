'use client';
import {useEffect,useState} from 'react';
import {portalFields,type PortalFields} from '../../../lib/portal-questionnaire';

export function ManualCapture({disabled,onCapture,onError}:{disabled:boolean;onCapture:(page:PortalFields)=>void;onError:(s:string)=>void}){
 async function prepare(form:FormData){
  try{
   const url=new URL(String(form.get('address')));
   if(url.protocol!=='https:'||url.username||url.password)throw Error('Enter the HTTPS address of the buyer’s questionnaire.');
   const fields=String(form.get('questions')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url.href));
   onCapture(portalFields.parse({format:'regpilot-portal-fields-v1',origin:url.origin,pageHash:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),fields}));
  }catch{onError('Enter an HTTPS buyer address and one question per line. Use up to 100 questions of 3–600 characters each.');}
 }
 return <details open><summary>Complete a buyer portal without installing the helper</summary>
  <form onSubmit={e=>{e.preventDefault();void prepare(new FormData(e.currentTarget));}}><fieldset disabled={disabled}><legend>Review questions copied from the buyer</legend>
   <label>Buyer questionnaire URL<input name="address" type="url" required maxLength={3000} placeholder="https://…"/></label>
   <label>Buyer questions, one per line<textarea name="questions" required rows={4} maxLength={60100}/></label>
   <button>Find approved answers</button></fieldset></form></details>;
}
export type CopyReceipt={origin:string;expiresAt:string;fields:{label:string;answer:string}[]};
export function CopyAnswers({receipt}:{receipt:CopyReceipt}){
 const [expired,setExpired]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{setExpired(false);const timer=setTimeout(()=>setExpired(true),Math.max(0,Date.parse(receipt.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[receipt]);
 if(expired||Date.now()>=Date.parse(receipt.expiresAt))return <p>The copy window has ended. Review the destination and prepare a fresh set of answers.</p>;
 return <section aria-label="Approved answers for manual entry"><h4>Copy approved answers to {receipt.origin}</h4>
 {receipt.fields.map(field=><div key={field.label}><label>{field.label}<textarea readOnly value={field.answer} onFocus={e=>e.currentTarget.select()}/></label>
 <button type="button" onClick={async()=>{if(Date.now()>=Date.parse(receipt.expiresAt)){setExpired(true);return;}try{await navigator.clipboard.writeText(field.answer);setNotice('Copied the answer for '+field.label);}catch{setNotice('Select the answer text and use your browser’s Copy command.');}}}>Copy answer for {field.label}</button></div>)}
 <p role="status">{notice}</p></section>;
}
