'use client';
import {useEffect,useRef,useState} from 'react';
import type {inspectEvidence} from '../../../lib/server/document-inspection';

type Props={
 organizationId:string;
 format:'PDF'|'DOCX';
 files:{id:string;filename:string}[];
 initial?:{id:string;page?:number;block?:number};
 request:(path:string,options:RequestInit)=>Promise<Awaited<ReturnType<typeof inspectEvidence>>>;
};
export default function PrivateClauseSource({organizationId,format,files,initial,request}:Props){
 const [id,select]=useState(initial?.id||''),[unit,setUnit]=useState(String(initial?.block||initial?.page||1));
 const [document,setDocument]=useState<Awaited<ReturnType<typeof inspectEvidence>>|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 const word=format==='DOCX',label=word?'Word block':'PDF page';
 async function preview(){
  if(!id||busy)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try{
   const result=await request('/api/workspace/evidence/'+id+'/inspect',{method:'POST',signal:controller.signal,
     headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})});
   if(result.id!==id)throw Error('The selected file changed. Choose the original again.');
   if(!controller.signal.aborted)setDocument(result);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Source preview unavailable.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 const selected=document?.units.find(u=>u.page===Number(unit));
 return <>
  <label>Original material<select name="sourceId" required value={id} onChange={e=>{
   pending.current?.abort();setBusy(false);select(e.target.value);setUnit('1');setDocument(null);setError('');
  }}><option value="">Choose source</option>{files.filter(f=>f.filename.toLowerCase().endsWith('.'+format.toLowerCase())).map(f=>
    <option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>
  <label>{label} number<input name={word?'block':'page'} type="number" required min={1} max={word?500:40}
    value={unit} onChange={e=>setUnit(e.target.value)}/></label>
  {id&&<div><button type="button" disabled={busy} onClick={()=>void preview()}>{busy?'Reading original…':'Read source text'}</button>
   {error&&<p role="alert">{error}</p>}
   {document?.blocked&&<p role="alert">Extraction is incomplete. Resolve the issues in the evidence file before importing a clause.</p>}
   {document&&!document.blocked&&<><label>Source passage<select value={selected?.page||''} onChange={e=>setUnit(e.target.value)}>
    <option value="">Choose a passage</option>{document.units.map(u=><option key={u.page} value={u.page}>{label} {u.page}{u.label?' · '+u.label:''}</option>)}
   </select></label>{selected&&<blockquote>{selected.text}</blockquote>}</>}
  </div>}
 </>;
}
