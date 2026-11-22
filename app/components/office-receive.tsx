'use client';
import {useEffect,useRef,useState} from 'react';

export default function OfficeReceive({host,receive}:{host:'word'|'excel';receive:(value:unknown)=>void}){
 const [notice,setNotice]=useState(''),waiting=useRef(false);
 useEffect(()=>{
  function onMessage(event:MessageEvent){
   if(!waiting.current||!window.opener||event.source!==window.opener||event.origin!==location.origin||event.data?.type!=='regpilot-transfer-'+host)return;
   waiting.current=false;setNotice('');receive(event.data.payload);
  }
  window.addEventListener('message',onMessage);return()=>window.removeEventListener('message',onMessage);
 },[host,receive]);
 const label=host==='word'?'Word':'Excel';
 return <div><button type="button" onClick={()=>{
  if(!window.opener){setNotice('Choose the copy downloaded from '+label+' below.');return;}
  waiting.current=true;setNotice('Waiting for '+label+'. If your browser opened separately, choose the downloaded copy below.');
  window.opener.postMessage({type:'regpilot-request-'+host},location.origin);
 }}>Receive from {label}</button> <a href={'/api/tools/office-manifest/'+host} download>Download {label} add-in manifest</a>
 {notice&&<p role="status">{notice}</p>}</div>;
}
