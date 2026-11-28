'use client';
import {useEffect,useRef,useState} from 'react';
import {transferSchema,type CaseEmailRecord,type OutlookTransfer} from '../../../lib/quality-email';
import {workspaceHref} from '../../../lib/client/workspace-context';
import css from './quality.module.css';

type Props={
 org:string;caseId:string;title:string;version:number;editable:boolean;records:CaseEmailRecord[];actions:{task:{id:string;title:string}}[];
 request:(path:string,options?:RequestInit)=>Promise<any>;capture:()=>()=>boolean;onSaved:()=>void;
};
export default function EmailCorrespondence({org,caseId,title,version,editable,records,actions,request,capture,onSaved}:Props){
 const [draft,setDraft]=useState<OutlookTransfer|null>(null),[task,setTask]=useState(''),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(false);
 const active=useRef(true),sending=useRef(false),sequence=useRef(0),key=useRef(''),requested=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current++;};},[]);
 function preview(value:unknown){
  const parsed=transferSchema.safeParse(value);
  if(!parsed.success)throw Error('Choose a RegPilot Outlook transfer with a valid message and up to three PDF or Word attachments.');
  setDraft(parsed.data);key.current=crypto.randomUUID();setTask('');setConfirmed(false);setNotice('');
 }
 useEffect(()=>{
  function receive(e:MessageEvent){
   if(!editable||!requested.current||e.origin!==window.location.origin||!window.opener||e.source!==window.opener||e.data?.type!=='regpilot-selected-mail')return;
   requested.current=false;sequence.current++;
   try{preview(e.data.transfer);}catch(error){setNotice((error as Error).message);}
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[editable]);
 async function choose(file?:File){
  if(sending.current)return;
  const turn=++sequence.current;requested.current=false;setDraft(null);setConfirmed(false);setNotice('');
  if(!file)return;
  try{
   if(file.size>2_850_000)throw Error('Choose a transfer file smaller than 2.85 MB.');
   const json=JSON.parse(await file.text());if(active.current&&sequence.current===turn)preview(json);
  }catch(error){if(active.current&&sequence.current===turn)setNotice(error instanceof SyntaxError?'This file is not a RegPilot Outlook transfer.':(error as Error).message);}
 }
 async function save(){
  if(!draft||!confirmed||sending.current||!editable||(draft.files.length>0&&!actions.some(a=>a.task.id===task)))return;
  sending.current=true;setBusy(true);setNotice('');requested.current=false;
  const valid=capture(),files:CaseEmailRecord['files']=[];let uploaded=0;
  try{
   for(const attachment of draft.files){
    if(!valid()||!active.current)return;
    const bytes=Uint8Array.from(atob(attachment.base64),c=>c.charCodeAt(0));
    const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(!valid()||!active.current)return;
    const form=new FormData();form.set('organizationId',org);form.set('obligationId',task);form.set('reuseExactUpload','true');
    form.set('file',new File([bytes],attachment.name));
    const {evidence}=await request('/api/workspace/evidence',{method:'POST',body:form});
    if(evidence?.organizationId!==org||evidence.obligationId!==task||evidence.sha256!==expected||evidence.scanStatus!=='CLEAN')throw Error('The scanned attachment receipt did not match the selected file.');
    files.push({id:evidence.id,filename:evidence.filename,sha256:evidence.sha256});uploaded++;
   }
   if(!valid()||!active.current)return;
   const result=await request('/api/workspace/quality',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({organizationId:org,action:'RECORD_EMAIL',caseId,requestKey:key.current,version,source:draft.source,taskId:files.length?task:null,files})});
   if(result.caseId!==caseId)throw Error('The saved receipt did not match this quality case.');
   if(active.current&&valid())onSaved();
  }catch(error){
   if(active.current&&valid())setNotice((error as Error).message+(uploaded?' Scanned files already received stay on the selected task. Retrying the same files reuses them.':''));
  }finally{sending.current=false;if(active.current)setBusy(false);}
 }
 return <details className={css.section} id="quality-correspondence"><summary>Email correspondence{records.length?' ('+records.length+')':''}</summary>
  {records.map(item=><article key={item.key} className={css.stockNotice}><h4>{item.source.subject}</h4>
   <p>From {item.source.sender} · Outlook item created {new Date(item.source.createdAt).toLocaleString('en-GB')}</p>
   <p>Recorded {new Date(item.at).toLocaleString('en-GB')} · Cycle {item.cycle}</p>
   {item.source.excerpt&&<blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.source.excerpt}</blockquote>}
   <p style={{overflowWrap:'anywhere'}}>Message ID · {item.source.messageId}</p>
   {item.files.map(file=><p key={file.id}><a href={workspaceHref('/team/evidence',org,{taskId:item.taskId!,evidenceId:file.id})}>{file.filename}</a></p>)}
  </article>)}
  {editable&&<fieldset className={css.stockForm} disabled={busy}><legend>Save an Outlook email to this case</legend>
   <p>This saves the operator’s selected copy of the correspondence. The sender address is taken from the transfer.</p>
   <p>In Outlook, open the message and select RegPilot. Choose the text and attachments, then prepare the transfer.</p>
   <button type="button" onClick={()=>{
    if(!window.opener){setNotice('Choose the transfer file downloaded from Outlook below.');return;}
    requested.current=true;setNotice('Waiting for Outlook. If nothing arrives, choose the transfer file below.');
    window.opener.postMessage({type:'regpilot-request-mail'},window.location.origin);
   }}>Receive from Outlook</button>
   <label>Outlook transfer file<input type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void choose(f);}}/></label>
   <a href="/api/tools/outlook-manifest" download>Download Outlook add-in manifest</a>
   <p>For a test mailbox, install the manifest as a custom Outlook add-in. Your Microsoft 365 administrator can assign it to a test group.</p>
   {draft&&<><h4>Review email before saving</h4><p><strong>{draft.source.subject}</strong> · {draft.source.sender}</p>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft.source.excerpt||'Message metadata only.'}</p>
    {draft.files.length>0&&<><ul>{draft.files.map((f,i)=><li key={i}>{f.name}</li>)}</ul>
     <label>Case action for attachments<select aria-label="Case action for attachments" value={task} onChange={e=>{setTask(e.target.value);setConfirmed(false);key.current=crypto.randomUUID();}}>
      <option value="">Choose a linked action</option>{actions.map(a=><option key={a.task.id} value={a.task.id}>{a.task.title}</option>)}</select></label>
     {!actions.length&&<p>Add a corrective or preventive action to this case first, or prepare the email without attachments.</p>}
     <p>RegPilot scans the files and sends new attachments to the evidence library for review.</p></>}
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Save this selection to {title}</label>
    <button type="button" disabled={!confirmed||!!draft.files.length&&!task} onClick={()=>void save()}>{busy?'Saving email…':'Save email to this case'}</button>
   </>}
  </fieldset>}
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
