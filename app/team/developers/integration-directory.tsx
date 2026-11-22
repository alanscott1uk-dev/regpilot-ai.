'use client';
import {useState} from 'react';
import type {Integration} from '../../../lib/connectors/marketplace';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';

type Entry={slug:string;name:string;auth:string;category:string};
type Choice={provider:string|null;model:string|null;version:string|null};
export default function IntegrationDirectory({workspace,locked}:{workspace:ReturnType<typeof useWorkspaceContext>;locked:boolean}){
 const [selfService,setSelfService]=useState(false);
 const [entries,setEntries]=useState<Entry[]>([]),[available,setAvailable]=useState<Integration[]>([]),[search,filter]=useState('');
 const [sourceId,select]=useState(''),[grants,setGrants]=useState<{id:string;healthy:boolean}[]>([]),[id,choose]=useState(''),[model,setModel]=useState(''),[aiModel,setAiModel]=useState('');
 const [account,setAccount]=useState<Choice|null>(null),[link,setLink]=useState(''),[message,tell]=useState(''),[busy,lock]=useState(false),[offset,page]=useState(0);
 const source=available.find(s=>s.integration===sourceId);
 const matches=entries.filter(e=>(e.name+' '+e.category+' '+e.slug).toLowerCase().includes(search.trim().toLowerCase()));
 function selectSource(s?:Integration){select(s?.integration??'');setGrants([]);choose('');setModel(s?.models[0]??'');setAiModel(s?.aiModels[0]??'');setLink('');tell('');}
 async function act(action:string,slug?:string){
  const valid=workspace.capture();lock(true);tell('');setLink('');
  try{
   const body:Record<string,unknown>={action,organizationId:workspace.organizationId};
   if(action==='ENABLE')body.slug=slug;
   if(!['DIRECTORY','AVAILABLE','UNLINK_AI','ENABLE'].includes(action))body.integration=sourceId;
   if(['RENEW','COLLECT','SET_AI'].includes(action))body.connectionId=id;
   if(action==='COLLECT')body.model=model;
   if(action==='SET_AI')body.model=aiModel;
   if(action==='SET_AI'||action==='UNLINK_AI')body.previous=account?.version??null;
   const v=await workspace.request('/api/workspace/integration-directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!valid())return;
   if(action==='ENABLE'){const enabled=v.source as Integration;setAvailable(old=>[...old.filter(s=>s.integration!==enabled.integration),enabled]);selectSource(enabled);tell('Ready to authorise '+enabled.name+' for this organisation.');}
   if(action==='DIRECTORY'){setEntries(v.entries);page(0);tell(v.entries.length+' provider catalogue entries refreshed.');}
   if(action==='AVAILABLE'){setSelfService(v.selfService===true);setAvailable(v.integrations);setAccount(v.ai);selectSource(v.integrations[0]);tell(v.enabled?v.integrations.length+' integrations enabled for hosted connection.':'Hosted connections await broker configuration.');}
   if(action==='GRANTS'){setGrants(v.grants);choose(v.grants[0]?.id??'');tell(v.grants.length+' connections returned for this organisation.');}
   if(action==='CONNECT'||action==='RENEW')setLink(v.link);
   if(action==='SET_AI'||action==='UNLINK_AI'){setAccount(v);tell(v.provider?'Model access confirmed. Select your organisation account in AI Studio.':'AI account unlinked from RegPilot.');}
   if(action==='COLLECT')tell(v.count+' synced records sampled · '+v.deleted+' marked deleted · '+(v.limited?'partial sample':'end of returned pages')+' · '+(v.changed===null?'first collection':v.changed?'sample changed since '+v.previousCheckedAt:'same metadata as '+v.previousCheckedAt)+' · receipt '+v.receiptId);
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Connection request unavailable.');}finally{if(valid())lock(false);}
 }
 return <section><h2>Integration directory and AI accounts</h2><fieldset disabled={busy||locked}><legend>Provider catalogue</legend>
 <button type="button" onClick={()=>void act('DIRECTORY')}>Refresh provider catalogue</button> <button type="button" onClick={()=>void act('AVAILABLE')}>Refresh enabled integrations</button>
 {entries.length>0&&<><label>Find a provider or category <input value={search} onChange={e=>{filter(e.target.value);page(0);}}/></label><p>{matches.length} matching providers. Hosted authorisation is available for configured integrations.</p>
 <ul>{matches.slice(offset,offset+15).map(e=><li key={e.slug}><a href={'https://nango.dev/docs/api-integrations/'+e.slug} target="_blank" rel="noreferrer">{e.name}</a> · {e.auth} · {e.category} {available.some(s=>s.provider===e.slug)?'· enabled':selfService&&e.auth==='API_KEY'?<button type="button" onClick={()=>void act('ENABLE',e.slug)}>Enable {e.name} for this organisation</button>:null}</li>)}</ul>
 <button type="button" disabled={offset===0} onClick={()=>page(offset-15)}>Previous providers</button> <button type="button" disabled={offset+15>=matches.length} onClick={()=>page(offset+15)}>More providers</button></>}</fieldset>
 {available.length>0&&<fieldset disabled={locked||busy}><legend>Connect or reauthorise a provider</legend><label>Enabled integration <select aria-label="Enabled integration" value={sourceId} onChange={e=>selectSource(available.find(s=>s.integration===e.target.value))}>{available.map(s=><option key={s.integration} value={s.integration}>{s.name} · {s.integration}</option>)}</select></label>
 <button type="button" onClick={()=>void act('CONNECT')}>Start hosted authorisation</button> <button type="button" onClick={()=>void act('GRANTS')}>Check organisation connections</button>
 {grants.length>0&&<><label>Connection <select aria-label="Connection" value={id} onChange={e=>{choose(e.target.value);setLink('');tell('');}}>{grants.map(g=><option key={g.id} value={g.id}>{g.id} · {g.healthy?'authorised':'needs attention'}</option>)}</select></label>
 <button type="button" onClick={()=>void act('RENEW')}>Renew this connection</button>
 {source&&source.models.length>0&&<><label>Synced record model <select aria-label="Synced record model" value={model} onChange={e=>setModel(e.target.value)}>{source.models.map(m=><option key={m}>{m}</option>)}</select></label><button type="button" onClick={()=>void act('COLLECT')}>Collect and compare sync metadata</button><p>For daily or weekly collection, choose Managed provider sync in <a href={'/team/operations?'+new URLSearchParams({organizationId:workspace.organizationId,view:'connections'})}>Operations</a>. Use {source.integration}/{id}, model {model} and provider {source.provider}.</p></>}
 {source&&source.aiModels.length>0&&<><label>AI model <select aria-label="AI model" value={aiModel} onChange={e=>setAiModel(e.target.value)}>{source.aiModels.map(m=><option key={m}>{m}</option>)}</select></label><button onClick={()=>void act('SET_AI')}>Verify model and link AI account</button></>}</>}</fieldset>}
 {link&&<p><a href={link} rel="noreferrer" target="_blank">Continue securely with the provider</a>. Return here and check organisation connections.</p>}
 {account?.provider&&<p>Linked model · {account.provider} / {account.model} · <a href="/ai">Open AI Studio</a> <button disabled={locked||busy} onClick={()=>void act('UNLINK_AI')}>Unlink AI account</button></p>}
 <details><summary>Use RegPilot from your own ChatGPT GPT</summary><p>Create a dedicated read-only RegPilot credential below for the controls, tasks or regulatory metadata you want the GPT to see. Keep the GPT private to authorised users. In the GPT editor, add an Action, import the schema URL and set authentication to API Key with Bearer authentication. Enter the credential in the authentication settings.</p><a href="/api/v1/chatgpt" target="_blank" rel="noreferrer">Open the read-only GPT Action schema</a></details>
 {message&&<p role="status">{message}</p>}</section>;
}
