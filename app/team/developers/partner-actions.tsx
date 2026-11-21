'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {auditRequest} from '../audits/audit-session';
import type {partnerFollowUp} from '../../../lib/server/partner-follow-up';
import css from '../questionnaires/questionnaires.module.css';

type Options=Awaited<ReturnType<typeof partnerFollowUp>>;
type Props={id:string;org:string;task:string|null;hash:string;isModel:boolean;locked:boolean;reviewed:boolean};

export default function PartnerActions({id,org,task,hash,isModel,locked,reviewed}:Props){
 const path='/api/workspace/developers/observations/'+id+'/follow-up?'+new URLSearchParams({organizationId:org});
 const [options,setOptions]=useState<Options|null>(null);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  auditRequest(path).then(data=>{if(active)setOptions(data);}).catch(error=>{if(active)setMessage(error.message);});
  return ()=>{active=false;};
 },[path]);

 async function save(url:string,body:Record<string,unknown>){
  setBusy(true);setMessage('');
  try{await auditRequest(url,body);setOptions(await auditRequest(path));setMessage('Saved.');}
  catch(error){setMessage(error instanceof Error?error.message:'Could not link the record.');}
  finally{setBusy(false);}
 }
 function bindModel(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const systemId=new FormData(event.currentTarget).get('system');
  const system=options?.systems.find(row=>row.id===systemId);
  if(system)void save(path,{systemId:system.id,systemVersion:system.version,receiptHash:hash,confirm:true});
 }
 function linkCase(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const fields=new FormData(event.currentTarget),qualityCase=options?.cases.find(row=>row.id===fields.get('case'));
  if(qualityCase)void save('/api/workspace/quality',{
   organizationId:org,action:'ADD_ACTION',caseId:qualityCase.id,version:qualityCase.version,requestKey:crypto.randomUUID(),
   kind:'CORRECTIVE',taskId:task,purpose:fields.get('purpose')
  });
 }
 return <section className={css.support}>
  {options&&isModel&&(options.boundSystemId
   ?<a href={'/team/ai-inventory?'+new URLSearchParams({organizationId:org,systemId:options.boundSystemId})}>Open linked AI system and reassessment</a>
   :<form onSubmit={bindModel}>
     <label>AI system on this control<select name="system" required>
      <option value="">Choose system and vendor</option>{options.systems.map(system=><option key={system.id} value={system.id}>{system.name} · {system.vendor?.name}</option>)}
     </select></label>
     <label><input type="checkbox" required/> Reopen assessment of this system when the authorised source sends a new revision.</label>
     {!reviewed&&<p>Review the current source report to enable binding.</p>}
     <button disabled={busy||locked||!reviewed||!options.systems.length}>Bind model source</button>
    </form>)}
  {options&&task&&<>
   <h4>Corrective action and effectiveness</h4>
   {options.qualityActions.map(({id,qualityCase,cycle})=><p key={id}>
    <a href={'/team/quality?'+new URLSearchParams({organizationId:org,caseId:qualityCase.id})}>{qualityCase.title}</a> · {qualityCase.status} · cycle {cycle}
   </p>)}
   <form onSubmit={linkCase}>
    <label>Investigation<select name="case" required><option value="">Choose an open quality case</option>
     {options.cases.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}
    </select></label>
    <label>Purpose of the corrective action<textarea name="purpose" required minLength={20} maxLength={1200}/></label>
    <button disabled={busy||locked||!options.cases.length}>Link the source follow-up to this case</button>
   </form>
   <a href={'/team/quality?'+new URLSearchParams({organizationId:org})}>Open deviations and CAPA</a>
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
