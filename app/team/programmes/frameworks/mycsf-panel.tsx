'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {myCsfWorkspace} from '../../../../lib/server/mycsf-service';
import type {useWorkspaceContext} from '../../../../lib/client/workspace-context';
import css from '../programmes.module.css';

type Data=Awaited<ReturnType<typeof myCsfWorkspace>>;
type Selection=NonNullable<Data['selected']>;
type Mapping=Selection['mappings'][number];
type Ctx=ReturnType<typeof useWorkspaceContext>;
type Change=(fields:Record<string,unknown>)=>Promise<any>;
const endpoint='/api/workspace/mycsf';
const levels=['POLICY','PROCEDURE','IMPLEMENTED','MEASURED','MANAGED'];
function ExportForm({mapping,busy,change}:{mapping:Mapping;busy:boolean;change:Change}){
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),remote=String(f.get('remote')??'').trim();void change({op:'export',mapping:mapping.id,mappingVersion:mapping.version,documentType:Number(f.get('type')),typeName:f.get('name'),...(remote?{existingDocument:Number(remote)}:{}),confirm:f.get('confirm')==='on'});}
 return <details><summary>Export approved evidence</summary><form onSubmit={submit}><fieldset disabled={busy} className={css.fields}><legend>MyCSF document destination</legend>
  <label>MyCSF document type ID<input name="type" type="number" min="1" required/></label><label>MyCSF document type name<input name="name" required maxLength={100}/></label>
  <label>Existing MyCSF document ID (optional)<input name="remote" type="number" min="1"/></label>
  <label><input name="confirm" type="checkbox" required/> I authorise sending this evidence to this MyCSF assessment.</label>
  <button>Verify and export evidence</button></fieldset></form></details>;
}
function Requirement({row,data,actor,canEdit,busy,change}:{row:Selection['rows'][number];data:Selection;actor:string;canEdit:boolean;busy:boolean;change:Change}){
 const related=data.mappings.filter(m=>m.buid===row.buid);
 const reuse=data.reuse.filter(s=>s.buid===row.buid);
 const files=new Map(data.evidence.map(f=>[f.id,f.name+' · '+f.task]));
 for(const candidate of reuse)if(!files.has(candidate.id))files.set(candidate.id,candidate.filename);
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),evidence=String(f.get('evidence'));void change({op:'map',buid:row.buid,evidence,levels:f.getAll('level'),reason:f.get('reason'),mappingVersion:related.find(m=>m.evidenceId===evidence)?.version??0});}
 return <details><summary>{row.buid} · {row.reference||row.domain}</summary><p>{row.text}</p><p>{row.domain} · {row.applicability}</p>
  {related.map(m=><div key={m.id}><strong>{m.filename}</strong><p>{m.levels.join(', ')} · {m.reason}</p><p>{m.stale?'Scope or evidence changed. Review the mapping again.':m.exported?'Linked to MyCSF document '+m.remoteDocument:m.approved?'Approved for handoff':'Awaiting independent approval'}</p>
   {canEdit&&!m.stale&&!m.approved&&m.mappedBy!==actor&&<button disabled={busy} onClick={()=>void change({op:'approve',mapping:m.id,mappingVersion:m.version})}>Approve mapping</button>}
   {canEdit&&!m.stale&&m.approved&&!m.exported&&<ExportForm mapping={m} busy={busy} change={change}/>}</div>)}
  {!!reuse.length&&<><p>Other assessments approved these files for the same requirement revision. Check the scope before reusing a file.</p><ul>{reuse.map(s=><li key={s.id+s.assessment}>{s.filename} · {s.assessment}</li>)}</ul></>}
  {canEdit&&files.size>0&&<form onSubmit={submit}><fieldset className={css.fields} disabled={busy}><legend>Map reviewed evidence</legend>
   <label>Evidence file<select required name="evidence" defaultValue=""><option value="" disabled>Choose a reviewed file</option>{[...files].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Why this evidence covers the requirement<textarea name="reason" required minLength={8} maxLength={1000}/></label>
   {(data.tier==='r2'?levels:['IMPLEMENTED']).map(l=><label key={l}><input type="checkbox" name="level" value={l} defaultChecked={l==='IMPLEMENTED'}/>{l.toLowerCase()}</label>)}
   <button>Save evidence mapping</button></fieldset></form>}
 </details>;
}
export default function MyCsfPanel({tier,ctx}:{tier:string;ctx:Ctx}){
 const {request,capture,organizationId}=ctx;
 const [id,setId]=useState(''),[page,setPage]=useState(1),[terms,setTerms]=useState({q:'',evidenceQuery:''}),[refresh,reload]=useState(0);
 const [state,setState]=useState<{key:string;data:Data}|null>(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const [offered,setOffered]=useState<{id:number;name:string;type:string}[]>([]),[subscriber,setSubscriber]=useState(''),[remote,setRemote]=useState('');
 const [confirmDisconnect,setConfirmDisconnect]=useState(false);const user=useRef<HTMLInputElement>(null),secret=useRef<HTMLInputElement>(null),writing=useRef(false);
 const query=new URLSearchParams({organizationId,tier,...terms,page:String(page),...(id?{connection:id}:{})}).toString(),key=query+'|'+refresh;
 const data=state?.key===key?state.data:null,selected=data?.selected;
 useEffect(()=>{const ctrl=new AbortController();let live=true;setError('');request(endpoint+'?'+query,{signal:ctrl.signal}).then((d:Data)=>{if(live&&d.organizationId===organizationId)setState({key,data:d});}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;ctrl.abort();};},[request,key,query,organizationId]);
 async function change(fields:Record<string,unknown>){
  if(writing.current)return;writing.current=true;setBusy(true);setError('');setStatus('');const current=capture();
  try{const r=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,...(selected&&!['connect','discover'].includes(String(fields.op))?{connection:selected.id,version:selected.version}:{}),...fields})});if(!current())return;
   if(fields.op==='discover'){setOffered(r.assessments);setRemote('');setStatus(r.assessments.length?'Choose an assessment from this subscriber.':'MyCSF listed no assessments for this subscriber.');return;}
   if(fields.op==='connect'){if(secret.current)secret.current.value='';setOffered([]);setRemote('');setId(r.id);}
   if(fields.op==='disconnect'){setId('');setConfirmDisconnect(false);}
   setStatus(fields.op==='export'?'MyCSF confirmed the evidence link.':'Saved.');reload(v=>v+1);
  }catch(e){if(current())setError(e instanceof Error?e.message:'MyCSF request failed.');}finally{writing.current=false;if(current())setBusy(false);}
 }
 function connection(e:FormEvent<HTMLFormElement>){e.preventDefault();const credentials={username:user.current?.value||'',key:secret.current?.value||''};
  const existing=data?.connections.find(x=>x.subscriber===Number(subscriber)&&x.assessment===Number(remote));
  void change(remote?{op:'connect',subscriber:Number(subscriber),assessment:Number(remote),tier,credentials,version:existing?.version??0}:{op:'discover',subscriber:Number(subscriber),credentials});
 }
 return <section className={css.panel} aria-label="MyCSF assessment"><h2>MyCSF assessment</h2>
  {error&&<p role="alert">{error} <button onClick={()=>reload(v=>v+1)}>Refresh</button></p>}{status&&<p role="status">{status}</p>}
  {!data&&!error&&<p>Loading MyCSF access…</p>}
  {data&&!data.licensed&&<p>Live MyCSF access awaits HITRUST authorisation. You can use the RegPilot workpapers in this workspace now.</p>}
  {data?.licensed&&data.canEdit&&<details><summary>Connect or replace a MyCSF credential</summary><form onSubmit={connection}><fieldset disabled={busy} className={css.fields}><legend>Subscriber API access</legend>
   <label>MyCSF subscriber ID<input type="number" min="1" required value={subscriber} onChange={e=>{setSubscriber(e.target.value);setOffered([]);setRemote('');}}/></label>
   <label>MyCSF API username<input ref={user} required autoComplete="off" onChange={()=>{setOffered([]);setRemote('');}}/></label><label>MyCSF API key<input ref={secret} required type="password" autoComplete="off" onChange={()=>{setOffered([]);setRemote('');}}/></label>
   {!!offered.length&&<label>Subscriber assessment<select value={remote} onChange={e=>setRemote(e.target.value)}><option value="">Choose an assessment</option>{offered.map(a=><option key={a.id} value={a.id}>{a.name} · {a.type}</option>)}</select></label>}
   <button>{remote?'Connect selected assessment':'Find subscriber assessments'}</button></fieldset></form></details>}
  {!!data?.connections.length&&<label>Connected assessment<select value={id} disabled={busy} onChange={e=>{setId(e.target.value);setPage(1);setConfirmDisconnect(false);setTerms({q:'',evidenceQuery:''});}}><option value="">Choose an assessment</option>{data.connections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
  {data?.canEdit&&id&&<><label><input type="checkbox" checked={confirmDisconnect} onChange={e=>setConfirmDisconnect(e.target.checked)}/> Remove this stored credential, scoped requirements and mappings</label><button disabled={busy||!confirmDisconnect} onClick={()=>void change({op:'disconnect',connection:id,version:data.connections.find(x=>x.id===id)?.version})}>Disconnect assessment</button></>}
  {selected&&data&&<><h3>{selected.name}</h3><p>{selected.total} scoped requirements · {selected.mapped} current evidence mappings · {selected.staleCount} need review.</p>
   <p>Last scope update {new Date(selected.syncedAt).toLocaleString('en-GB')}{selected.failure?' · '+selected.failure.replaceAll('_',' ').toLowerCase():''}</p>
   {data.canEdit&&<button disabled={busy} onClick={()=>void change({op:'sync'})}>Sync scope from MyCSF</button>}
   <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setPage(1);setTerms({q:String(f.get('q')??''),evidenceQuery:String(f.get('files')??'')});}}><label>Find scoped requirements<input name="q" type="search" maxLength={150} defaultValue={terms.q}/></label>
   {data.canEdit&&<label>Find reviewed files or evidence tasks<input name="files" type="search" maxLength={150} defaultValue={terms.evidenceQuery}/></label>}<button>Search assessment</button></form>
   {!selected.evidence.length&&data.canEdit&&<p>Available evidence comes from independently reviewed workspace files.</p>}
   {selected.rows.map(r=><Requirement key={r.buid+'-'+r.hash} row={r} data={selected} actor={ctx.userId} canEdit={data.canEdit} busy={busy} change={change}/>)}
   <nav aria-label="MyCSF requirement pages"><button disabled={selected.page===1} onClick={()=>setPage(v=>v-1)}>Previous</button> Page {selected.page} of {selected.pages} <button disabled={selected.page===selected.pages} onClick={()=>setPage(v=>v+1)}>Next</button></nav>
  </>}
 </section>;
}
