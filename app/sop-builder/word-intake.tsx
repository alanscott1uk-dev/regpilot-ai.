'use client';
import {useEffect,useRef,useState} from 'react';
import EmailSignIn from '../components/email-sign-in';
import OfficeReceive from '../components/office-receive';
import {ReviewHandoff,type ExportedSop} from './review-handoff';
import type {useWorkspaceContext} from '../../lib/client/workspace-context';
export default function WordIntake({workspace}:{workspace:ReturnType<typeof useWorkspaceContext>}){
 const [draft,setDraft]=useState<ExportedSop|null>(null),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const [sending,setSending]=useState(false),locked=useRef(false);
 const section=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(location.hash==='#office-word'&&section.current)section.current.open=true;},[]);
 function choose(file:unknown){
  if(locked.current)return;
  setDraft(null);setMessage('');setRevision(v=>v+1);
  if(!(file instanceof File)||!file.size||file.size>5_000_000||file.name.length>160||!/\.docx$/i.test(file.name)){setMessage('Choose a standard Word DOCX file up to 5 MB.');return;}
  setDraft({blob:file,filename:file.name});
 }
 return <details ref={section} id="office-word"><summary>Review a Word SOP</summary><p>In Word, prepare the current document for review. Receive it here or choose the saved DOCX copy.</p>
 {workspace.loading?<p>Checking workspace…</p>:!workspace.signedIn?<EmailSignIn destination="/sop-builder"/>:<label>Review workspace<select value={workspace.organizationId} disabled={sending} onChange={e=>workspace.chooseOrganization(e.target.value)}>{workspace.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
 <fieldset disabled={sending}><legend>Word document</legend><OfficeReceive host="word" receive={value=>choose((value as {file?:unknown}|null)?.file)}/>
 <label>Current Word draft<input type="file" accept=".docx" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)choose(file);}}/></label></fieldset>
 {draft&&<><p>{draft.filename} · {draft.blob.size} bytes</p><ReviewHandoff key={revision} workspace={workspace} document={draft} onSending={value=>{locked.current=value;setSending(value);}}/></>}
 {message&&<p role="status">{message}</p>}</details>;
}
