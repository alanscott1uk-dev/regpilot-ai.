'use client';
import {useState} from 'react';
import {portalFields,mapPortalFields,type PortalFields} from '../../../lib/portal-questionnaire';
import type {Detail,RawRequest} from './types';
import css from './questionnaires.module.css';

export default function PortalPanel({detail,organizationId,requestResponse,capture,locked}:{detail:Detail;organizationId:string;requestResponse:RawRequest;capture:()=>()=>boolean;locked:boolean}){
 const [page,setPage]=useState<PortalFields|null>(null),[chosen,select]=useState<string[]>([]),[confirmed,confirm]=useState(false),[error,tell]=useState(''),[busy,lock]=useState(false);
 const mappings=page?mapPortalFields(page,detail.questions.map(q=>({reference:q.reference,question:q.question,answer:q.answer||'',evidence:q.files.flatMap(f=>f.sha256?[{filename:f.filename,sha256:f.sha256}]:[]),product:q.productId?{id:q.productId,name:q.productName||q.productId}:null}))):[];
 async function load(file:File|undefined){
  const valid=capture();setPage(null);select([]);confirm(false);tell('');
  if(!file)return;
  try{if(file.size>105000)throw Error('Choose a field capture under 105 KB.');const v=portalFields.parse(JSON.parse(await file.text()));if(valid())setPage(v);}catch{if(valid())tell('Choose a valid questionnaire field capture from the portal helper.');}
 }
 async function issue(){
  if(!page||!confirmed||!chosen.length||locked||busy)return;const valid=capture();lock(true);tell('');
  try{const r=await requestResponse('/api/workspace/questionnaires/'+detail.questionnaire.id+'/portal?'+new URLSearchParams({organizationId}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:detail.questionnaire.version,capture:page,labels:chosen,confirm:true})});const ticket=await r.json();if(!valid())return;
   const url=URL.createObjectURL(new Blob([JSON.stringify({...ticket,regpilotOrigin:location.origin})],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='regpilot-portal-handoff.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('Open the hand-off in the helper on the original buyer page within ten minutes.');confirm(false);
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Could not issue the hand-off.');}finally{if(valid())lock(false);}
 }
 return <details className={css.support}><summary className={css.sectionToggle}>Complete a buyer’s online questionnaire</summary><p>Download and unzip the Chrome or Edge helper. Use Load unpacked in your browser’s extensions page, then capture the fields on the buyer’s authorised questionnaire. The buyer portal keeps its own final submission step.</p><a href="/api/tools/portal-helper">Download portal helper</a><label>Captured portal fields<input type="file" accept=".json" disabled={locked||busy} onChange={e=>void load(e.target.files?.[0])}/></label>
 {page&&<><h4>Review the mapping for {page.origin}</h4>{mappings.map((m,i)=><div key={i}>{m.match?<><label><input type="checkbox" checked={chosen.includes(m.label)} onChange={e=>{confirm(false);select(e.target.checked?[...chosen,m.label]:chosen.filter(l=>l!==m.label));}}/>{m.label}</label><p>{m.match.reference} · {m.match.product||'General scope'} · {m.match.answer}</p>{m.match.evidence.map(f=><p key={f.sha256}>{f.filename} · {f.sha256}</p>)}</>:<p>{m.label} · {m.reason} · left blank</p>}</div>)}<label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I independently checked the destination, questions, product scope, answers and citations.</label><button type="button" disabled={locked||busy||!confirmed||!chosen.length||!detail.current} onClick={()=>void issue()}>Issue one-time portal hand-off</button></>}{error&&<p role="status">{error}</p>}</details>;
}
