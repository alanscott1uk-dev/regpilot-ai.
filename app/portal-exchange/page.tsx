'use client';
import {useEffect,useRef,useState} from 'react';
import {portalFields,type PortalFields} from '../../lib/portal-questionnaire';

export default function PortalExchange(){
 const [capture,setCapture]=useState<PortalFields|null>(null),[notice,setNotice]=useState(''),[used,setUsed]=useState(false),[busy,setBusy]=useState(false);
 const bound=useRef<PortalFields|null>(null),pending=useRef(false),delivered=useRef(false);
 useEffect(()=>{
  const nonce=location.hash.slice(1);
  if(!window.opener||!/^[-a-f0-9]{36}$/.test(nonce)){setNotice('Open this window from the RegPilot bookmark on the buyer form.');return;}
  function receive(event:MessageEvent){
   if(event.source!==window.opener||!event.source||event.data?.nonce!==nonce)return;
   if(event.data.type==='regpilot-buyer-capture'){
    const checked=portalFields.safeParse(event.data.capture);
    if(!checked.success||event.origin!==checked.data.origin)return;
    if(bound.current&&JSON.stringify(bound.current)!==JSON.stringify(checked.data))return;
    bound.current=checked.data;setCapture(checked.data);
    window.opener.postMessage({type:'regpilot-buyer-ready',nonce},event.origin);
   }
   if(event.data.type==='regpilot-buyer-result'&&delivered.current&&event.origin===bound.current?.origin){
    if(Number.isInteger(event.data.filled))setNotice('Filled '+event.data.filled+' reviewed field'+(event.data.filled===1?'':'s')+'. Return to the buyer form to check and submit it.');
    else setNotice('The buyer form could not be filled. '+String(event.data.error??'Review its questions again.').slice(0,200));
   }
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[]);
 async function send(form:HTMLFormElement){
  if(!capture||pending.current||delivered.current)return;
  const code=String(new FormData(form).get('ticket')??'').trim();
  const match=/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(code);
  if(!match){setNotice('Paste the full pairing code from your questionnaire.');return;}
  pending.current=true;setBusy(true);
  try{
   const response=await fetch('/api/portal/redeem',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
    body:JSON.stringify({handoffId:match[1],secret:match[2],capture,delivery:'BUYER_BOOKMARK'})});
   if(!response.ok)throw Error('The code expired, the approval changed, or the buyer page does not match. Prepare a fresh code in RegPilot.');
   const result=await response.json();
   if(!window.opener||window.opener.closed||result.origin!==capture.origin||result.pageHash!==capture.pageHash||!Array.isArray(result.fields))throw Error('Reopen the original buyer page and prepare a fresh code.');
   delivered.current=true;form.reset();setUsed(true);setNotice('Waiting for the buyer form to confirm the fill.');
   window.opener.postMessage({type:'regpilot-buyer-answers',nonce:location.hash.slice(1),expiresAt:result.expiresAt,
    fields:result.fields.map((f:{label:string;answer:string})=>({label:f.label,answer:f.answer}))},capture.origin);
  }catch(e){setNotice(e instanceof Error?e.message:'Could not retrieve the reviewed answers.');}
  finally{pending.current=false;setBusy(false);}
 }
 return <main style={{maxWidth:'36rem',margin:'3rem auto',padding:'0 1rem'}}><h1>Fill a buyer questionnaire</h1>
 {capture?<><p>Destination <strong>{capture.origin}</strong> · {capture.fields.length} form questions.</p>
 <form onSubmit={e=>{e.preventDefault();void send(e.currentTarget);}}><label>One-time pairing code<input name="ticket" type="password" autoComplete="off" required maxLength={90} disabled={used||busy}/></label><button disabled={used||busy}>Fill approved fields</button></form></>:<p>Waiting for the original buyer tab.</p>}
 <p role="status">{notice}</p>{used&&<button onClick={()=>window.close()}>Return to buyer form</button>}</main>;
}
