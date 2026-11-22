'use client';
import {useState,useRef} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {excursionWorkspace} from '../../../lib/server/excursion-pilot';

type Data=Awaited<ReturnType<typeof excursionWorkspace>>;
type Props={organizationId:string;caseId:string;version:number;files:{id:string;filename:string}[];request:ReturnType<typeof useWorkspaceContext>['request'];canEdit:boolean;canDecide:boolean;onChange:()=>void};
export default function Excursion({organizationId,caseId,version,files,request,canEdit,canDecide,onChange}:Props){
 const [data,setData]=useState<Data|null>(null),[message,setMessage]=useState(''),[busy,lock]=useState(false);
 const requestKeys=useRef(new Map<string,string>()),working=useRef(false);
 const path='/api/workspace/quality/'+caseId+'/excursion?'+new URLSearchParams({organizationId});
 async function load(){try{setData(await request(path));setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Unable to open the excursion.');}}
 async function submit(action:string,fields?:FormData){
  if(working.current)return;working.current=true;lock(true);setMessage('');
  try{
   const value:Record<string,unknown>=fields?Object.fromEntries(fields):{};
   if(action==='LINK')value.stock=String(value.stock).split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
   if(action==='DECIDE'){value.confirmed=value.confirmed==='on';value.decidedAt=new Date(String(value.decidedAt)).toISOString();}
   const body={action,version:data?.version??version,...value},key=JSON.stringify(body);
   const requestKey=requestKeys.current.get(key)??crypto.randomUUID();requestKeys.current.set(key,requestKey);
   const saved=await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestKey})});
   if(action==='RETRIEVE'){
    const href=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=href;a.download='excursion-'+caseId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
   }
   await load();onChange();
  }catch(e){setMessage(e instanceof Error?e.message:'Could not record this step.');}finally{working.current=false;lock(false);}
 }
 const file=(name:string,label:string)=><label>{label}<select name={name} required><option value="">Choose reviewed evidence</option>{files.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>;
 return <details onToggle={e=>{if(e.currentTarget.open&&!data)void load();}}><summary>Temperature excursion and stock disposition</summary>
 {message&&<p role="alert">{message}</p>}{data&&<><p>{data.issue??(data.disposition?'Disposition recorded':data.reading?'Reading linked. Complete the investigation before recording the signed disposition.':'Link the calibrated out-of-range reading to the stock present at the site.')}</p>
 {data.reading&&<p>{data.reading.data.sampleAt} · {data.reading.data.serial} · {data.reading.data.temperature} · {data.reading.data.site} · {data.reading.data.stock.join(', ')}</p>}
 {!data.reading&&canEdit&&<form onSubmit={e=>{e.preventDefault();void submit('LINK',new FormData(e.currentTarget));}}><fieldset disabled={busy}><legend>Affected stock</legend>
 <label>Logger collection ID<input name="runId" required placeholder="ID from the downloaded logger reading"/></label><label>Site and storage location<input name="site" required/></label><label>Stock or lot references, one per line<textarea name="stock" required/></label>
 {file('stockEvidenceId','Stock record for this location and time')}<button>Link reading and stock</button></fieldset></form>}
 {data.reading&&!data.disposition&&canDecide&&<form onSubmit={e=>{e.preventDefault();void submit('DECIDE',new FormData(e.currentTarget));}}><fieldset disabled={busy}><legend>Record the authorised source decision</legend>
 <label>Disposition<select name="disposition">{['QUARANTINE','RETURN','REJECT','RELEASE'].map(v=><option key={v}>{v}</option>)}</select></label><label>Decision record reference<input name="sourceRef" required/></label><label>Authorised signatory recorded on the document<input name="signatory" required/></label><label>Decision time (local)<input name="decidedAt" type="datetime-local" required/></label>
 {file('decisionEvidenceId','Signed decision')}{file('authorityEvidenceId','Signatory authority or delegation')}
 <label>Decision rationale<textarea name="rationale" minLength={20} required/></label><label><input name="confirmed" type="checkbox" required/>I checked the signatory’s authority, the affected stock and the decision against the signed records.</label><button>Record disposition</button></fieldset></form>}
 {data.disposition&&<><p>{data.disposition.data.disposition} · {data.disposition.data.signatory} · {data.disposition.data.sourceRef}</p>
 {canDecide&&<button disabled={busy||!!data.issue} onClick={()=>void submit('RETRIEVE')}>Retrieve as independent assessor</button>}<p>{data.retrieved.length} independent retrievals recorded.</p></>}</>}</details>;
}
