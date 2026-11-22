'use client';
import ModelControlMonitor from './model-control-monitor';
import {useState} from 'react';
import type {Integration} from '../../../lib/connectors/marketplace';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';

type Entry={slug:string;name:string;auth:string;category:string;docs?:string};
type Choice={provider:string|null;model:string|null;version:string|null};
export default function IntegrationDirectory({workspace,locked}:{workspace:ReturnType<typeof useWorkspaceContext>;locked:boolean}){
 const [selfService,setSelfService]=useState(false);
 const [entries,setEntries]=useState<Entry[]>([]),[available,setAvailable]=useState<Integration[]>([]),[search,filter]=useState('');
 const [sourceId,select]=useState(''),[grants,setGrants]=useState<{id:string;healthy:boolean}[]>([]),[id,choose]=useState(''),[model,setModel]=useState(''),[aiModel,setAiModel]=useState('');
 const [deployed,setDeployed]=useState<string[]>([]);
 const [account,setAccount]=useState<Choice|null>(null),[link,setLink]=useState(''),[message,tell]=useState(''),[busy,lock]=useState(false),[offset,page]=useState(0);
 const [direct,setDirect]=useState<{id:string;version:number;scope:string;model:string}[]>([]),[directId,chooseDirect]=useState(''),[draftConsent,consent]=useState(false);
 const chosen=direct.find(d=>d.id===directId);
 const source=available.find(s=>s.integration===sourceId);
 const matches=entries.filter(e=>(e.name+' '+e.category+' '+e.slug).toLowerCase().includes(search.trim().toLowerCase()));
 const models=Array.from(new Set([...(source?.models??[]),...deployed]));
 function selectSource(s?:Integration){setDeployed([]);select(s?.integration??'');setGrants([]);choose('');setModel(s?.models[0]??'');setAiModel(s?.aiModels[0]??'');setLink('');tell('');}
 async function act(action:string,slug?:string){
  const valid=workspace.capture();lock(true);tell('');setLink('');
  try{
   const body:Record<string,unknown>={action,organizationId:workspace.organizationId};
   if(action==='ENABLE')body.slug=slug;
   if(!['DIRECTORY','AVAILABLE','UNLINK_AI','ENABLE','SET_DIRECT_AI'].includes(action))body.integration=sourceId;
   if(['RENEW','COLLECT','SET_AI','MODELS'].includes(action))body.connectionId=id;
   if(action==='COLLECT')body.model=model;
   if(action==='SET_DIRECT_AI'&&chosen){body.connectionId=chosen.id;body.configVersion=chosen.version;body.confirmDrafting=draftConsent;body.previous=account?.version??null;}
   if(action==='SET_AI')body.model=aiModel;
   if(action==='SET_AI'||action==='UNLINK_AI')body.previous=account?.version??null;
   const v=await workspace.request('/api/workspace/integration-directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!valid())return;
   if(action==='ENABLE'){const enabled=v.source as Integration;setAvailable(old=>[...old.filter(s=>s.integration!==enabled.integration),enabled]);selectSource(enabled);tell('Ready to authorise '+enabled.name+' for this organisation.');}
   if(action==='DIRECTORY'){setEntries(v.entries);page(0);tell(v.entries.length+' provider catalogue entries refreshed.');}
   if(action==='AVAILABLE'){setDirect(v.direct??[]);chooseDirect(v.direct?.[0]?.id??'');consent(false);setSelfService(v.selfService===true);setAvailable(v.integrations);setAccount(v.ai);selectSource(v.integrations[0]);tell(v.enabled?v.integrations.length+' integrations enabled for hosted connection.':'Hosted connections await broker configuration.');}
   if(action==='GRANTS'){setDeployed([]);setModel(source?.models[0]??'');setGrants(v.grants);choose(v.grants[0]?.id??'');tell(v.grants.length+' connections returned for this organisation.');}
   if(action==='MODELS'){setDeployed(v.models);setModel(v.models[0]??'');tell(v.deployed.length+' deployed record models identified on this connection.');}
   if(action==='CONNECT'||action==='RENEW')setLink(v.link);
   if(action==='SET_AI'||action==='SET_DIRECT_AI'||action==='UNLINK_AI'){consent(false);setAccount(v);tell(v.provider?'Model access confirmed. Select your organisation account in AI Studio.':'AI account unlinked from RegPilot.');}
   if(action==='COLLECT')tell(v.count+' synced records sampled · '+v.deleted+' marked deleted · '+(v.limited?'partial sample':'end of returned pages')+' · '+(v.changed===null?'first collection':v.changed?'sample changed since '+v.previousCheckedAt:'same metadata as '+v.previousCheckedAt)+' · source sync '+v.syncState+' · receipt '+v.receiptId);
  }catch(e){if(valid())tell(e instanceof Error?e.message:'Connection request unavailable.');}finally{if(valid())lock(false);}
 }
 return <section><h2>Integration directory and AI accounts</h2><fieldset disabled={busy||locked}><legend>Provider catalogue</legend>
 <button type="button" onClick={()=>void act('DIRECTORY')}>Refresh provider catalogue</button> <button type="button" onClick={()=>void act('AVAILABLE')}>Refresh enabled integrations</button>
 {entries.length>0&&<><label>Find a provider or category <input value={search} onChange={e=>{filter(e.target.value);page(0);}}/></label><p>{matches.length} matching providers. Hosted authorisation is available for configured integrations.</p>
 <ul>{matches.slice(offset,offset+15).map(e=><li key={e.slug}><a href={e.docs??'https://nango.dev/docs/api-integrations/'+e.slug} target="_blank" rel="noreferrer">{e.name}</a> · {e.auth} · {e.category} {available.some(s=>s.provider===e.slug)?'· enabled':selfService&&e.auth==='API_KEY'?<button type="button" onClick={()=>void act('ENABLE',e.slug)}>Enable {e.name} for this organisation</button>:null}</li>)}</ul>
 <button type="button" disabled={offset===0} onClick={()=>page(offset-15)}>Previous providers</button> <button type="button" disabled={offset+15>=matches.length} onClick={()=>page(offset+15)}>More providers</button></>}</fieldset>
 {available.length>0&&<fieldset disabled={locked||busy}><legend>Connect or reauthorise a provider</legend><label>Enabled integration <select aria-label="Enabled integration" value={sourceId} onChange={e=>selectSource(available.find(s=>s.integration===e.target.value))}>{available.map(s=><option key={s.integration} value={s.integration}>{s.name} · {s.integration}</option>)}</select></label>
 <button type="button" onClick={()=>void act('CONNECT')}>Start hosted authorisation</button> <button type="button" onClick={()=>void act('GRANTS')}>Check organisation connections</button>
 {grants.length>0&&<><label>Connection <select aria-label="Connection" value={id} onChange={e=>{choose(e.target.value);setDeployed([]);setModel(source?.models[0]??'');setLink('');tell('');}}>{grants.map(g=><option key={g.id} value={g.id}>{g.id} · {g.healthy?'authorised':'needs attention'}</option>)}</select></label>
 <button type="button" onClick={()=>void act('RENEW')}>Renew this connection</button>
 <button type="button" onClick={()=>void act('MODELS')}>Check deployed sync models</button>
 {source&&models.length>0&&<><label>Synced record model <select aria-label="Synced record model" value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m}>{m}</option>)}</select></label><button type="button" onClick={()=>void act('COLLECT')}>Collect and compare sync metadata</button><p>For daily or weekly collection, choose Managed provider sync in <a href={'/team/operations?'+new URLSearchParams({organizationId:workspace.organizationId,view:'connections'})}>Operations</a>. Use {source.integration}/{id}, model {model} and provider {source.provider}.</p></>}
 {source&&id&&model&&deployed.includes(model)&&<ModelControlMonitor key={[workspace.organizationId,source.integration,id,model].join(':')} workspace={workspace} scope={{integration:source.integration,provider:source.provider,connectionId:id,model}}/>}
 {source&&source.aiModels.length>0&&<><label>AI model <select aria-label="AI model" value={aiModel} onChange={e=>setAiModel(e.target.value)}>{source.aiModels.map(m=><option key={m}>{m}</option>)}</select></label><button onClick={()=>void act('SET_AI')}>Verify model and link AI account</button></>}</>}</fieldset>}
 <fieldset disabled={locked||busy}><legend>Company AI account</legend>
 <p>Save an OpenAI project model or an approved private model server as a connection in <a href={'/team/operations?'+new URLSearchParams({organizationId:workspace.organizationId,view:'connections'})}>Operations</a>, then refresh enabled integrations here.</p>
 {chosen&&<><label>Model connection <select value={chosen.id} onChange={e=>{chooseDirect(e.target.value);consent(false);}}>{direct.map(d=><option key={d.id} value={d.id}>{d.scope} · {d.model}</option>)}</select></label>
 <label><input type="checkbox" checked={draftConsent} onChange={e=>consent(e.target.checked)}/> Authorise this model for user-requested drafts when private processing is enabled. Provider charges may apply.</label>
 <button type="button" disabled={!draftConsent} onClick={()=>void act('SET_DIRECT_AI')}>Verify and link this model</button></>}</fieldset>
 {link&&<p><a href={link} rel="noreferrer" target="_blank">Continue securely with the provider</a>. Return here and check organisation connections.</p>}
 {account?.provider&&<p>Linked model · {account.provider} / {account.model} · <a href="/ai">Open AI Studio</a> <button disabled={locked||busy} onClick={()=>void act('UNLINK_AI')}>Unlink AI account</button></p>}
 <details><summary>Connect ChatGPT or another AI client</summary><p>Create a dedicated read-only RegPilot credential below. Choose the controls, tasks and reviewed regulatory sources your AI client may read. Enter the credential only in the client’s connection settings.</p><p><a href="/api/v1/mcp/plugin">Download private RegPilot plugin</a> for clients supporting bearer-authenticated MCP plugins. The package targets this RegPilot environment. Your workspace administrator controls plugin availability.</p><p>For an existing private GPT that supports Actions, import the schema below and select API Key with Bearer authentication. Share access only with authorised workspace users.</p><a href="/api/v1/chatgpt" target="_blank" rel="noreferrer">Open the read-only GPT Action schema</a></details>
 {message&&<p role="status">{message}</p>}</section>;
}
