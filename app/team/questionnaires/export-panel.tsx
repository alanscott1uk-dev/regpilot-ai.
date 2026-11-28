'use client';
import PdfOriginalPanel from './pdf-original-panel';
import PortalPanel from './portal-panel';
import {useEffect,useRef,useState} from 'react';
import type {Detail,RawRequest} from './types';
import css from './questionnaires.module.css';
type Props={organizationId:string;detail:Detail;requestResponse:RawRequest;capture:()=>()=>boolean;locked:boolean};
const letter=(number:number)=>{let text='';for(let n=number;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;};
const column=(cell:unknown)=>{if(typeof cell!=='string')return '';const letters=/^([A-Z]+)[1-9]\d*$/.exec(cell)?.[1];if(!letters)return '';let number=0;for(const l of letters)number=number*26+l.charCodeAt(0)-64;return String(number);};
export function ExportPanel({organizationId,detail,requestResponse,capture,locked}:Props){
 const source=detail.questions[0]?.source;
 const format=String(source?.format||'');
 const original=['XLSX','CSV','DOCX'].includes(format)&&detail.questions.every(q=>q.source?.format===format&&q.source.filename===source?.filename&&q.source.sha256===source?.sha256);
 const pdf=format==='PDF'&&detail.questions.every(q=>q.source?.format==='PDF'&&q.source.method!=='OCR'&&q.source.sha256===source?.sha256&&q.source.filename===source?.filename);
 const word=format==='DOCX';
 const groups=[...new Map(detail.questions.filter(question=>['CSV','XLSX'].includes(String(question.source?.format))).map(question=>{const sheet=String(question.source!.sheet),productId=question.productId||null;return [JSON.stringify([sheet,productId]),{sheet,productId,productName:question.productName||'General response',suggested:column(question.source!.answerCell)}] as const;})).entries()];
 const [file,setFile]=useState<File|null>(null),[columns,setColumns]=useState<Record<string,string>>(()=>Object.fromEntries(groups.map(([key,value])=>[key,value.suggested]))),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');const alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const distinct=new Set(groups.map(([key,value])=>value.sheet+'\u0000'+columns[key])).size===groups.length,ready=word||groups.length>0&&groups.every(([key])=>Number(columns[key])>=1&&Number(columns[key])<=64)&&distinct;
 async function download(kind:'zip'|'original'){
  if(pending.current||locked||!detail.current||kind==='original'&&(!file||!ready||!confirmed))return;pending.current=true;const valid=capture();setBusy(kind);setError('');
  try{
   const base='/api/workspace/questionnaires/'+detail.questionnaire.id,query='?'+new URLSearchParams({organizationId});let response:Response;
   if(kind==='original'){const body=new FormData();body.set('file',file!);body.set('mapping',JSON.stringify(groups.map(([key,value])=>({sheet:value.sheet,productId:value.productId,answerColumn:Number(columns[key])}))));body.set('expectedVersion',String(detail.questionnaire.version));response=await requestResponse(base+'/original-export'+query,{method:'POST',body});}else response=await requestResponse(base+'/export'+query+'&format=zip');
   const blob=await response.blob();if(!alive.current||!valid())return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=kind==='zip'?'questionnaire-response-pack.zip':'completed-original.'+format.toLowerCase();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(problem){if(alive.current&&valid())setError(problem instanceof Error?problem.message:'The approved response could not be exported.');}
  finally{pending.current=false;if(alive.current&&valid())setBusy('');}
 }
 return <section className={css.support} aria-label="Customer response packages"><h4>Return a complete customer response</h4><p>Download the approved responses and their supporting original files together. The pack contains a CSV, a response and provenance workbook, and a manifest linking each question and product to its verified evidence. Up to 50 evidence records and 30 MiB.</p><button type="button" disabled={locked||!!busy||!detail.current} onClick={()=>void download('zip')}>{busy==='zip'?'Verifying evidence and building pack…':'Download response and evidence ZIP'}</button>
 {original&&<details className={css.support}><summary className={css.sectionToggle}>Return answers in the original {format}</summary>
 <p>Re-upload <strong>{String(source?.filename)}</strong>. RegPilot checks the original file and current approval before returning the completed copy.</p>
 {word&&<p>Each question must occupy a complete paragraph or a two-column row with an empty answer cell. Paragraph answers follow their question. Table answers go in the empty cell. Product-specific answers include the product code and name.</p>}
 <fieldset className={css.fieldset} disabled={locked||!!busy||!detail.current}>
 <label className={css.field}>Exact original {format}<input aria-label={'Exact original '+format} type="file" accept={'.'+format.toLowerCase()} onChange={event=>{
   const chosen=event.target.files?.[0]||null;setConfirmed(false);setError('');
   if(chosen&&(!chosen.name.toLowerCase().endsWith('.'+format.toLowerCase())||chosen.size>3*1024*1024)){
     setFile(null);setError('Choose the original '+format+' file, no larger than 3 MiB.');event.target.value='';return;
   }
   setFile(chosen);
 }}/></label>
 {!word&&<p className={css.muted}>Choose a distinct answer column for each product. RegPilot protects question, reference and context columns.</p>}{groups.map(([key,value])=><label className={css.field} key={key}>{value.sheet} · {value.productName}<select aria-label={'Original answer column '+value.sheet+' '+value.productName} value={columns[key]||''} onChange={event=>{setColumns(previous=>({...previous,[key]:event.target.value}));setConfirmed(false);}}><option value="">Choose an answer column</option>{Array.from({length:64},(_,index)=><option key={index+1} value={index+1}>{letter(index+1)}</option>)}</select></label>)}{!distinct&&<p role="alert">Each product needs a different answer column on this worksheet.</p>}<label className={css.check}><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{word?'I checked the Word question locations and product scope.':'I checked the customer’s answer columns and the separate product response mappings.'}</label><button type="button" disabled={!file||!ready||!confirmed} onClick={()=>void download('original')}>{busy==='original'?'Verifying and completing original…':'Download completed original '+format}</button></fieldset></details>}
 {pdf&&<PdfOriginalPanel key={[organizationId,detail.questionnaire.id,detail.questionnaire.version].join('/')} {...{organizationId,detail,requestResponse,capture,locked:locked||!!busy}}/>}
 {!original&&!pdf&&<p className={css.muted}>Use the response workbook for the approved answers and their exact source references.</p>}{error&&<div className={css.error} role="alert">{error}</div>}
 <PortalPanel key={['portal',organizationId,detail.questionnaire.id,detail.questionnaire.version].join('/')} detail={detail} organizationId={organizationId} requestResponse={requestResponse} capture={capture} locked={locked||!!busy}/>
 </section>;
}
