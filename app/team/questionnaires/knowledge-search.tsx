'use client';
import {useEffect,useRef,useState} from 'react';
import type {KnowledgeSearchHit} from '../../../lib/company-knowledge';
import {workspaceHref} from '../../../lib/client/workspace-context';
import type {Question,Request,Write} from './types';
import css from './questionnaires.module.css';

type SearchResult={id:string;requestKey:string;status:string;method:'CONTENT'|'SEMANTIC';current:boolean;hits:KnowledgeSearchHit[];reason?:string;failureCode?:string|null};
type Props={organizationId:string;question:Question;request:Request;capture:()=>()=>boolean;write:Write;locked:boolean;selectedEvidence:string[];limit:number;onChoose:(file:{id:string;filename:string})=>void};
export function QuestionnaireKnowledgeSearch({organizationId,question,request,capture,write,locked,selectedEvidence,limit,onChoose}:Props){
 const [query,setQuery]=useState(question.question.slice(0,1200)),[method,setMethod]=useState<'CONTENT'|'SEMANTIC'>('CONTENT'),[semanticReady,setSemanticReady]=useState(false),[consent,setConsent]=useState(false),[result,setResult]=useState<SearchResult|null>(null),[error,setError]=useState('');
 const mounted=useRef(true),requestKey=useRef({payload:'',id:''}),serial=useRef(0);
 const base='/api/workspace/knowledge',organizationQuery='?'+new URLSearchParams({organizationId});
 useEffect(()=>{mounted.current=true;const valid=capture(),read=++serial.current;void request(base+organizationQuery).then(value=>{if(mounted.current&&valid()&&read===serial.current)setSemanticReady(value?.configuration?.semanticReady===true);}).catch(problem=>{if(mounted.current&&valid()&&read===serial.current)setError(problem instanceof Error?problem.message:'Company knowledge could not be loaded.');});return()=>{mounted.current=false;serial.current++;};},[organizationId,request,capture]);
 function checked(value:unknown):SearchResult{
  const item=value as SearchResult|null;
  if(!item?.id||typeof item.current!=='boolean'||!Array.isArray(item.hits)||!['CONTENT','SEMANTIC'].includes(item.method))throw Error('The knowledge search acknowledgement was incomplete.');
  return item;
 }
 async function search(){
  if(locked||!consent||query.trim().length<3||method==='SEMANTIC'&&!semanticReady)return;
  const productId=question.productId||null,input={query:query.trim(),productId,method,confirm:true,...(result?.status==='FAILED'?{retryOfId:result.id}:{})},payload=JSON.stringify(input),valid=capture();
  if(requestKey.current.payload!==payload)requestKey.current={payload,id:crypto.randomUUID()};
  const key=requestKey.current.id;setError('');
  await write({label:method==='SEMANTIC'?'Searching company knowledge by meaning':'Searching company knowledge content',run:async()=>checked(await request(base+'/search'+organizationQuery,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestKey:key})})),success:value=>{if(mounted.current&&valid()){setResult(value);setConsent(false);requestKey.current={payload:'',id:''};}},message:'The search is recorded. Select relevant evidence, then verify its passages in response preparation.',reconcile:async()=>{
   const raw=await request(base+'/search'+organizationQuery+'&requestKey='+key);
   if(!raw)return {state:'absent',message:'No saved knowledge search was found for this request. You can explicitly search again.'};
   const value=checked(raw);
   if(value.status==='PROCESSING')return {state:'pending',message:'The original search is still processing. Check its status again before starting another.'};
   return {state:'saved',message:value.status==='FAILED'?'The search has a recorded failure. No repeat model request was made.':'The original search was recovered without repeating it.',after:()=>{if(mounted.current&&valid()){setResult(value);setConsent(false);requestKey.current={payload:'',id:''};}}};
  }});
 }
 return <details aria-label="Company knowledge search"><summary>Search across company knowledge</summary><p>Find supporting passages in indexed, reviewed documents{question.productName?' for '+question.productName:''}. Selecting a document adds it to response preparation, where the original file is checked again.</p>
  {error&&<p className={css.warning} role="alert">{error}</p>}
  <fieldset disabled={locked}><label className={css.field}>Knowledge search query<textarea rows={3} maxLength={1200} value={query} onChange={event=>{setQuery(event.target.value);setConsent(false);setResult(null);}}/></label><label className={css.field}>Knowledge search method<select value={method} onChange={event=>{setMethod(event.target.value as 'CONTENT'|'SEMANTIC');setConsent(false);setResult(null);}}><option value="CONTENT">Content search · matching terms</option><option value="SEMANTIC" disabled={!semanticReady}>Semantic search · similar meaning{!semanticReady?' · not activated':''}</option></select></label><label className={css.check}><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>{method==='SEMANTIC'?'I agree to send this query to the configured embedding provider and save the search.':'I agree to search the indexed company documents and save the result.'}</label><button type="button" className={css.secondary} disabled={!consent||query.trim().length<3||method==='SEMANTIC'&&!semanticReady} onClick={()=>void search()}>{result?.status==='FAILED'?'Explicitly retry knowledge search':'Search company knowledge'}</button></fieldset>
  <p><a className={css.link} href={workspaceHref('/team/knowledge',organizationId,question.productId?{productId:question.productId}:{})}>Manage indexed documents →</a></p>
  {result&&<div aria-label="Company knowledge results"><p className={css.muted}>{result.method==='SEMANTIC'?'Semantic similarity results':'Content matching results'} · {result.status.toLowerCase().replaceAll('_',' ')}. Search relevance does not establish that a statement is true.</p>{result.reason&&<p className={result.current?css.muted:css.warning}>{result.reason}</p>}{!result.current&&<p className={css.warning}>These search results are unavailable or no longer current. Refresh company knowledge and search again.</p>}{result.current&&!result.hits.length&&<p className={css.muted}>No supporting passage was found in the eligible indexed documents. Try more specific terms or index another approved document.</p>}{result.current&&result.hits.map(hit=><article className={css.candidate} key={hit.indexId+':'+hit.unit+':'+hit.start}><a className={css.link} href={workspaceHref('/team/evidence',organizationId,{evidenceId:hit.evidenceId})}>{hit.filename} →</a><p className={css.metadata}>{hit.unitKind==='block'?'Word block':'Page'} {hit.unit}</p><blockquote>{hit.quote}</blockquote><button type="button" className={css.secondary} disabled={locked||selectedEvidence.includes(hit.evidenceId)||selectedEvidence.length>=limit} onClick={()=>onChoose({id:hit.evidenceId,filename:hit.filename})}>{selectedEvidence.includes(hit.evidenceId)?'Selected for preparation':'Use this supporting document'}</button></article>)}</div>}
 </details>;
}
