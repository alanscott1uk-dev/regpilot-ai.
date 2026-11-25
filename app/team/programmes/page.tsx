"use client";
import {CrosswalkPanel} from './crosswalk';
import {ReferenceStatementPanel} from './reference-statement';
import {useCallback,useEffect,useRef,useState} from 'react';
import {programmeMappingCsv,type ProgrammeFileReference} from '../../../lib/programme-mapping';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {useWorkspaceContext,workspaceHref} from '../../../lib/client/workspace-context';
import {workUuid} from '../../../lib/work-hub.mjs';
import shell from '../../workbench/workbench.module.css';
import css from './programmes.module.css';

type PackItem={key:string;title:string;description:string;why:string;evidenceHint:string;sourceUrl?:string;mappings?:string[];suggestedDays:number};
type Pack={id:string;version:number;title:string;description:string;items:PackItem[]};
type DraftItem=PackItem&{included:boolean;assigneeId:string;dueDate:string};
type PlanSummary={id:string;packId:string;packVersion:number;name:string;createdAt:string;total:number;completed:number;needsAttention:number;href:string};
type PlannedItem={sourceUrl?:string;reviewedFiles?:ProgrammeFileReference[];mappings?:string[];key:string;title:string;description:string;why:string;evidenceHint:string;assigneeId:string;ownerName:string;dueDate:string;
 task:{id:string;title:string;status:string;assigneeId:string|null;ownerName:string;dueDate:string;href:string}|null;attention:string[]};
type SavedPlan=PlanSummary&{evidenceLimited?:boolean;scopeRationale:string;recordHash:string;items:PlannedItem[];scope:string};
type Programmes={organizationId:string;role:string;canCreate:boolean;packs:Pack[];members:{id:string;email:string}[];membersLimited:boolean;programmes:PlanSummary[];programmesLimited:boolean;selected:SavedPlan|null};
type PlanInput={packId:string;packVersion:number;name:string;scopeRationale:string;items:{key:string;title:string;description:string;why:string;assigneeId:string;dueDate:string}[]};
type Preview=Omit<PlanInput,'items'>&{organizationId:string;items:(PlanInput['items'][number]&{evidenceHint:string;ownerName:string})[];token:string;existingProgrammeId:string|null;total:number;scope:string};
const today=()=>new Date().toISOString().slice(0,10);
const suggestedDate=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const date=(value:string)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Not recorded';
const taskState=(value:string)=>value==='COMPLETE'?'Recorded complete':value==='IN_PROGRESS'?'In progress':'Open';
function programmeLink(){
 if(typeof window==='undefined')return {id:'',error:''};
 const params=new URLSearchParams(window.location.search),values=params.getAll('programmeId');
 if(!values.length)return {id:'',error:''};
 if(values.length!==1||!workUuid(values[0])||params.getAll('organizationId').length!==1||!workUuid(params.get('organizationId')))return {id:'',error:'This programme link is incomplete or invalid. Choose a saved programme below.'};
 return {id:values[0].toLowerCase(),error:''};
}
export default function StarterProgrammes(){
 const workspace=useWorkspaceContext();
 const {organizationId,organisations,request,capture,chooseOrganization}=workspace;
 const [link,setLink]=useState(programmeLink),[stored,setStored]=useState<{revision:number;id:string;data:Programmes}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const [packId,setPackId]=useState(''),[name,setName]=useState(''),[scopeRationale,setScopeRationale]=useState(''),[items,setItems]=useState<DraftItem[]>([]),[owner,setOwner]=useState('');
 const [preview,setPreview]=useState<{revision:number;draft:number;data:Preview}|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
 const [uncertain,setUncertain]=useState<{packId:string;name:string}|null>(null);
 const sequence=useRef(0),draftVersion=useRef(0),inFlight=useRef(false),previewSection=useRef<HTMLElement|null>(null);
 const data=stored?.revision===workspace.revision&&stored.id===link.id&&!link.error?stored.data:null;
 const [packSearch,findPack]=useState('');
 const terms=packSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const visiblePacks=data?.packs.filter(p=>{const words=[p.title,p.description,...p.items.flatMap(i=>[i.title,...i.mappings??[]])].join(' ').toLowerCase();return terms.every(term=>words.includes(term));})??[];
 const pack=data?.packs.find(value=>value.id===packId);
 const selectedItems=items.filter(item=>item.included);
 const currentPreview=preview?.revision===workspace.revision&&preview.draft===draftVersion.current?preview.data:null;
 const blocked=busy||loading||!!uncertain;
 const canCreate=!!data?.canCreate;
 const href=(path:string,values:Record<string,string>={})=>workspaceHref(path,organizationId,values);
 const parseWorkspace=useCallback((result:Programmes,id:string,selectedId='')=>{
  if(result.organizationId!==id||!Array.isArray(result.packs)||!Array.isArray(result.members)||!Array.isArray(result.programmes)||result.programmesLimited!==false)throw new Error('The complete saved programme list could not be verified.');
  if(selectedId&&result.selected?.id!==selectedId)throw new Error('The linked programme is unavailable in this organisation.');
  return result;
 },[]);
 const read=useCallback(async(id:string,selectedId='',signal?:AbortSignal)=>parseWorkspace(await request('/api/workspace/programmes?'+new URLSearchParams({organizationId:id,...(selectedId?{programmeId:selectedId}:{})}),{signal}),id,selectedId),[parseWorkspace,request]);
 useEffect(()=>{
  const navigate=()=>setLink(programmeLink());
  const update=()=>setLink(previous=>previous.error?previous:programmeLink());
  window.addEventListener('popstate',navigate);window.addEventListener('regpilot-workspace-navigation',update);
  return()=>{window.removeEventListener('popstate',navigate);window.removeEventListener('regpilot-workspace-navigation',update);};
 },[]);
 useEffect(()=>{
  draftVersion.current++;setPackId('');setName('');setScopeRationale('');setItems([]);setOwner('');setPreview(null);setConfirmed(false);setUncertain(null);setNotice('');setError('');setBusy(false);
 },[workspace.revision]);
 useEffect(()=>{
  const valid=capture(),ticket=++sequence.current,controller=new AbortController();setStored(null);setError('');
  if(!organizationId||!workspace.signedIn||link.error){setLoading(false);return()=>controller.abort();}
  setLoading(true);
  read(organizationId,link.id,controller.signal).then(result=>{if(valid()&&ticket===sequence.current)setStored({revision:workspace.revision,id:link.id,data:result});})
   .catch(err=>{if(valid()&&ticket===sequence.current&&!controller.signal.aborted){setStored(null);setError(err instanceof Error?err.message:'Programmes could not be loaded.');}})
   .finally(()=>{if(valid()&&ticket===sequence.current)setLoading(false);});
  return()=>controller.abort();
 },[organizationId,workspace.signedIn,workspace.revision,link.id,link.error,refresh,read,capture]);
 useEffect(()=>{if(currentPreview)previewSection.current?.scrollIntoView({block:'start',behavior:'smooth'});},[currentPreview]);
 function invalidatePreview(){draftVersion.current++;setPreview(null);setConfirmed(false);setNotice('');}
 function updateItem(key:string,changes:Partial<DraftItem>){invalidatePreview();setItems(old=>old.map(item=>item.key===key?{...item,...changes}:item));}
 function writeLink(id:string){
  const url=new URL(window.location.href);if(organizationId)url.searchParams.set('organizationId',organizationId);
  if(id)url.searchParams.set('programmeId',id);else url.searchParams.delete('programmeId');
  window.history.replaceState(window.history.state,'',url.pathname+url.search);setLink({id,error:''});window.dispatchEvent(new Event('regpilot-workspace-navigation'));
 }
 function openProgramme(id:string){if(blocked)return;invalidatePreview();setPackId('');setItems([]);setStored(null);sequence.current++;writeLink(id);setRefresh(value=>value+1);}
 function choosePack(value:Pack){
  if(blocked)return;
  const existing=data?.programmes.find(plan=>plan.packId===value.id);if(existing){openProgramme(existing.id);return;}
  invalidatePreview();setPackId(value.id);setName(value.title);setScopeRationale('');setOwner('');
  setItems(value.items.map(item=>({...item,included:true,assigneeId:'',dueDate:suggestedDate(item.suggestedDays)})));
 }
 useEffect(()=>{
  if(!data||blocked||link.id||!canCreate)return;
  const url=new URL(window.location.href),values=url.searchParams.getAll('starter');
  if(values.length!==1)return;
  const selected=data.packs.find(p=>p.id===values[0]);
  if(!selected)return;
  url.searchParams.delete('starter');
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
  choosePack(selected);
  // Consume the public catalogue selection once, after workspace access and existing plans are loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[data,blocked,link.id,canCreate]);
 function input():PlanInput{
  if(!pack)throw new Error('Choose a starting programme first.');
  return {packId:pack.id,packVersion:pack.version,name:name.trim(),scopeRationale:scopeRationale.trim(),items:selectedItems.map(({key,title,description,why,assigneeId,dueDate})=>({key,title:title.trim(),description:description.trim(),why:why.trim(),assigneeId,dueDate}))};
 }
 function validation(){
  if(name.trim().length<8||name.trim().length>160)return 'Give the programme a name of 8 to 160 characters.';
  if(scopeRationale.trim().length<20||scopeRationale.trim().length>1200)return 'Explain why this programme fits your organisation in 20 to 1,200 characters.';
  if(!selectedItems.length)return 'Include at least one task.';
  for(const item of selectedItems){
   if(item.title.trim().length<8||item.description.trim().length<20||item.why.trim().length<20)return 'Each selected task needs a clear title, description and reason it applies.';
   if(!data?.members.some(member=>member.id===item.assigneeId)||!item.dueDate||item.dueDate<today()||item.dueDate>suggestedDate(366))return 'Give every selected task an eligible responsible person and a date within the next year.';
  }
  return '';
 }
 async function prepare(event:React.FormEvent){
  event.preventDefault();if(inFlight.current||!canCreate||uncertain)return;
  const problem=validation();if(problem){setError(problem);return;}
  inFlight.current=true;setBusy(true);setError('');setNotice('');setConfirmed(false);
  const valid=capture(),draft=draftVersion.current,payload=input();
  try{
   const result:Preview=await request('/api/workspace/programmes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,operation:'preview',...payload})});
   if(!valid()||draft!==draftVersion.current)return;
   if(result.organizationId!==organizationId||result.packId!==payload.packId||typeof result.token!=='string'||!Array.isArray(result.items)||result.items.length!==payload.items.length)throw new Error('The programme preview could not be matched to this selection.');
   setPreview({revision:workspace.revision,draft,data:result});
  }catch(err){if(valid()){setPreview(null);setError(err instanceof Error?err.message:'The programme could not be previewed.');}}
  finally{inFlight.current=false;if(valid())setBusy(false);}
 }
 async function apply(){
  if(inFlight.current||!canCreate||!currentPreview||!confirmed||uncertain)return;
  const valid=capture(),payload=input(),reviewed=currentPreview;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await request('/api/workspace/programmes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,operation:'apply',...payload,token:reviewed.token,confirm:true})});
   if(!valid())return;
   if(result.organizationId!==organizationId||result.packId!==payload.packId||!workUuid(result.id)||!Array.isArray(result.taskIds)||result.taskIds.length!==payload.items.length||new Set(result.taskIds).size!==result.taskIds.length||result.taskIds.some((id:unknown)=>!workUuid(id)))throw new Error('The saved programme response could not be verified.');
   setPreview(null);setConfirmed(false);setPackId('');setItems([]);setStored(null);writeLink(result.id);
   setNotice(result.reused?'The existing programme was found. Its original tasks remain in place.':'Your programme and owned tasks were saved. Open a task to add evidence and carry it through review.');
   setRefresh(value=>value+1);
  }catch(err){if(valid()){setPreview(null);setConfirmed(false);setUncertain({packId:payload.packId,name:payload.name});setError(err instanceof Error?err.message:'The saved result could not be confirmed.');}}
  finally{inFlight.current=false;if(valid())setBusy(false);}
 }
 async function reconcile(){
  if(inFlight.current||!uncertain||!organizationId)return;
  const valid=capture(),pending=uncertain;inFlight.current=true;setBusy(true);setError('');setStored(null);sequence.current++;
  try{
   const result=await read(organizationId);if(!valid())return;
   const found=result.programmes.find(plan=>plan.packId===pending.packId);
   if(found){
    const exact=await read(organizationId,found.id);if(!valid())return;
    setStored({revision:workspace.revision,id:found.id,data:exact});writeLink(found.id);setPackId('');setItems([]);setNotice('A saved programme for this starting point was found. Review its recorded tasks below. No creation request was repeated.');
   }else{setStored({revision:workspace.revision,id:'',data:result});writeLink('');setNotice('The complete saved list contains no programme for this starting point. Review your selection and create a fresh preview before trying again.');}
   setUncertain(null);setPreview(null);setConfirmed(false);
  }catch(err){if(valid()){setStored(null);setError(err instanceof Error?err.message:'Saved programmes could not be checked. Creation remains paused.');}}
  finally{inFlight.current=false;if(valid())setBusy(false);}
 }
 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
  <div className={shell.topbar}><span className={shell.crumb}>Workspace / Starter programmes</span><span className={shell.demo}>PRIVATE WORKSPACE</span></div>
  <header className={css.hero}><div><span className={css.eyebrow}>A PRACTICAL START, SHAPED TO YOUR BUSINESS</span><h1>Starter programmes</h1><p>Choose a ready-made work plan, adapt the tasks, and give each one an owner and a target date. Keep the resulting work connected to your evidence and reviews.</p></div>{organizationId&&<a href={href('/team/operations?view=programme')}>Import an existing programme →</a>}</header>
  {(workspace.error||link.error||error)&&<div className={css.alert} role="alert"><p>{workspace.error||link.error||error}</p>{(link.error||link.id)&&organizationId&&!uncertain&&<button type="button" onClick={()=>openProgramme('')}>Open programme list</button>}</div>}
  {notice&&<p className={css.notice} role="status">{notice}</p>}
  {uncertain&&<section className={css.notice} aria-label="Unconfirmed programme creation"><strong>Check the saved result before continuing</strong><p>The creation request may have been saved. Further changes are paused while you check the existing programme. This check reads saved records without repeating the request.</p><button type="button" disabled={busy} onClick={()=>void reconcile()}>{busy?'Checking saved programmes…':'Check saved programmes'}</button></section>}
  {!workspace.loading&&!workspace.signedIn&&<section className={css.panel}><h2>Sign in to your programmes</h2><p><a href="/audit-programmes">Browse the programmes and evidence requests</a></p><EmailSignIn destination="/team/programmes"/></section>}
  {!workspace.loading&&workspace.signedIn&&!organisations.length&&<section className={css.panel}><h2>Start with your organisation</h2><p>Create a workspace before choosing its programme and responsible people.</p><a className={css.primary} href="/team/setup">Create your organisation →</a></section>}
  {!!organisations.length&&<div className={css.toolbar}><label>Organisation<select aria-label="Organisation" disabled={busy||!!uncertain} value={organizationId} onChange={event=>{setStored(null);setLink({id:'',error:''});chooseOrganization(event.target.value);}}>{!organizationId&&<option value="" disabled>Choose an organisation</option>}{organisations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label><button type="button" disabled={!organizationId||blocked} onClick={()=>{setStored(null);setRefresh(value=>value+1);}}>Refresh programmes</button>{organizationId&&<span>Task completion records work done; it does not certify the business.</span>}</div>}
  {(workspace.loading||loading)&&<p className={css.notice} role="status">Loading starting points and saved programmes…</p>}
  {data&&<>
   <section className={css.panel} aria-label="Choose a starting programme"><div className={css.sectionHeader}><div><span className={css.eyebrow}>01 / CHOOSE A STARTING POINT</span><h2>Start with a focused plan</h2><p>These original operational templates help organise work. Choose what fits your business and confirm applicable requirements separately.</p></div>{data.programmes.length>0&&<a href="#saved-programmes">Your saved programmes ↓</a>}</div>
    <label>Find an audit programme<input type="search" value={packSearch} onChange={e=>findPack(e.target.value)} placeholder="e.g. wholesale, data protection, CC6.2"/></label>
    <p aria-live="polite">{visiblePacks.length} of {data.packs.length} programmes</p>{!visiblePacks.length&&<button onClick={()=>findPack('')}>Clear programme search</button>}
    <div className={css.packs}>{visiblePacks.map(value=>{const existing=data.programmes.find(plan=>plan.packId===value.id);return <article className={css.pack} key={value.id} data-selected={packId===value.id}><span className={css.eyebrow}>{value.items.length} EDITABLE TASKS</span><h3>{value.title}</h3><p>{value.description}</p><small>{existing?`${existing.completed} of ${existing.total} tasks recorded complete`:'Suggested planning dates · named owners · evidence prompts'}</small><button type="button" disabled={blocked} onClick={()=>choosePack(value)}>{existing?'Open saved programme':'Choose '+value.title}</button></article>;})}</div>
    {!canCreate&&<p className={css.hint}>You can inspect these starting points and saved work. An owner or administrator must create a programme.</p>}
   </section>
   {pack&&<section className={css.panel} aria-label="Tailor your programme"><ol className={css.steps} aria-label="Programme planning steps"><li><b>1</b>Choose a plan</li><li data-active={!currentPreview}><b>2</b>Tailor the work</li><li data-active={!!currentPreview}><b>3</b>Review and create</li></ol><span className={css.eyebrow}>02 / MAKE IT YOURS</span><h2>{pack.title}</h2><p>Keep the tasks you need, adapt the wording and assign responsibility. Suggested dates are planning choices, not legal deadlines.</p>
    <form onSubmit={event=>void prepare(event)}><fieldset disabled={blocked||!canCreate}><div className={css.fields}><label className={css.full}>Programme name<input aria-label="Programme name" required minLength={8} maxLength={160} value={name} onChange={event=>{invalidatePreview();setName(event.target.value);}}/></label><label className={css.full}>Why this programme fits<textarea aria-label="Why this programme fits" required minLength={20} maxLength={1200} rows={3} value={scopeRationale} onChange={event=>{invalidatePreview();setScopeRationale(event.target.value);}} placeholder="Describe the business scope, what you included and any limits or exclusions."/></label></div>
    <div className={css.assignment}><label>Assign selected tasks to<select aria-label="Assign selected tasks to" value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Choose a responsible person</option>{data.members.map(member=><option key={member.id} value={member.id}>{member.email}</option>)}</select></label><button type="button" disabled={!owner||!selectedItems.length} onClick={()=>{invalidatePreview();setItems(old=>old.map(item=>item.included?{...item,assigneeId:owner}:item));}}>Apply owner to selected tasks</button></div>
    {data.membersLimited&&<p className={css.hint}>The eligible member list reached its display limit. Check Team & access if a responsible person is not shown.</p>}
    <div className={css.taskEditors}>{items.map((item,index)=><article className={css.taskEditor} key={item.key} data-selected={item.included}><div className={css.taskHeader}><label className={css.check}><input type="checkbox" aria-label={'Include '+item.title} checked={item.included} onChange={event=>updateItem(item.key,{included:event.target.checked})}/><span>{item.title}</span></label><span>TASK {String(index+1).padStart(2,'0')}</span></div>
     {item.mappings&&<p>{item.mappings.join(" · ")}</p>}{item.included?<><div className={css.fields}><label className={css.full}>Task title<input aria-label={'Task title '+(index+1)} required minLength={8} maxLength={160} value={item.title} onChange={event=>updateItem(item.key,{title:event.target.value})}/></label><label className={css.full}>Work to do<textarea aria-label={'Work to do '+(index+1)} required minLength={20} maxLength={1000} rows={3} value={item.description} onChange={event=>updateItem(item.key,{description:event.target.value})}/></label><label>Responsible person<select aria-label={'Responsible person '+(index+1)} required value={item.assigneeId} onChange={event=>updateItem(item.key,{assigneeId:event.target.value})}><option value="">Choose a team member</option>{data.members.map(member=><option key={member.id} value={member.id}>{member.email}</option>)}</select></label><label>Target date<input aria-label={'Target date '+(index+1)} type="date" required min={today()} max={suggestedDate(366)} value={item.dueDate} onChange={event=>updateItem(item.key,{dueDate:event.target.value})}/></label><label className={css.full}>Why this task applies<textarea aria-label={'Why this task applies '+(index+1)} required minLength={20} maxLength={600} rows={2} value={item.why} onChange={event=>updateItem(item.key,{why:event.target.value})}/></label></div><details><summary>Evidence to consider</summary><p>{item.evidenceHint.split(' Publisher source: ')[0]}</p>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">Read the publisher guidance</a>}{!item.sourceUrl&&item.evidenceHint.includes(' Publisher source: ')&&<a href={item.evidenceHint.split(' Publisher source: ')[1]} target="_blank" rel="noreferrer">Open NHS publisher source</a>}</details></>:<p className={css.hint}>Excluded from this programme. Include it again if the work applies.</p>}
    </article>)}</div><div className={css.submitBar}><button type="submit" className={css.primary} disabled={!selectedItems.length}>{busy?'Preparing preview…':'Preview programme'}</button><p className={css.hint}>{selectedItems.length} selected tasks. Previewing saves no tasks.</p></div></fieldset></form>
   </section>}
   {currentPreview&&<section className={css.preview} aria-label="Programme preview" ref={previewSection}><span className={css.eyebrow}>03 / CHECK BEFORE CREATING</span><h2>{currentPreview.name}</h2><p>{currentPreview.scopeRationale}</p><div className={css.previewRows}>{currentPreview.items.map(item=><article key={item.key}><div><strong>{item.title}</strong><p>{item.description}</p><p>Why: {item.why}</p></div><small>{item.ownerName}<br/>Target {date(item.dueDate)}</small></article>)}</div><p>{currentPreview.scope}</p>
    {currentPreview.existingProgrammeId?<><p>A programme already exists for this starting point. Open its recorded tasks to continue without creating another set.</p><button type="button" disabled={blocked} onClick={()=>openProgramme(currentPreview.existingProgrammeId!)}>Open saved programme</button></>:<><label className={css.check}><input type="checkbox" checked={confirmed} disabled={blocked||!canCreate} onChange={event=>setConfirmed(event.target.checked)}/>I have reviewed these tasks, owners and dates.</label><button type="button" className={css.primary} disabled={blocked||!confirmed||!canCreate} onClick={()=>void apply()}>{busy?'Creating programme…':'Create '+currentPreview.total+' tasks'}</button></>}
   </section>}
   {data.selected&&<section className={css.panel} aria-label="Saved programme"><div className={css.sectionHeader}><div><span className={css.eyebrow}>YOUR SAVED WORK PLAN</span><h2>{data.selected.name}</h2><p>{data.selected.scopeRationale}</p></div><a href={href('/team/work')}>All team tasks →</a></div><div className={css.savedTop}><p>Created {date(data.selected.createdAt)} · {data.selected.needsAttention} tasks need attention</p><span>{data.selected.completed} / {data.selected.total} recorded complete</span></div><p className={css.hint}>{data.selected.scope}</p><button type="button" onClick={()=>{if(!data.selected)return;const a=document.createElement("a"),url=URL.createObjectURL(new Blob([programmeMappingCsv(data.selected)],{type:"text/csv;charset=utf-8"}));a.href=url;a.download="programme-control-mapping.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download control mapping CSV</button>{canCreate&&data.selected.items.some(i=>i.mappings?.length)&&<ReferenceStatementPanel key={workspace.revision+'/'+data.selected.id} w={workspace} id={data.selected.id}/>} {data.selected.evidenceLimited&&<p>Export includes the first 1,000 reviewed files. Open each task for its full history.</p>}<div className={css.savedTasks}>{data.selected.items.map(item=><article key={item.key}><div><h4>{item.task?.title||item.title}</h4><p>{item.task?`${taskState(item.task.status)} · ${item.task.ownerName} · Target ${date(item.task.dueDate)}`:'The original task is unavailable. Check the programme record before relying on its progress.'}</p>{item.attention.map(reason=><p className={css.unavailable} key={reason}>{reason}</p>)}<details><summary>Original plan and evidence prompt</summary><p>{item.description}</p><p>Why: {item.why}</p><p>Evidence: {item.evidenceHint}</p>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">Read the publisher guidance</a>}{item.mappings?.map(ref=><p key={ref}>{ref}</p>)}{item.reviewedFiles&&<p>{item.reviewedFiles.length} independently reviewed files in the current mapping.</p>}</details></div>{item.task&&<a href={item.task.href}>Open task →</a>}</article>)}</div></section>}
   {canCreate&&data.programmes.some(p=>p.packId==='iso27001-annex-a')&&data.programmes.some(p=>['soc2-iso27001','soc2-security'].includes(p.packId))&&<CrosswalkPanel key={workspace.revision} workspace={workspace} annexId={data.programmes.find(p=>p.packId==='iso27001-annex-a')!.id} socProgrammes={data.programmes.filter(p=>['soc2-iso27001','soc2-security'].includes(p.packId))}/>}
   <section className={css.panel} id="saved-programmes" aria-label="Saved programmes"><span className={css.eyebrow}>CONTINUE WHAT YOU STARTED</span><h2>Your programmes</h2>{data.programmes.length?<div className={css.savedGrid}>{data.programmes.map(plan=><article className={css.savedPlan} key={plan.id}><div className={css.savedTop}><div><h3>{plan.name}</h3><p>Created {date(plan.createdAt)} · {plan.needsAttention} tasks need attention</p></div><span>{plan.completed} / {plan.total} complete</span></div><button type="button" disabled={blocked} onClick={()=>openProgramme(plan.id)}>Open {plan.name}</button></article>)}</div>:<p className={css.empty}>No starter programme has been saved. Choose a starting point above and review the tasks before creating it.</p>}</section>
   <footer className={css.footer}>Starter programmes organise operational work. They do not import proprietary standards, establish regulatory completeness or approve compliance. Each created task uses the existing evidence and completion workflow.</footer>
  </>}
 </main></div>;
}
