'use client';
import {useRef,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {siteQualification} from '../../../lib/server/site-qualification-service';

import type {validationChangeReview} from '../../../lib/server/validation-change-review';
import type {softwareValidation} from '../../../lib/server/software-validation';
type Pack=Awaited<ReturnType<typeof softwareValidation>>;
type Packet=Awaited<ReturnType<typeof siteQualification>>;
type Workspace=ReturnType<typeof useWorkspaceContext>;
const labels:Record<string,string>={AWAITING_DECISION:'Awaiting a site decision',APPROVED_FOR_SITE_USE:'Approved for the recorded site use',
 REASSESSMENT_REQUIRED:'Reassessment required',WITHHELD:'Site approval withheld',WITHDRAWN:'Site approval withdrawn'};

export default function SiteDecision({w,id,files,participant}:{w:Workspace;id:string;files:{id:string;filename:string}[];participant:boolean}){
 const [packet,setPacket]=useState<Packet|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [software,setSoftware]=useState<Pack|null>(null),[delta,setDelta]=useState<Awaited<ReturnType<typeof validationChangeReview>>|null>(null);
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
   <h4>Software validation for this release</h4><p><code>{packet.protocol.release}</code></p>
   <button type="button" disabled={busy} onClick={()=>void run(async()=>{setSoftware(null);const valid=w.capture();const result:Pack=await w.request(url.replace('/site?','/release-validation?'));if(result.revision!==packet.protocol.release)throw Error('The validation revision changed. Refresh the dossier.');if(valid())setSoftware(result);return packet;})}>Find executed release tests</button>
   {software&&<div><p>{({MISSING:'No validation run was found for this revision.',RUNNING:'Validation is running.',FAILED:'The latest validation run did not pass.',UNAVAILABLE:'The validation archive is unavailable or expired.',AVAILABLE:'Supplier tests passed on this exact revision.'})[software.state]}</p>{'runUrl' in software&&<a href={software.runUrl} target="_blank" rel="noreferrer">View execution record</a>}{software.state==='AVAILABLE'&&<p><a href={software.downloadUrl}>Download validation pack from GitHub</a> · Available until {software.expiresAt.slice(0,10)}<br/>Archive digest <code>{software.digest}</code></p>}</div>}
   <form onSubmit={e=>{e.preventDefault();const baseline=String(new FormData(e.currentTarget).get('baseline')),valid=w.capture();void run(async()=>{
    const bundle=await w.request(url.replace('/site?','/release-validation?')+'&baseline='+encodeURIComponent(baseline));
    if(bundle.dossier?.trialId!==id||bundle.dossier.organizationId!==w.organizationId||bundle.changes?.baseline!==baseline||bundle.changes.release!==packet.protocol.release)throw Error('The comparison does not match this site protocol.');
    if(valid()){setDelta(bundle.changes);setSoftware(bundle.validation);const a=document.createElement('a'),object=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));a.href=object;a.download='site-release-review-'+packet.protocol.release.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);}
    return bundle.dossier;
   });}}><fieldset disabled={busy}><legend>Review the upgrade from a previous release</legend><label>Previously assessed version (40-character Git revision)<input name="baseline" pattern="[a-f0-9]{40}" required maxLength={40}/></label><button>Compare releases and download review dossier</button></fieldset></form>
   {delta&&<p>{delta.state==='COMPARED'?delta.files.length+' changed files':delta.state==='DIVERGED'?'The revisions have different histories. Review both branches.':delta.state==='FILE_LIMIT'?'The file list reached GitHub’s 300-file limit.':'Review the full comparison on GitHub.'}{'requirementIds' in delta&&delta.requirementIds?.length?' · Suggested supplier tests '+delta.requirementIds.join(', '):''} · <a href={delta.compareUrl} target="_blank" rel="noreferrer">Inspect the changes</a></p>}
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
