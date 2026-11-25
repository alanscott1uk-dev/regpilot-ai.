'use client';
import {useRef,useState} from 'react';
import type {Member,Product,Request,Write} from './types';
import {identifyPortal} from '../../../lib/portal-questionnaire';
import css from './questionnaires.module.css';

type Props={organizationId:string;members:Member[];products:Product[];request:Request;write:Write;locked:boolean;onCreated:(id:string)=>Promise<void>};
export function PasteImport({organizationId,members,products,request,write,locked,onCreated}:Props){
 const key=useRef({payload:'',id:''}),[questions,setQuestions]=useState(''),[error,setError]=useState('');
 const rows=questions.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((question,index)=>({reference:'Q'+(index+1),question}));
 async function submit(form:FormData){
  if(rows.length<1||rows.length>100||rows.some(row=>row.question.length<10||row.question.length>1200)){setError('Use 1–100 questions, each between 10 and 1,200 characters.');return;}
  const address=String(form.get('portalUrl')??'').trim();
  let destination;
  try{if(address)destination=await identifyPortal(address);}catch{setError('Enter the HTTPS address of the buyer questionnaire.');return;}
  const product=form.get('product'),payload={...(destination?{portalDestination:destination}:{}),title:form.get('title'),recipient:form.get('recipient'),scope:form.get('scope'),ownerId:form.get('owner'),productIds:product?[product]:[],rows,confirm:true};
  const shape=JSON.stringify(payload);if(key.current.payload!==shape)key.current={payload:shape,id:crypto.randomUUID()};
  const requestKey=key.current.id,url='/api/workspace/questionnaires?'+new URLSearchParams({organizationId});
  setError('');
  await write({label:'Creating questionnaire',run:async()=>{
   const r=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestKey})});
   if(!r.id||!Number.isInteger(r.version))throw Error('The questionnaire acknowledgement was incomplete.');
   return r;
  },success:r=>onCreated(r.id),message:'Questions saved for review.',reconcile:async()=>{
   const {operation}=await request(url+'&requestKey='+encodeURIComponent(requestKey));
   if(operation?.kind==='IMPORT'&&operation.requestKey===requestKey)return {state:'saved',message:'The saved questionnaire is ready.',after:()=>onCreated(operation.questionnaireId)};
   return operation===null?{state:'absent',message:'No questionnaire was saved for this request.'}:{state:'pending',message:'Check the import result before repeating the request.'};
  }});
 }
 return <details className={css.support}><summary>Start from questions copied from a buyer portal or email</summary>
 <form onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}><fieldset disabled={locked} className={css.fieldset}><legend>Paste buyer questions</legend>
 <label>Questions, one per line<textarea required rows={6} maxLength={120100} value={questions} onChange={e=>setQuestions(e.target.value)}/></label>
 <p aria-live="polite">{rows.length} questions · Existing approved answers will be suggested for review.</p>
 <div className={css.formGrid}><label>Questionnaire title<input name="title" minLength={3} maxLength={160} required/></label>
 <label>Original buyer portal URL (optional)<input name="portalUrl" type="url" maxLength={3000} placeholder="https://…"/></label>
 <label>Buyer or recipient<input name="recipient" minLength={2} maxLength={160} required/></label><label>Scope of the answers<input name="scope" minLength={2} maxLength={120} required/></label>
 <label>Question owner<select aria-label="Question owner" name="owner" required defaultValue=""><option value="">Choose a colleague</option>{members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}</select></label>
 <label>Product covered<select aria-label="Product covered" name="product"><option value="">General questionnaire</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
 <label><input type="checkbox" required/>I checked the questions, recipient, product and scope.</label>
 {error&&<p role="alert">{error}</p>}<button disabled={rows.length<1||rows.length>100}>Create questionnaire from {rows.length} {rows.length===1?'question':'questions'}</button>
 </fieldset></form></details>;
}
