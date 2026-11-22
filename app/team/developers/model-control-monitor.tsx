'use client';
import {useState} from 'react';
import {profiles,profileFields} from '../../../lib/connectors/resource-control';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';

type Scope={integration:string;connectionId:string;model:string;provider:string};
type Sample={rules:{id:string;label:string;status:string;observed:string}[];findings:{resource:string}[];receiptId:string;changed:boolean|null;populationComplete:boolean};
export default function ModelControlMonitor({workspace,scope}:{workspace:ReturnType<typeof useWorkspaceContext>;scope:Scope}){
 const [profile,select]=useState('identity'),[mapping,map]=useState<Record<string,string>>({});
 const [policyId,bind]=useState(''),[sample,show]=useState<Sample|null>(null),[message,tell]=useState(''),[busy,lock]=useState(false);
 const fields=profileFields(profile);
 function clear(){bind('');show(null);tell('');}
 async function run(){
  const valid=workspace.capture();
  const {integration,connectionId,model}=scope;
  const base={organizationId:workspace.organizationId,integration,connectionId,model};
  const body=policyId?{...base,action:'COLLECT',policyId}:{...base,action:'BIND_POLICY',policy:{profile,mapping:Object.fromEntries(fields.map(f=>[f,mapping[f]??f]))}};
  lock(true);tell('');
  try{
   const v=await workspace.request('/api/workspace/integration-directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!valid())return;
   if(policyId)show(v);else bind(v.policyId);
  }catch(e){if(valid())tell(e instanceof Error?e.message:'The source could not be checked.');}finally{if(valid())lock(false);}
 }
 return <fieldset disabled={busy}><legend>Monitor source records</legend>
 <label>Control profile <select value={profile} onChange={e=>{select(e.target.value);map({});clear();}}>{Object.entries(profiles).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label>
 <p>Enter the field path used in {scope.model} for each control. Nested fields use a dot. Dates use ISO timestamps with a timezone.</p>
 {fields.map(f=><label key={f}>{f} <input value={mapping[f]??f} maxLength={150} onChange={e=>{map({...mapping,[f]:e.target.value});clear();}}/></label>)}
 <button type="button" onClick={()=>void run()}>{policyId?'Refresh control evidence':'Save field mapping'}</button>
 {policyId&&<p>For scheduled collection use <strong>{scope.provider}/{policyId}</strong> in the provider reference field in Operations.</p>}
 {sample&&<><p>Receipt {sample.receiptId} · {sample.populationComplete?'Source population reconciled':'Coverage incomplete'} · {sample.changed===null?'First collection':sample.changed?'Evidence changed':'Same evidence'}</p>
 <ul>{sample.rules.map(rule=><li key={rule.id}>{rule.status} · {rule.label} · {rule.observed}</li>)}</ul>
 {sample.findings.length>0&&<p>Affected resource references: {sample.findings.map(f=>f.resource).join(', ')}</p>}</>}
 {message&&<p role="status">{message}</p>}</fieldset>;
}
