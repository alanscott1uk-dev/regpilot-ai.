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
 }}>Receive from {label}</button>
 <details><summary>Set up RegPilot in {label}</summary>
 <ol><li><a href={'/api/tools/office-manifest/'+host} download>Download the {label} add-in manifest</a> from the RegPilot workspace you want to use.</li>
 <li>Ask your Microsoft 365 administrator to upload the manifest in Integrated apps and assign it to your pilot users.</li>
 <li>Open {label}, find RegPilot in your add-ins and choose Prepare for review.</li></ol>
 <a href="https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins">Microsoft 365 add-in deployment guide</a></details>
 {notice&&<p role="status">{notice}</p>}</div>;
}
