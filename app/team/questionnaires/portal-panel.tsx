'use client';
import {ManualCapture,CopyAnswers,type CopyReceipt} from './manual-portal';
import {portalBridge} from '../../../lib/client/portal-bridge';
import {useEffect,useState} from 'react';
import {portalFields,mapPortalFields,type PortalFields} from '../../../lib/portal-questionnaire';
import type {Detail,RawRequest} from './types';
import css from './questionnaires.module.css';

export default function PortalPanel({detail,organizationId,requestResponse,capture,locked}:{detail:Detail;organizationId:string;requestResponse:RawRequest;capture:()=>()=>boolean;locked:boolean}){
 const [page,setPage]=useState<PortalFields|null>(null),[chosen,select]=useState<string[]>([]),[confirmed,confirm]=useState(false),[error,tell]=useState(''),[busy,lock]=useState(false);
 const [nonce,pair]=useState(''),questionnaireId=detail.questionnaire.id;
 async function connect(){
  if(locked||busy)return;
  const valid=capture(),next=crypto.randomUUID();lock(true);tell('');
  try{await portalBridge({action:'PAIR',organizationId,questionnaireId,nonce:next,title:detail.questionnaire.title});if(valid()){setPage(null);setManual(false);setCopied(null);select([]);confirm(false);pair(next);tell('Open the helper on the buyer page and choose Send field labels for review.');}}
  catch(e){if(valid())tell(e instanceof Error?e.message:'Pairing failed.');}finally{if(valid())lock(false);}
 }
 useEffect(()=>{
  if(!nonce||page)return;
  let active=true,pending=false;
  async function receive(){
   if(!active||pending||document.visibilityState!=='visible')return;
   pending=true;
   try{const reply=await portalBridge({action:'READ',organizationId,questionnaireId,nonce});if(active&&reply.capture){setPage(portalFields.parse(reply.capture));tell('Select the approved answers to send to the buyer tab.');}}
   catch(e){if(active){pair('');tell(e instanceof Error?e.message:'Pair again to receive the questions.');}}finally{pending=false;}
  }
  void receive();window.addEventListener('focus',receive);const timer=window.setInterval(receive,3000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',receive);};
 },[nonce,page,organizationId,questionnaireId]);
 const [manual,setManual]=useState(false),[copied,setCopied]=useState<CopyReceipt|null>(null);
 const mappings=page?mapPortalFields(page,detail.questions.map(q=>({reference:q.reference,question:q.question,answer:q.answer||'',evidence:q.files.flatMap(f=>f.sha256?[{filename:f.filename,sha256:f.sha256}]:[]),product:q.productId?{id:q.productId,name:q.productName||q.productId}:null}))):[];
 async function load(file:File|undefined){
  const valid=capture();pair('');setManual(false);setCopied(null);setPage(null);select([]);confirm(false);tell('');
  if(!file)return;
  try{if(file.size>105000)throw Error('Choose a field capture under 105 KB.');const v=portalFields.parse(JSON.parse(await file.text()));if(valid())setPage(v);}catch{if(valid())tell('Choose a valid questionnaire field capture from the portal helper.');}
 }
 async function issue(){
  if(!page||!confirmed||!chosen.length||locked||busy)return;const valid=capture();lock(true);tell('');
  try{const r=await requestResponse('/api/workspace/questionnaires/'+detail.questionnaire.id+'/portal?'+new URLSearchParams({organizationId}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:detail.questionnaire.version,capture:page,labels:chosen,confirm:true,...(manual?{delivery:'MANUAL_COPY'}:{})})});const ticket=await r.json();if(!valid())return;
   if(manual){
    const redeemed=await requestResponse('/api/portal/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handoffId:ticket.handoffId,secret:ticket.secret,capture:page})});
    const content=await redeemed.json();if(!valid())return;
    if(content.origin!==page.origin||content.pageHash!==page.pageHash||!Array.isArray(content.fields)||content.fields.length!==chosen.length||content.fields.some((f:{label:string;answer:string})=>!chosen.includes(f.label)||typeof f.answer!=='string'))throw Error('The approved answers changed. Prepare the selection again.');
    setCopied(content);confirm(false);tell('Use the copy buttons for the reviewed buyer questions.');return;
   }
   if(nonce){await portalBridge({action:'DELIVER',organizationId,questionnaireId,nonce,ticket});if(valid()){confirm(false);tell('Open the helper on the original buyer tab to fill the reviewed blank fields.');}return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify({...ticket,regpilotOrigin:location.origin})],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='regpilot-portal-handoff.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('Open the hand-off in the helper on the original buyer page within ten minutes.');confirm(false);
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Could not issue the hand-off.');}finally{if(valid())lock(false);}
 }
 return <details className={css.support}><summary className={css.sectionToggle}>Complete a buyer’s online questionnaire</summary><ManualCapture disabled={locked||busy||!detail.current} onError={tell} onCapture={v=>{pair('');setManual(true);setCopied(null);setPage(v);select([]);confirm(false);tell('');}}/><p>To fill blank fields on the buyer’s page, pair this questionnaire and open the helper there.</p><button type="button" disabled={locked||busy||!detail.current} onClick={()=>void connect()}>{nonce?'Pair again':'Pair this questionnaire'}</button><details><summary>Install the Chrome or Edge helper</summary><p>Download and unzip the helper. In your browser’s extensions page, enable developer mode, choose Load unpacked and select the unzipped folder. Refresh RegPilot after installation.</p><a href="/api/tools/portal-helper">Download portal helper</a></details><details><summary>Use a field capture file</summary><label>Captured portal fields<input type="file" accept=".json" disabled={locked||busy} onChange={e=>void load(e.target.files?.[0])}/></label></details>
 {page&&<><h4>Review the mapping for {page.origin}</h4>{mappings.map((m,i)=><div key={i}>{m.match?<><label><input type="checkbox" checked={chosen.includes(m.label)} disabled={busy||locked} onChange={e=>{confirm(false);setCopied(null);select(e.target.checked?[...chosen,m.label]:chosen.filter(l=>l!==m.label));}}/>{m.label}</label><p>{m.match.reference} · {m.match.product||'General scope'} · {m.match.answer}</p>{m.match.evidence.map(f=><p key={f.sha256}>{f.filename} · {f.sha256}</p>)}</>:<p>{m.label} · {m.reason} · left blank</p>}</div>)}<label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I independently checked the destination, questions, product scope, answers and citations.</label><button type="button" disabled={locked||busy||!confirmed||!chosen.length||!detail.current} onClick={()=>void issue()}>{manual?'Prepare answers for manual entry':nonce?'Send approved answers to buyer tab':'Issue one-time portal hand-off'}</button></>}{copied&&<CopyAnswers receipt={copied}/>} {error&&<p role="status">{error}</p>}</details>;
}
