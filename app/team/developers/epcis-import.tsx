'use client';
import {useState} from 'react';
import {epcisTransfer,reconcileTransfer,transferFinding,type EpcisTransfer} from '../../../lib/epcis';
import {customerObservationInput,CUSTOMER_API_LIMITS} from '../../../lib/customer-api';

export default function EpcisImport({controls,locked}:{controls:{id:string;title:string}[];locked:boolean}){
 const [files,setFiles]=useState<{shipping?:File;receiving?:File}>({}),[control,choose]=useState(''),[source,setSource]=useState(''),[owner,setOwner]=useState('');
 const [pair,setPair]=useState<EpcisTransfer|null>(null),[envelope,save]=useState(''),[message,tell]=useState(''),[busy,lock]=useState(false);
 function reset(){setPair(null);save('');tell('');}
 async function prepare(){
  reset();lock(true);
  try{
   const load=async(file?:File)=>{
    if(!file||file.size>CUSTOMER_API_LIMITS.bodyBytes)throw Error('Choose a JSON document under 32 KiB for each event.');
    return JSON.parse(await file.text());
   };
   const [shipping,receiving]=await Promise.all([load(files.shipping),load(files.receiving)]);
   const parsed=epcisTransfer.safeParse({kind:'EPCIS_TRANSFER',shipping,receiving});
   if(!parsed.success){const issue=parsed.error.issues[0];throw Error(issue.path.join('.')+' — '+issue.message);}
   const record=parsed.data;setPair(record);
   const now=new Date(),recordId=record.shipping.epcisBody.eventList[0].eventID.toLowerCase();
   const input=customerObservationInput.safeParse({controlId:control,externalId:recordId+'-r1',observedAt:now.toISOString(),validUntil:new Date(now.getTime()+86400000).toISOString(),
    summary:'Serialised pack reconciliation from the supplied shipping and receiving documents.',
    checks:[{key:'epcis-files',label:'Two EPCIS documents supplied',status:'PASS',observed:'One shipping and one receiving ObjectEvent'}],
    partnerRecord:{schemaVersion:1,recordId,revision:1,sourceSystem:source,sourceVersion:'EPCIS-2.0',decisionOwnerRef:owner,state:'CURRENT',record}});
   if(!input.success){const issue=input.error.issues[0];throw Error(issue.path.join('.')+' — '+issue.message);}
   if(new TextEncoder().encode(JSON.stringify(input.data)).byteLength>CUSTOMER_API_LIMITS.bodyBytes)throw Error('The pair exceeds the 32 KiB observation limit.');
   save(JSON.stringify({requestKey:crypto.randomUUID(),observation:input.data},null,2));
  }catch(e){tell(e instanceof Error?e.message:'Unable to read the EPCIS documents.');}
  finally{lock(false);}
 }
 function download(){
  const url=URL.createObjectURL(new Blob([envelope],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='epcis-shipment-observation.json';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const result=pair&&reconcileTransfer(pair);
 return <details><summary>Reconcile serialised packs from EPCIS files</summary><p>Choose two GS1 EPCIS 2.0 JSON documents, each containing one ObjectEvent and up to 80 SGTIN pack identities. The comparison uses the dispatch advice, read points, timestamps and serials.</p>
 <form onSubmit={e=>{e.preventDefault();void prepare();}} onChange={reset}><fieldset disabled={locked||busy}><legend>Shipment comparison</legend>
 {(['shipping','receiving'] as const).map(side=><label key={side}>{side==='shipping'?'Shipping document':'Receiving document'} <input type="file" required accept=".json,.jsonld,application/json,application/ld+json" onChange={e=>setFiles({...files,[side]:e.target.files?.[0]})}/></label>)}
 <label>Control <select aria-label="Control" required value={control} onChange={e=>choose(e.target.value)}><option value="">Choose a granted control</option>{controls.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
 <label>Source system <input required minLength={2} maxLength={120} value={source} onChange={e=>setSource(e.target.value)}/></label><label>Decision owner reference <input required maxLength={96} value={owner} onChange={e=>setOwner(e.target.value)}/></label>
 <button>Compare pack identities</button></fieldset></form>
 {message&&<p role="alert">{message}</p>}{pair&&result&&<><p role="status">{transferFinding(pair)}</p>{result.missing.length>0&&<p>Missing serials · {result.missing.join(', ')}</p>}{result.unexpected.length>0&&<p>Unexpected serials · {result.unexpected.join(', ')}</p>}</>}
 {envelope&&<><button type="button" disabled={locked||busy} onClick={download}>Download observation for the partner connector</button><p>Submit the downloaded file from the authorised connector to record the result and start review. Use the same file for retries.</p></>}</details>;
}
