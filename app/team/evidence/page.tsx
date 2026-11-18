"use client";
import EmailSignIn from "../../components/email-sign-in";
import WorkspaceNav from "../../components/workspace-nav";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {workUuid} from "../../../lib/work-hub.mjs";
import shell from "../../workbench/workbench.module.css";
import ui from "./evidence.module.css";
import {DocumentReader} from "./document-reader";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Task={id:string;title:string;ownerName:string;status:string};
type Evidence={id:string;obligationId:string;filename:string;sizeBytes:number;sha256:string;createdAt:string;scanStatus:string;reviewStatus:"DRAFT"|"PENDING_REVIEW"|"APPROVED"|"REJECTED";reviewVersion:number;uploadedById:string|null;reviewerId:string|null;reviewedAt:string|null;reviewerNotes:string};
const fmt=(v:string)=>new Date(v).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
function showSelection(orgId:string,taskId=""){
  const url=new URL(window.location.href);
  if(orgId)url.searchParams.set("organizationId",orgId);
  else url.searchParams.delete("organizationId");
  if(taskId)url.searchParams.set("taskId",taskId);
  else url.searchParams.delete("taskId");
  window.history.replaceState(window.history.state,"",url.pathname+url.search);
  window.dispatchEvent(new Event("regpilot-workspace-navigation"));
}
export default function TeamEvidence(){
 const [user,setUser]=useState<{id:string;email:string}|null>(null);
 const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState("");
 const [tasks,setTasks]=useState<Task[]>([]),[taskId,setTaskId]=useState("");
 const [rows,setRows]=useState<Evidence[]>([]);
 const [file,setFile]=useState<File|null>(null);
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [enabled,setEnabled]=useState<boolean|null>(null);
 const [authLoading,setAuthLoading]=useState(true);
 const [fileState,setFileState]=useState<"loading"|"ready"|"failed">("loading");
 const [retry,setRetry]=useState(0);
 const taskRequest=useRef(0),filesRequest=useRef(0),fileInput=useRef<HTMLInputElement>(null);

 const active=useRef({orgId,taskId,userId:user?.id});active.current={orgId,taskId,userId:user?.id};
 const token=async()=> (await browserAuth().auth.getSession()).data.session?.access_token||"";
 const request=useCallback(async(path:string,opts:RequestInit={})=>{
  const session=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!session)throw new Error("Sign in from the private team workspace");
  const r=await fetch(path,{...opts,headers:{...opts.headers,authorization:"Bearer "+session},cache:"no-store"});
  if(!r.ok){
   const json=await r.json().catch(()=>({error:"Request unavailable"}));
   throw new Error(json.error||"Unable to retrieve evidence");
  }
  return r;
 },[]);
 useEffect(()=>{
  let alive=true,sequence=0;
  void fetch("/api/workspace/evidence?organizationId=0&obligationId=0",{cache:"no-store"}).then(r=>{if(alive)setEnabled(r.status!==503)}).catch(()=>{if(alive)setEnabled(false)});
  async function load(){
   const seq=++sequence;
   try{
    const session=await token();
    if(!session){if(alive&&seq===sequence){taskRequest.current++;setUser(null);setRows([]);setOrgs([]);setOrgId("");setTasks([]);setTaskId("");}return}
    const r=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+session},cache:"no-store"});
    if(!r.ok)throw new Error("Secure team workspace is not activated");
    const d=await r.json();
    if(!alive||seq!==sequence)return;
    if(active.current.userId!==d.userId){taskRequest.current++;setRows([]);setTasks([]);setTaskId("");}
    setUser({id:d.userId||"",email:d.email});
    const list:Array<Org>=d.organisations||[];
    const desired=new URLSearchParams(window.location.search).get("organizationId");
    setOrgs(list);
    if(desired && !list.some(o=>o.id===desired)){
     setOrgId("");setNotice("This evidence link belongs to an unavailable organisation. Choose a workspace to continue.");
    }else setOrgId(desired||list[0]?.id||"");
   }catch(e){if(alive&&seq===sequence){taskRequest.current++;setUser(null);setOrgs([]);setOrgId("");setRows([]);setTasks([]);setTaskId("");setNotice(e instanceof Error?e.message:"Please sign in from the team workspace");}}finally{if(alive&&seq===sequence)setAuthLoading(false);}
  }
  try{const {data}=browserAuth().auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){sequence++;taskRequest.current++;setUser(null);setRows([]);setOrgs([]);setOrgId("");setTasks([]);setTaskId("");active.current={orgId:"",taskId:"",userId:undefined};}else setTimeout(()=>{if(alive)void load()},0);});void load();return()=>{alive=false;sequence++;taskRequest.current++;data.subscription.unsubscribe()}}catch{setAuthLoading(false);setEnabled(false);return()=>{alive=false;taskRequest.current++}};
 },[]);
 const loadTasks=useCallback(async(id:string)=>{
  if(!id)return;
  const generation=++taskRequest.current,actor=active.current.userId;
  const current=()=>generation===taskRequest.current&&active.current.orgId===id&&active.current.userId===actor;
  try{
   const r=await request("/api/workspace/obligations?organizationId="+encodeURIComponent(id));
   const d=await r.json();const list:Task[]=Array.isArray(d.items)?d.items:[];
   const params=new URLSearchParams(window.location.search);
   const requestedOrg=params.get('organizationId');
   const preferred=!requestedOrg||requestedOrg===id?params.get('taskId'):null;
   if(preferred){
    if(!workUuid(preferred))throw new Error('The linked task identifier is invalid. Open the work hub to choose a task.');
    if(!list.some(t=>t.id===preferred)){
     // Exact, tenant-scoped lookup prevents a deep link outside the legacy first 100
     // records from silently selecting an unrelated task for an evidence upload.
     const response=await request('/api/workspace/work?'+new URLSearchParams({organizationId:id,taskId:preferred}));
     const exact=await response.json();
     if(exact.organizationId!==id||exact.task?.id!==preferred)throw new Error('The linked task is unavailable. Open the work hub to choose a task.');
     list.unshift({id:exact.task.id,title:exact.task.title,ownerName:exact.task.ownerName,status:exact.task.status});
    }
   }
   if(!current())return;
   const selected=preferred||list[0]?.id||'';
   setTasks(list);setTaskId(selected);showSelection(id,selected);
  }catch(e){if(current()){setTasks([]);setTaskId('');setRows([]);setNotice(e instanceof Error?e.message:'Could not load the requested task');}}
 },[request]);
 const loadEvidence=useCallback(async(org:string,task:string)=>{
  if(!org||!task)return;
  const seq=++filesRequest.current,actor=active.current.userId;
  const current=()=>seq===filesRequest.current&&active.current.orgId===org&&active.current.taskId===task&&active.current.userId===actor;
  setFileState("loading");
  try{
   const r=await request("/api/workspace/evidence?"+new URLSearchParams({organizationId:org,obligationId:task}));
   const d=await r.json();
   if(!current())return;
   setRows(d.evidence);setFileState("ready");
  }catch(e){if(current()){setRows([]);setFileState("failed");setNotice(e instanceof Error?e.message:"Could not retrieve evidence");}}
 },[request]);
 useEffect(()=>{setTasks([]);setTaskId('');setRows([]);setFile(null);setReviewNotes({});if(orgId&&user&&enabled)void loadTasks(orgId);return()=>{taskRequest.current++;};},[orgId,user?.id,enabled,loadTasks,retry]);
 useEffect(()=>{setRows([]);if(orgId&&taskId&&enabled)void loadEvidence(orgId,taskId);return()=>{filesRequest.current++;};},[orgId,taskId,enabled,loadEvidence,user?.id]);
 const operationIsCurrent=(scope:typeof active.current)=>active.current.orgId===scope.orgId&&active.current.taskId===scope.taskId&&active.current.userId===scope.userId;
 const org=orgs.find(x=>x.id===orgId);
 const canUpload=org&&org.role!=="VIEWER";
 const canReview=org&&["OWNER","ADMIN"].includes(org.role);
 const summary=useMemo(()=>({
  total:rows.length,approved:rows.filter(x=>x.reviewStatus==="APPROVED").length,pending:rows.filter(x=>x.reviewStatus==="PENDING_REVIEW").length
 }),[rows]);
 async function upload(e:React.FormEvent){
  e.preventDefault();if(!file||!taskId) return;const scope=active.current;setBusy(true);setNotice("");
  try{
   if(! /\.(pdf|docx)$/i.test(file.name)||file.size>5_000_000||file.size<30)throw new Error("Select a PDF or Word document between 30 bytes and 5 MB");
   const form=new FormData();form.append("organizationId",orgId);form.append("obligationId",taskId);form.append("file",file);
   await request("/api/workspace/evidence",{method:"POST",body:form});
   if(!operationIsCurrent(scope))return;
   setFile(null);if(fileInput.current)fileInput.current.value="";
   setNotice("File stored. A different owner or administrator can now review it.");
   await loadEvidence(orgId,taskId);
  }catch(e){if(operationIsCurrent(scope))setNotice(e instanceof Error?e.message:"Upload failed")}finally{setBusy(false)}
 }
 async function download(item:Evidence){
  const scope=active.current;setBusy(true);setNotice("");
  try{
   const r=await request("/api/workspace/evidence/"+encodeURIComponent(item.id)+"?organizationId="+encodeURIComponent(orgId));
   const bytes=await r.blob();if(!operationIsCurrent(scope))return;const url=URL.createObjectURL(bytes),a=document.createElement("a");
   a.href=url;a.download=item.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);
   setNotice("Verified the stored SHA-256 digest before preparing the download.");
  }catch(e){if(operationIsCurrent(scope))setNotice(e instanceof Error?e.message:"Secure download failed")}finally{setBusy(false)}
 }
 async function decide(item:Evidence,decision:"APPROVED"|"REJECTED"){
  const scope=active.current;const notes=(reviewNotes[item.id]||"").trim();setBusy(true);setNotice("");
  try{
   if(notes.length<20)throw new Error("Explain this evidence decision in at least 20 characters");
   const response=await request("/api/workspace/evidence/"+encodeURIComponent(item.id),{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,decision,version:item.reviewVersion,notes})
   });
   await response.json();if(!operationIsCurrent(scope))return;setReviewNotes(x=>({...x,[item.id]:""}));
   setNotice(decision==="APPROVED"?"Evidence reviewed by an independent person; suitability remains subject to applicable standards.":"Evidence rejected with a recorded rationale.");
   await loadEvidence(orgId,taskId);
  }catch(e){if(operationIsCurrent(scope))setNotice(e instanceof Error?e.message:"Decision failed")}finally{setBusy(false)}
 }
 return <div className={shell.app}>
  <WorkspaceNav/>
  <main className={shell.main}>
   <header className={ui.header}><div><p>Private workspace</p><h1>Task evidence</h1><p>Attach a document, inspect the original and record an independent review.</p></div><span>Staging · fictional records only</span></header>
   {notice&&<p className={ui.notice} role="status">{notice}</p>}
   {enabled===false&&<section className={ui.setup}><strong>Evidence vault disabled in this environment.</strong><p>Activation requires a verified private Supabase Storage bucket, server-side credentials, an operational ClamAV scanner and database migration. Nothing is publicly uploaded while disabled.</p></section>}
   {!user&&!authLoading&&enabled===true&&<section className={ui.card}><h2>Sign in to open this task</h2><EmailSignIn destination="/team/work"/></section>}
   {user&&orgs.length===0&&<p className={ui.empty}>Your account has no workspace. <a href="/team">Open team setup</a></p>}
   {user&&orgs.length>0&&<>
    <section className={ui.bar}><div><label>Organisation<select value={orgId} disabled={busy} onChange={e=>{
     const id=e.target.value;taskRequest.current++;active.current={...active.current,orgId:id,taskId:""};
     showSelection(id);setNotice("");setTaskId("");setTasks([]);setRows([]);setFile(null);setOrgId(id);
    }}>{!orgId&&<option value="">Choose an organisation</option>}{orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label></div>
     <div><label>Task<select value={taskId} disabled={busy||!tasks.length} onChange={e=>{
      const id=e.target.value;active.current={...active.current,taskId:id};showSelection(orgId,id);
      setFile(null);setRows([]);setFileState("loading");setReviewNotes({});setNotice("");setTaskId(id);
     }}>{!tasks.length&&<option value="">No task selected</option>}{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div></section>
    {orgId&&<div className={ui.taskLinks}><a href={"/team/work?"+new URLSearchParams({organizationId:orgId,...(taskId?{taskId}:{})})}>{taskId?"Return to task":"Choose a task in the work hub"}</a>
     {enabled&&!taskId&&<button type="button" onClick={()=>{setNotice("");setRetry(r=>r+1);}}>Reload tasks</button>}</div>}
    {taskId&&enabled&&<>
    {fileState==="ready"&&<section className={ui.stats}><div><span>Stored files</span><strong>{summary.total}</strong></div><div><span>Awaiting review</span><strong>{summary.pending}</strong></div><div><span>Independently reviewed</span><strong>{summary.approved}</strong></div></section>}
    {canUpload&&taskId&&<section className={ui.card}><div className={ui.head}><h2>Attach a policy or evidence document</h2><p>Files are only stored after the configured antivirus scanner returns an explicit clean result.</p></div>
     <form onSubmit={upload} className={ui.upload}><input key={orgId+taskId} ref={fileInput} aria-label="Evidence document" type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" required onChange={e=>setFile(e.target.files?.[0]||null)}/><button disabled={busy||!file||!enabled} type="submit">Scan and store privately</button></form>
     <p className={ui.help}>PDF or Word (.docx) · Maximum 5 MB · Separate reviewer required · No public download links</p>
    </section>}
    <section className={ui.card}><div className={ui.head}><h2>Files linked to this task</h2><p>Files are accessed through verified organisation membership and checked against their stored SHA-256 fingerprint before download.</p></div>
     {fileState==="loading"?<p role="status">Loading task files…</p>:fileState==="failed"?<button className={ui.secondary} onClick={()=>void loadEvidence(orgId,taskId)}>Retry loading files</button>:rows.length===0?<p className={ui.empty}>No scanned evidence has been recorded for this task.</p>:<div className={ui.list}>{rows.map(item=><article key={item.id} className={ui.record}><div className={ui.itemTop}><div><strong>{item.filename}</strong><p>Uploaded {fmt(item.createdAt)} · {(item.sizeBytes/1024).toFixed(1)} KB</p></div><span className={ui.pill}>{item.reviewStatus.replaceAll("_"," ")}</span></div>
      <div className={ui.meta}><span><b>Antivirus</b> {item.scanStatus}</span><span><b>SHA-256</b> {item.sha256.slice(0,18)}…</span><span><b>Review</b> Version {item.reviewVersion}</span></div>
      <button className={ui.secondary} disabled={busy} type="button" onClick={()=>void download(item)}>Download verified original</button> <a className={ui.secondary} style={{textDecoration:"none",display:"inline-block",marginLeft:7}} href={"/ai?"+new URLSearchParams({organizationId:orgId,evidenceId:item.id})}>AI document review (private pilot)</a>
      <DocumentReader key={orgId+":"+item.id} organizationId={orgId} evidenceId={item.id} request={request}/>{item.reviewStatus==="PENDING_REVIEW"&&canReview&&item.uploadedById!==user.id&&<div className={ui.reviewForm}><label>Independent review rationale<textarea rows={3} minLength={20} maxLength={800} value={reviewNotes[item.id]||""} onChange={e=>setReviewNotes(x=>({...x,[item.id]:e.target.value}))} placeholder="Explain the scope, suitability and limitations of this evidence…"/></label><div><button disabled={busy} type="button" onClick={()=>void decide(item,"APPROVED")}>Record reviewed</button><button disabled={busy} type="button" onClick={()=>void decide(item,"REJECTED")}>Reject with rationale</button></div></div>}
      {item.reviewStatus==="PENDING_REVIEW"&&item.uploadedById===user.id&&<p className={ui.help}>A different owner or administrator must review evidence you uploaded.</p>}
      {item.reviewerNotes&&<p className={ui.reviewNote}>Reviewer rationale: {item.reviewerNotes}</p>}
     </article>)}</div>}
    </section>
    </>}
   </>}
  </main>
 </div>;
}
