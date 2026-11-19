"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import WorkspaceNav from '../../components/workspace-nav';
import EmailSignIn from '../../components/email-sign-in';
import {useWorkspaceContext,workspaceHref} from '../../../lib/client/workspace-context';
import {workUuid} from '../../../lib/work-hub.mjs';
import {DocumentReader} from './document-reader';
import shell from '../../workbench/workbench.module.css';
import css from './evidence-library.module.css';

type FileRecord={
 id:string;filename:string;contentType:string;sizeBytes:number;sha256:string;
 scanStatus:string;reviewStatus:string;reviewVersion:number;createdAt:string;reviewedAt:string|null;
 uploadedById:string|null;reviewerId:string|null;uploaderName:string;reviewerName:string|null;
 originalTask:{id:string;title:string;status:string;href:string};taskEvidenceHref:string;
 canReview:boolean;canReuse:boolean;reuseReason:string;
};
type AssessmentUse={id:string;taskId:string;title:string;status:string;current:boolean;reason:string|null;href:string};
type Target={id:string;title:string;status:string;ownerName:string;href:string};
type Library={
 organizationId:string;role:string;canPrepare:boolean;items:FileRecord[];total:number;page:number;pages:number;pageSize:number;
 summary:{all:number;approved:number;pending:number;rejected:number;quarantined:number;mine:number};generatedAt:string;
 selected:(FileRecord&{
  uses:{scope:string;items:AssessmentUse[];total:number;truncated:boolean};
  targets:{items:Target[];total:number;page:number;pages:number;pageSize:number};
 })|null;
};
type Filters={q:string;review:string;format:string;uploader:string;page:number};
const initialFilters:Filters={q:'',review:'all',format:'all',uploader:'all',page:1};
const reviewLabels:Record<string,string>={APPROVED:'File approved',PENDING_REVIEW:'Awaiting file review',REJECTED:'File rejected',DRAFT:'Draft file'};
const reviewOptions=[['all','All review states'],['approved','File approved'],['pending','Awaiting file review'],['rejected','File rejected'],['quarantined','Quarantined files']];
const when=(value:string|null)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Not recorded';
const fileType=(file:FileRecord)=>file.contentType==='application/pdf'?'PDF':'Word';
const size=(bytes:number)=>bytes>=1_000_000?(bytes/1_000_000).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1000))+' KB';
function useLabel(use:AssessmentUse){
 if(use.status==='DRAFT')return 'Draft · independent review needed';
 if(use.status==='NEEDS_WORK')return 'Further work required';
 if(use.status==='ACCEPTED')return use.current?'Accepted · recorded inputs match':'Accepted · check changed inputs';
 return use.status.toLowerCase().replaceAll('_',' ');
}
function linkedFile(){
 if(typeof window==='undefined')return {evidenceId:'',error:''};
 const params=new URLSearchParams(window.location.search),ids=params.getAll('evidenceId');
 if(!ids.length)return {evidenceId:'',error:''};
 const organisations=params.getAll('organizationId');
 if(ids.length!==1||!workUuid(ids[0])||organisations.length!==1||!workUuid(organisations[0]))return {evidenceId:'',error:'This evidence link is incomplete or invalid. Open the library and choose a file.'};
 return {evidenceId:ids[0].toLowerCase(),error:''};
}

export default function EvidenceLibrary(){
 const workspace=useWorkspaceContext();
 const {organizationId,organisations,request,requestResponse,capture,chooseOrganization}=workspace;
 const [link,setLink]=useState(linkedFile),[filters,setFilters]=useState<Filters>(initialFilters),[search,setSearch]=useState('');
 const [targetSearch,setTargetSearch]=useState(''),[targetQuery,setTargetQuery]=useState(''),[targetPage,setTargetPage]=useState(1),[targetId,setTargetId]=useState('');
 const [stored,setStored]=useState<{revision:number;key:string;data:Library}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[downloading,setDownloading]=useState(false);
 const serial=useRef(0),downloadLock=useRef(false),selectedId=useRef(link.evidenceId),focusSelected=useRef(false),detail=useRef<HTMLElement|null>(null);
 selectedId.current=link.evidenceId;
 const href=useCallback((path:string,values:Record<string,string>={})=>workspaceHref(path,organizationId,values),[organizationId]);
 useEffect(()=>{
  // Context discovery may append the first organisation to the URL. It must not
  // repair an incomplete exact-file link into an unintended company selection.
  const update=()=>setLink(previous=>previous.error?previous:linkedFile());
  const navigate=()=>setLink(linkedFile());
  window.addEventListener('popstate',navigate);window.addEventListener('regpilot-workspace-navigation',update);
  return()=>{window.removeEventListener('popstate',navigate);window.removeEventListener('regpilot-workspace-navigation',update);};
 },[]);
 const query=useMemo(()=>new URLSearchParams({organizationId,q:filters.q,review:filters.review,format:filters.format,uploader:filters.uploader,page:String(filters.page),
  ...(link.evidenceId?{evidenceId:link.evidenceId,targetQ:targetQuery,targetPage:String(targetPage)}:{})}).toString(),[organizationId,filters,link.evidenceId,targetQuery,targetPage]);
 const data=stored?.revision===workspace.revision&&stored.key===query&&!link.error?stored.data:null;
 const selected=data?.selected;
 const selectedTarget=selected?.targets.items.find(task=>task.id===targetId);
 const currentOrg=organisations.find(org=>org.id===organizationId);
 useEffect(()=>{
  const current=capture(),ticket=++serial.current,controller=new AbortController();
  setStored(null);setError('');setNotice('');setDownloading(false);
  if(!workspace.signedIn||!organizationId||link.error){setLoading(false);return()=>controller.abort();}
  setLoading(true);
  request('/api/workspace/evidence/library?'+query,{signal:controller.signal}).then((result:Library)=>{
   if(!current()||ticket!==serial.current)return;
   if(result.organizationId!==organizationId||!Array.isArray(result.items)||!result.summary||!Number.isInteger(result.total))throw new Error('The evidence library could not be verified for this organisation.');
   if(link.evidenceId&&result.selected?.id!==link.evidenceId)throw new Error('The linked evidence is unavailable in this organisation.');
   setStored({revision:workspace.revision,key:query,data:result});
  }).catch(err=>{
   if(current()&&ticket===serial.current&&!controller.signal.aborted){setStored(null);setError(err instanceof Error?err.message:'The evidence library could not be loaded.');}
  }).finally(()=>{if(current()&&ticket===serial.current)setLoading(false);});
  return()=>{controller.abort();};
 },[organizationId,workspace.signedIn,workspace.revision,capture,request,query,link.evidenceId,link.error,refresh]);
 useEffect(()=>{setTargetId('');setTargetSearch('');setTargetQuery('');setTargetPage(1);},[link.evidenceId,workspace.revision]);
 useEffect(()=>{
  if(selected&&focusSelected.current){focusSelected.current=false;detail.current?.focus();detail.current?.scrollIntoView({block:'start',behavior:'smooth'});}
 },[selected]);
 function openFile(id:string){
  if(!organizationId)return;
  serial.current++;setStored(null);setError('');setNotice('');setTargetId('');setTargetSearch('');setTargetQuery('');setTargetPage(1);
  const url=new URL(window.location.href);url.searchParams.set('organizationId',organizationId);url.searchParams.delete('taskId');
  if(id)url.searchParams.set('evidenceId',id);else url.searchParams.delete('evidenceId');
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
  selectedId.current=id;setLink({evidenceId:id,error:''});setRefresh(value=>value+1);focusSelected.current=!!id;
  window.dispatchEvent(new Event('regpilot-workspace-navigation'));
 }
 function changeOrganization(id:string){
  serial.current++;setStored(null);setError('');setNotice('');setSearch('');setFilters(initialFilters);setLink({evidenceId:'',error:''});
  selectedId.current='';setTargetId('');setTargetSearch('');setTargetQuery('');setTargetPage(1);chooseOrganization(id);
 }
 function changeFilter(key:'review'|'format'|'uploader',value:string){setFilters(old=>({...old,[key]:value,page:1}));}
 async function download(file:FileRecord){
  if(downloadLock.current||loading)return;
  downloadLock.current=true;const current=capture(),fileId=file.id,ticket=serial.current;setDownloading(true);setNotice('');
  const valid=()=>current()&&selectedId.current===fileId&&ticket===serial.current;
  try{
   const response=await requestResponse('/api/workspace/evidence/'+fileId+'?organizationId='+encodeURIComponent(organizationId));
   const bytes=await response.blob();if(!valid())return;
   const url=URL.createObjectURL(bytes),anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Original file prepared after the server verified its stored fingerprint.');
  }catch(err){if(valid())setNotice(err instanceof Error?err.message:'The verified original could not be downloaded.');}
  finally{downloadLock.current=false;if(valid())setDownloading(false);}
 }
 return <div className={shell.app}>
  <WorkspaceNav/>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / Evidence</span><span className={shell.demo}>PRIVATE WORKSPACE</span></div>
   <header className={css.hero}>
    <div><span className={css.eyebrow}>FIND IT ONCE. USE IT WITH CONTEXT.</span><h1>Evidence library</h1><p>Find your company’s files, see the assessments using them, and bring existing evidence into the next task.</p></div>
    {organizationId&&<a className={css.primary} href={href('/team/work')}>Choose a task to add evidence →</a>}
   </header>
   {(workspace.error||link.error||error)&&<div className={css.alert} role="alert"><p>{workspace.error||link.error||error}</p>{organizationId&&(link.evidenceId||link.error)&&<button type="button" onClick={()=>openFile('')}>Back to all evidence</button>}</div>}
   {notice&&<p className={css.notice} role="status">{notice}</p>}
   {!workspace.loading&&!workspace.signedIn&&<section className={css.panel}><h2>Sign in to your evidence library</h2><EmailSignIn destination="/team/evidence"/></section>}
   {!workspace.loading&&workspace.signedIn&&!organisations.length&&<section className={css.panel}><h2>Keep evidence with your company</h2><p>Create your organisation, then choose a task for the first document.</p><a className={css.primary} href="/team/setup">Set up your organisation →</a></section>}
   {!!organisations.length&&<div className={css.workspaceBar}><label>Organisation<select aria-label="Organisation" value={organizationId} onChange={e=>changeOrganization(e.target.value)}>{!organizationId&&<option value="" disabled>Choose an organisation</option>}{organisations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label><button type="button" disabled={!organizationId||loading} onClick={()=>{serial.current++;setStored(null);setRefresh(value=>value+1);}}>Refresh library</button><p>Files belong to {currentOrg?.name||'the selected organisation'}.</p></div>}
   {workspace.signedIn&&organizationId&&<>
    <div className={css.metrics} aria-label="Evidence library totals">
     {[['All files',data?.summary.all,'all'],['File approved',data?.summary.approved,'approved'],['Awaiting file review',data?.summary.pending,'pending'],['File rejected',data?.summary.rejected,'rejected']].map(([label,count,review])=><button type="button" key={String(review)} onClick={()=>changeFilter('review',String(review))} aria-pressed={filters.review===review}><span>{label}</span><strong>{typeof count==='number'?count:'—'}</strong></button>)}
    </div>
    <section className={css.panel} aria-label="Find company evidence">
     <form className={css.searchForm} onSubmit={event=>{event.preventDefault();setFilters(old=>({...old,q:search.trim(),page:1}));}}><label>Search evidence<input type="search" aria-label="Search evidence" maxLength={120} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filename or original task…"/></label><button className={css.primary} type="submit">Search files</button></form>
     <div className={css.filters}>
      <label>Review status<select aria-label="Review status" value={filters.review} onChange={e=>changeFilter('review',e.target.value)}>{reviewOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label>Document format<select aria-label="Document format" value={filters.format} onChange={e=>changeFilter('format',e.target.value)}><option value="all">All documents</option><option value="pdf">PDF</option><option value="docx">Word</option></select></label>
      <label>Uploaded by<select aria-label="Uploaded by" value={filters.uploader} onChange={e=>changeFilter('uploader',e.target.value)}><option value="all">Anyone in this company</option><option value="mine">Me</option></select></label>
     </div>
    </section>
   </>}
   {(workspace.loading||loading)&&<p className={css.notice} role="status">Loading the latest evidence records…</p>}
   {selected&&<section className={css.detail} aria-label="Selected evidence" tabIndex={-1} ref={detail}>
    <div className={css.detailHeader}><div><span className={css.eyebrow}>ONE STORED FILE · {fileType(selected)}</span><h2>{selected.filename}</h2><p>{size(selected.sizeBytes)} · Uploaded {when(selected.createdAt)}</p></div><button type="button" onClick={()=>openFile('')}>Back to all evidence</button></div>
    <div className={css.detailColumns}>
     <div className={css.fileFacts}>
      <span className={css.badge} data-state={selected.scanStatus!=='CLEAN'?'QUARANTINED':selected.reviewStatus}>{selected.scanStatus!=='CLEAN'?'Quarantined':reviewLabels[selected.reviewStatus]||selected.reviewStatus}</span>
      <dl><div><dt>Original task</dt><dd>{selected.originalTask.title}</dd></div><div><dt>Uploaded by</dt><dd>{selected.uploaderName||'Not recorded'}</dd></div><div><dt>File reviewer</dt><dd>{selected.reviewerName||'No reviewer recorded'}</dd></div><div><dt>Review recorded</dt><dd>{when(selected.reviewedAt)} · Version {selected.reviewVersion}</dd></div></dl>
      <div className={css.actions}><button type="button" disabled={downloading||selected.scanStatus!=='CLEAN'} onClick={()=>void download(selected)}>{downloading?'Preparing original…':'Download verified original'}</button><a href={selected.originalTask.href}>Open original task</a><a href={selected.taskEvidenceHref}>{selected.canReview?'Review this file':'Open task evidence'}</a></div>
      <details className={css.fingerprint}><summary>Stored file fingerprint</summary><code>{selected.sha256}</code><p>Downloads verify the stored bytes against this fingerprint. File approval and suitability for a particular task are separate decisions.</p></details>
      <DocumentReader key={organizationId+':'+selected.id+':'+workspace.revision} organizationId={organizationId} evidenceId={selected.id} request={requestResponse}/>
     </div>
     <aside className={css.reuse} aria-label="Reuse this evidence"><span className={css.eyebrow}>BUILD ON EXISTING EVIDENCE</span><h3>Use this file in another assessment</h3><p>Keep the same original and review what it supports for the selected task. Continuing selects the file; you decide when to prepare an assessment.</p><p className={css.reuseReason}>{selected.reuseReason}</p>
      {selected.canReuse&&data?.canPrepare?<>
       <form className={css.targetSearch} onSubmit={event=>{event.preventDefault();setTargetId('');setTargetPage(1);setTargetQuery(targetSearch.trim());}}><label>Find a task for this evidence<input type="search" aria-label="Find a task for this evidence" maxLength={120} placeholder="Task title or owner…" value={targetSearch} onChange={e=>setTargetSearch(e.target.value)}/></label><button type="submit">Find tasks</button></form>
       <label>Task to assess<select aria-label="Task to assess" value={selectedTarget?.id||''} onChange={e=>setTargetId(e.target.value)}><option value="">Choose a source-linked task</option>{selected.targets.items.map(task=><option key={task.id} value={task.id}>{task.title} · {task.ownerName}</option>)}</select></label>
       <p className={css.hint}>{selected.targets.total} matching open source-linked {selected.targets.total===1?'task':'tasks'}. {selected.targets.total?'Each task keeps its own source and review decision.':'Review applicable source requirements to create an assessment task.'}</p>
       {selected.targets.pages>1&&<div className={css.targetPagination}><button type="button" disabled={selected.targets.page<=1} onClick={()=>{setTargetId('');setTargetPage(page=>page-1);}}>Previous tasks</button><span>Page {selected.targets.page} of {selected.targets.pages}</span><button type="button" disabled={selected.targets.page>=selected.targets.pages} onClick={()=>{setTargetId('');setTargetPage(page=>page+1);}}>Next tasks</button></div>}
       {selectedTarget?<a className={css.primary} href={selectedTarget.href}>Use this evidence →</a>:<p className={css.hint}>Choose a task to continue.</p>}
      </>:<a href={selected.taskEvidenceHref}>Open the original task evidence →</a>}
     </aside>
    </div>
    <section className={css.uses} aria-label="Recorded assessment uses"><div className={css.sectionHeading}><div><span className={css.eyebrow}>WHERE THIS FILE WAS SELECTED</span><h3>Recorded assessment uses</h3></div><span>{selected.uses.total} {selected.uses.total===1?'assessment':'assessments'}</span></div><p className={css.hint}>This list covers source-linked assessments. Other uses in programmes, policies, answers and audit disclosures are outside this view.</p>
     {!selected.uses.items.length?<p className={css.empty}>No source-linked assessment has recorded this file yet.</p>:<div className={css.useRows}>{selected.uses.items.map(use=><article key={use.id}><div><span className={css.useState}>{useLabel(use)}</span><h4>{use.title}</h4><p>{use.reason||(use.current?'Recorded inputs and participant context match. Inspect the decision and its scope before relying on this file for the task.':'Inspect the assessment before relying on this file for the task.')}</p></div><a href={use.href}>Open assessment →</a></article>)}</div>}
     {selected.uses.truncated&&<p className={css.hint}>Showing the latest {selected.uses.items.length} of {selected.uses.total} recorded assessments. Earlier records remain with their tasks.</p>}
    </section>
   </section>}
   {data&&<section className={css.panel} aria-label="Company evidence files"><div className={css.sectionHeading}><div><h2>{filters.q?'Search results':'Company files'}</h2><p>{data.total} matching {data.total===1?'file':'files'} · {data.pageSize} per page</p></div>{link.evidenceId&&<span className={css.hint}>Selected file remains open above</span>}</div>
    {!data.items.length?<div className={css.empty}><h3>{data.summary.all?'No files match these filters':'Start with the evidence you already have'}</h3><p>{data.summary.all?'Try another filename, task or review state.':'Choose a task, upload its supporting PDF or Word document, then request an independent file review.'}</p>{!data.summary.all&&<a className={css.primary} href={href('/team/work')}>Choose a task →</a>}</div>:<div className={css.fileList}>{data.items.map(file=><article key={file.id} className={css.fileRow} data-selected={link.evidenceId===file.id}><span className={css.fileIcon} aria-hidden="true">{fileType(file)}</span><div className={css.fileSummary}><button type="button" aria-label={'Open evidence: '+file.filename} onClick={()=>openFile(file.id)}>{file.filename}</button><p>{file.originalTask.title}</p><small>{size(file.sizeBytes)} · {when(file.createdAt)} · {file.uploaderName||'Uploader not recorded'}</small></div><span className={css.badge} data-state={file.scanStatus!=='CLEAN'?'QUARANTINED':file.reviewStatus}>{file.scanStatus!=='CLEAN'?'Quarantined':reviewLabels[file.reviewStatus]||file.reviewStatus}</span></article>)}</div>}
    <nav className={css.pagination} aria-label="Evidence pages"><button type="button" disabled={data.page<=1} onClick={()=>setFilters(old=>({...old,page:old.page-1}))}>Previous files</button><span>Page {data.page} of {Math.max(1,data.pages)}</span><button type="button" disabled={data.page>=data.pages} onClick={()=>setFilters(old=>({...old,page:old.page+1}))}>Next files</button></nav>
   </section>}
   {data&&<footer className={css.footer}>Recorded file reviews do not establish that a document satisfies every requirement. Review the relevant task’s source, scope and assessment before relying on reused evidence.</footer>}
  </main>
 </div>;
}
