'use client';
import {useEffect,useRef,useState} from 'react';
import type {Detail,RawRequest} from './types';
import type {PdfAnswerField} from '../../../lib/server/questionnaire-document-worker';
import css from './questionnaires.module.css';

type Props={organizationId:string;detail:Detail;requestResponse:RawRequest;capture:()=>()=>boolean;locked:boolean};
export default function PdfOriginalPanel({organizationId,detail,requestResponse,capture,locked}:Props){
 const [file,choose]=useState<File|null>(null),[fields,setFields]=useState<PdfAnswerField[]>([]);
 const [mapping,setMapping]=useState<Record<string,string>>({}),[confirmed,confirm]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const {questions,questionnaire}=detail;
 const complete=questions.every(q=>fields.some(f=>f.name===mapping[q.id]&&f.page===q.source?.unit))&&
   new Set(questions.map(q=>mapping[q.id])).size===questions.length;
 async function submit(inspect:boolean){
  if(!file||pending.current||locked||!detail.current||(!inspect&&(!complete||!confirmed)))return;
  pending.current=true;setBusy(true);setError('');
  const valid=capture();
  try{
   const data=new FormData(),query=new URLSearchParams({organizationId});
   data.set('file',file);data.set('expectedVersion',String(questionnaire.version));
   if(inspect)query.set('inspect','fields');
   else data.set('mapping',JSON.stringify(questions.map(q=>({questionId:q.id,field:mapping[q.id]}))));
   const response=await requestResponse('/api/workspace/questionnaires/'+questionnaire.id+'/original-export?'+query,{method:'POST',body:data});
   if(inspect){
    const result=await response.json();
    if(result.organizationId!==organizationId||result.questionnaireId!==questionnaire.id||result.version!==questionnaire.version)throw Error('The questionnaire changed. Refresh and inspect its original again.');
    if(alive.current&&valid()){setFields(result.fields);setMapping({});confirm(false);}
   }else{
    const bytes=await response.blob();
    if(!alive.current||!valid())return;
    const url=URL.createObjectURL(bytes),link=document.createElement('a');link.href=url;link.download='completed-original.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  }catch(e){if(alive.current&&valid())setError(e instanceof Error?e.message:'The PDF could not be verified.');}
  finally{pending.current=false;if(alive.current&&valid())setBusy(false);}
 }
 return <details className={css.support}><summary className={css.sectionToggle}>Return answers in the original PDF</summary>
  <p>Upload {String(questions[0].source?.filename)} and choose a blank text field on the source page for each approved answer. Flat, signed or protected forms use the response workbook.</p>
  <fieldset className={css.fieldset} disabled={locked||busy||!detail.current}>
   <label className={css.field}>Exact original PDF<input type="file" accept=".pdf" onChange={e=>{
    const selected=e.target.files?.[0]??null;setFields([]);setMapping({});confirm(false);setError('');
    if(selected&&(!/\.pdf$/i.test(selected.name)||selected.size>3*1024*1024)){choose(null);setError('Choose a PDF up to 3 MiB.');e.target.value='';return;}choose(selected);
   }}/></label>
   <button type="button" disabled={!file} onClick={()=>void submit(true)}>Inspect PDF fields</button>
   {!!fields.length&&<>{questions.map(q=><label key={q.id} className={css.field}>{q.reference} · {q.question} · page {String(q.source?.unit)}{q.productName&&' · '+q.productName}
    <select aria-label={'PDF answer field '+q.reference+(q.productName?' '+q.productName:'')} value={mapping[q.id]||''} onChange={e=>{setMapping({...mapping,[q.id]:e.target.value});confirm(false);}}>
     <option value="">Choose an empty field</option>{fields.filter(f=>f.page===q.source?.unit).map(f=>
      <option key={f.name} disabled={Object.entries(mapping).some(([id,name])=>id!==q.id&&name===f.name)} value={f.name}>{f.name}{f.maxLength!==null?' · '+f.maxLength+' characters':''}</option>)}
    </select></label>)}
    <label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I checked the PDF fields against the questions and product scope.</label>
    <button type="button" disabled={!complete||!confirmed} onClick={()=>void submit(false)}>Download completed original PDF</button></>}
  </fieldset>{busy&&<p role="status">Checking the original and approved disclosure…</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
