'use client';
import {useRef,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {siteQualification} from '../../../lib/server/site-qualification-service';

type Packet=Awaited<ReturnType<typeof siteQualification>>;
type Workspace=ReturnType<typeof useWorkspaceContext>;
const labels:Record<string,string>={AWAITING_DECISION:'Awaiting a site decision',APPROVED_FOR_SITE_USE:'Approved for the recorded site use',
 REASSESSMENT_REQUIRED:'Reassessment required',WITHHELD:'Site approval withheld',WITHDRAWN:'Site approval withdrawn'};

export default function SiteDecision({w,id,files,participant}:{w:Workspace;id:string;files:{id:string;filename:string}[];participant:boolean}){
 const [packet,setPacket]=useState<Packet|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),keys=useRef(new Map<string,string>());
 const url='/api/workspace/trials/'+id+'/site?'+new URLSearchParams({organizationId:w.organizationId});
 async function run(operation:()=>Promise<Packet>){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');const valid=w.capture();
  try{const result=await operation();if(valid())setPacket(result);}
  catch(e){if(valid())setError(e instanceof Error?e.message:'Unable to retrieve the site decision.');}
  finally{pending.current=false;if(valid())setBusy(false);}
 }
 async function load(download=false){
  const result:Packet=await w.request(url+(download?'&download=1':''));
  if(result.trialId!==id||result.organizationId!==w.organizationId)throw new Error('The dossier does not match this workspace and trial.');
  return result;
 }
 function download(){
  const valid=w.capture();
  void run(async()=>{
   const result=await load(true);
   if(valid()){
    const link=document.createElement('a'),href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
    link.href=href;link.download='regpilot-site-'+id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
   }
   return result;
  });
 }
 function submit(form:FormData){
  if(!packet)return;
  const input={...Object.fromEntries(form),basisHash:packet.basisHash,confirmed:form.get('confirmed')==='on'};
  const identity=JSON.stringify(input),requestKey=keys.current.get(identity)??crypto.randomUUID();keys.current.set(identity,requestKey);
  void run(async()=>{
   await w.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestKey})});
   return load();
  });
 }
 const withdrawing=packet?.status==='APPROVED_FOR_SITE_USE'||packet?.status==='REASSESSMENT_REQUIRED';
 return <details onToggle={e=>{if(e.currentTarget.open&&!packet)void run(()=>load());}}>
  <summary>Site decision and inspection dossier</summary>
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void run(()=>load())}>Refresh dossier</button>
  {packet&&<>
   <p><strong>{labels[packet.status]}</strong> · {packet.protocol.operator} · {packet.protocol.site}</p>
   <p>Tested configuration {packet.protocol.configuration} · Licence reference {packet.protocol.licence}</p>
   <p>Protocol and results fingerprint <code>{packet.basisHash}</code></p>
   {packet.blockers.length>0&&<ul>{packet.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>}
   {packet.decisions.map(d=><div key={d.id}><p>{d.input.decision} · {d.input.signatory}, {d.input.role} · {d.at}</p><p>{d.input.rationale}</p></div>)}
   <button type="button" disabled={busy} onClick={download}>Download site dossier</button>
   {!participant&&packet.finishedAt&&(withdrawing||packet.status==='AWAITING_DECISION')&&
    <form onSubmit={e=>{e.preventDefault();submit(new FormData(e.currentTarget));}}><fieldset disabled={busy}><legend>Record the signed site decision</legend>
     <label>Decision<select name="decision" defaultValue="" required><option value="">Choose a decision</option>
      {withdrawing?<option value="WITHDRAW">Withdraw the recorded site approval</option>:<>
       <option value="APPROVE" disabled={packet.blockers.length>0}>Approve this release for the recorded site use</option><option value="WITHHOLD">Withhold site approval</option></>}</select></label>
     <label>Signatory named on the decision<input name="signatory" minLength={3} maxLength={240} required/></label>
     <label>Signatory role<input name="role" minLength={3} maxLength={240} required/></label>
     {([['decisionFile','Signed site decision'],['authorityFile','Signatory authority or delegation']] as const).map(([name,label])=><label key={name}>{label}
      <select name={name} required><option value="">Choose a reviewed file</option>{files.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>)}
     <label>Decision reasoning<textarea name="rationale" minLength={20} maxLength={800} required/></label>
     <label><input type="checkbox" name="confirmed" required/>I checked the signatory’s authority and matched the signed decision to this site, configuration, release and test results.</label>
     <button>Record site decision</button>
    </fieldset></form>}
  </>}
 </details>;
}
