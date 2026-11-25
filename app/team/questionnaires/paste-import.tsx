'use client';
import {useEffect,useRef,useState} from 'react';
import type {Member,Product,Request,Write} from './types';
import {portalBridge} from '../../../lib/client/portal-bridge';
import {identifyPortal,portalFields,type PortalFields} from '../../../lib/portal-questionnaire';
import css from './questionnaires.module.css';

type Props={capture:()=>()=>boolean;organizationId:string;members:Member[];products:Product[];request:Request;write:Write;locked:boolean;onCreated:(id:string)=>Promise<void>};
export function PasteImport({capture,organizationId,members,products,request,write,locked,onCreated}:Props){
 const key=useRef({payload:'',id:''}),[questions,setQuestions]=useState(''),[error,setError]=useState('');
 const [nonce,setNonce]=useState(''),[buyer,setBuyer]=useState<PortalFields|null>(null),[reading,setReading]=useState(false);
 useEffect(()=>{setNonce(/^#portal-import=([a-f0-9-]{36})$/i.exec(location.hash)?.[1]??'');},[]);
 async function receive(){
  const valid=capture();setReading(true);setError('');
  try{const reply=await portalBridge({action:'READ_IMPORT',organizationId,nonce}),page=portalFields.parse(reply.capture);
   if(valid()){setBuyer(page);setQuestions(page.fields.join('\n'));}
  }catch(e){if(valid())setError(e instanceof Error?e.message:'Reopen the buyer page in the helper.');}finally{if(valid())setReading(false);}
 }
 const rows=questions.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((question,index)=>({reference:'Q'+(index+1),question}));
 async function submit(form:FormData){
  if(rows.length<1||rows.length>100||rows.some(row=>row.question.length<10||row.question.length>1200)){setError('Use 1–100 questions, each between 10 and 1,200 characters.');return;}
  const address=String(form.get('portalUrl')??'').trim();
  let destination;
  try{if(buyer)destination={origin:buyer.origin,pageHash:buyer.pageHash};else if(address)destination=await identifyPortal(address);}catch{setError('Enter the HTTPS address of the buyer questionnaire.');return;}
  const product=form.get('product'),payload={...(destination?{portalDestination:destination}:{}),title:form.get('title'),recipient:form.get('recipient'),scope:form.get('scope'),ownerId:form.get('owner'),productIds:product?[product]:[],rows,confirm:true};
  const shape=JSON.stringify(payload);if(key.current.payload!==shape)key.current={payload:shape,id:crypto.randomUUID()};
  const requestKey=key.current.id,url='/api/workspace/questionnaires?'+new URLSearchParams({organizationId});
  const valid=capture();
  async function created(id:string){
   if(!valid())return;
   if(buyer&&nonce){
    try{await portalBridge({action:'IMPORT_SAVED',organizationId,questionnaireId:id,nonce,title:payload.title});}
    catch{if(valid())setError('The questions were saved. Pair the buyer tab again when the answers are approved.');}
   }
   if(valid())await onCreated(id);
  }
  setError('');
  await write({label:'Creating questionnaire',run:async()=>{
   const r=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestKey})});
   if(!r.id||!Number.isInteger(r.version))throw Error('The questionnaire acknowledgement was incomplete.');
   return r;
  },success:r=>created(r.id),message:'Questions saved for review.',reconcile:async()=>{
   const {operation}=await request(url+'&requestKey='+encodeURIComponent(requestKey));
   if(operation?.kind==='IMPORT'&&operation.requestKey===requestKey)return {state:'saved',message:'The saved questionnaire is ready.',after:()=>created(operation.questionnaireId)};
   return operation===null?{state:'absent',message:'No questionnaire was saved for this request.'}:{state:'pending',message:'Check the import result before repeating the request.'};
  }});
 }
 return <details className={css.support} open={nonce?true:undefined}><summary>{nonce?'Start from the buyer tab':'Start from questions copied from a buyer portal or email'}</summary>
 {nonce&&!buyer&&<button type="button" disabled={reading||locked} onClick={()=>void receive()}>Use buyer questions in this workspace</button>}
 {buyer&&<p>Captured {buyer.fields.length} field labels from {buyer.origin}. Review the wording, owner and recipient below.</p>}
 <form onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}><fieldset disabled={locked} className={css.fieldset}><legend>Paste buyer questions</legend>
 <label>Questions, one per line<textarea required rows={6} maxLength={120100} value={questions} onChange={e=>setQuestions(e.target.value)}/></label>
 <p aria-live="polite">{rows.length} questions · Existing approved answers will be suggested for review.</p>
 <div className={css.formGrid}><label>Questionnaire title<input name="title" minLength={3} maxLength={160} required/></label>
 {!buyer&&<label>Original buyer portal URL (optional)<input name="portalUrl" type="url" maxLength={3000} placeholder="https://…"/></label>}
 <label>Buyer or recipient<input name="recipient" minLength={2} maxLength={160} required/></label><label>Scope of the answers<input name="scope" minLength={2} maxLength={120} required/></label>
 <label>Question owner<select aria-label="Question owner" name="owner" required defaultValue=""><option value="">Choose a colleague</option>{members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}</select></label>
 <label>Product covered<select aria-label="Product covered" name="product"><option value="">General questionnaire</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
 <label><input type="checkbox" required/>I checked the questions, recipient, product and scope.</label>
 {error&&<p role="alert">{error}</p>}<button disabled={rows.length<1||rows.length>100}>Create questionnaire from {rows.length} {rows.length===1?'question':'questions'}</button>
 </fieldset></form></details>;
}
