'use client';
import {useEffect,useRef,useState} from 'react';

export default function BuyerBookmark(){
 const link=useRef<HTMLAnchorElement>(null),[open,setOpen]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!open)return;
  const abort=new AbortController();
  async function source(file:string,declaration:string){
   const response=await fetch('/portal-helper/'+file,{signal:abort.signal,credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error();
   const source=await response.text();
   if(source.length>22000||!source.includes(declaration))throw Error();
   return source.replace(declaration,declaration.replace('export ',''));
  }
  void Promise.all([source('fields.js','export async function questionnaireFields('),source('bookmark.js','export async function portalBookmark(')]).then(([fields,bookmark])=>{
   if(!link.current||abort.signal.aborted)return;
   const script='void (async()=>{'+fields+'\n'+bookmark+'\nawait portalBookmark(questionnaireFields,'+JSON.stringify(location.origin)+');})().catch(e=>window.alert(e.message))';
   link.current.setAttribute('href','javascript:'+encodeURIComponent(script));setReady(true);
  }).catch(()=>{if(!abort.signal.aborted)setError('Reopen this section to load the buyer bookmark.');});
  return()=>abort.abort();
 },[open]);
 return <details onToggle={e=>{setError('');setOpen(e.currentTarget.open);}}><summary>Fill the buyer’s form with a browser bookmark</summary>
 <p>Drag <a ref={link} draggable={ready} onClick={e=>e.preventDefault()}>RegPilot questionnaire</a> to your bookmarks bar. Open the buyer’s HTTPS form and select the bookmark to copy its questions or fill reviewed answers.</p>
 <p>After review, choose “Get pairing code for the buyer bookmark”. On the buyer form select “Fill reviewed answers” and enter the code in the RegPilot window.</p>
 {error&&<p role="status">{error}</p>}</details>;
}
