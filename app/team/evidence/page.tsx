"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import shell from "../../workbench/workbench.module.css";
import ui from "./evidence.module.css";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Task={id:string;title:string;ownerName:string;status:string};
type Evidence={id:string;obligationId:string;filename:string;sizeBytes:number;sha256:string;createdAt:string;scanStatus:string;reviewStatus:"DRAFT"|"PENDING_REVIEW"|"APPROVED"|"REJECTED";reviewVersion:number;uploadedById:string|null;reviewerId:string|null;reviewedAt:string|null;reviewerNotes:string};
const fmt=(v:string)=>new Date(v).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
export default function TeamEvidence(){
 const [user,setUser]=useState<{id:string;email:string}|null>(null);
 const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState("");
 const [tasks,setTasks]=useState<Task[]>([]),[taskId,setTaskId]=useState("");
 const [rows,setRows]=useState<Evidence[]>([]);
 const [file,setFile]=useState<File|null>(null);
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [enabled,setEnabled]=useState<boolean|null>(null);
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
  let alive=true;
  void fetch("/api/workspace/evidence?organizationId=0&obligationId=0",{cache:"no-store"}).then(r=>{if(alive)setEnabled(r.status!==503)}).catch(()=>{if(alive)setEnabled(false)});
  async function load(){
   try{
    const session=await token();
    if(!session){setUser(null);return}
    const r=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+session},cache:"no-store"});
    if(!r.ok)throw new Error("Secure team workspace is not activated");
    const d=await r.json();
    if(!alive)return;
    setUser({id:d.userId||"",email:d.email});
    const list:Array<Org>=d.organisations||[];
    setOrgs(list);setOrgId(prev=>list.find(x=>x.id===prev)?prev:list[0]?.id||"");
   }catch(e){if(alive)setNotice(e instanceof Error?e.message:"Please sign in from the team workspace")}
  }
  try{const {data}=browserAuth().auth.onAuthStateChange(()=>setTimeout(()=>{if(alive)void load()},0));void load();return()=>{alive=false;data.subscription.unsubscribe()}}catch{setEnabled(false);return()=>{alive=false}};
 },[]);
 const loadTasks=useCallback(async(id:string)=>{
  if(!id)return;
  try{
   const r=await request("/api/workspace/obligations?organizationId="+encodeURIComponent(id));
   const d=await r.json();const list:Task[]=Array.isArray(d.items)?d.items:[];
   setTasks(list);
   const preferred=new URLSearchParams(window.location.search).get("taskId");
   setTaskId(prev=>list.find(t=>t.id===prev)?prev:list.find(t=>t.id===preferred)?.id||list[0]?.id||"");
  }catch(e){setNotice(e instanceof Error?e.message:"Could not load tasks")}
 },[request]);
 const loadEvidence=useCallback(async(org:string,task:string)=>{
  if(!org||!task){setRows([]);return}
  try{
   const r=await request("/api/workspace/evidence?organizationId="+encodeURIComponent(org)+"&obligationId="+encodeURIComponent(task));
   const d=await r.json();setRows(Array.isArray(d.evidence)?d.evidence:[]);
  }catch(e){setRows([]);setNotice(e instanceof Error?e.message:"Could not retrieve evidence")}
 },[request]);
 useEffect(()=>{setTasks([]);setRows([]);if(orgId&&user&&enabled)void loadTasks(orgId)},[orgId,user?.id,enabled,loadTasks]);
 useEffect(()=>{setRows([]);if(orgId&&taskId&&enabled)void loadEvidence(orgId,taskId)},[orgId,taskId,enabled,loadEvidence]);
 const org=orgs.find(x=>x.id===orgId);
 const canUpload=org&&org.role!=="VIEWER";
 const canReview=org&&["OWNER","ADMIN"].includes(org.role);
 const summary=useMemo(()=>({
  total:rows.length,approved:rows.filter(x=>x.reviewStatus==="APPROVED").length,pending:rows.filter(x=>x.reviewStatus==="PENDING_REVIEW").length
 }),[rows]);
 async function upload(e:React.FormEvent){
  e.preventDefault();if(!file||!taskId) return;setBusy(true);setNotice("");
  try{
   if(file.type!=="application/pdf"||file.size>5_000_000||file.size<30)throw new Error("Select a PDF between 30 bytes and 5 MB");
   const form=new FormData();form.append("organizationId",orgId);form.append("obligationId",taskId);form.append("file",file);
   await request("/api/workspace/evidence",{method:"POST",body:form});
   setFile(null);setNotice("PDF scanned, stored privately and placed in the independent evidence review queue.");
   await loadEvidence(orgId,taskId);
  }catch(e){setNotice(e instanceof Error?e.message:"Upload failed")}finally{setBusy(false)}
 }
 async function download(item:Evidence){
  setBusy(true);setNotice("");
  try{
   const r=await request("/api/workspace/evidence/"+encodeURIComponent(item.id)+"?organizationId="+encodeURIComponent(orgId));
   const bytes=await r.blob(),url=URL.createObjectURL(bytes),a=document.createElement("a");
   a.href=url;a.download=item.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);
   setNotice("Verified the stored SHA-256 digest before preparing the download.");
  }catch(e){setNotice(e instanceof Error?e.message:"Secure download failed")}finally{setBusy(false)}
 }
 async function decide(item:Evidence,decision:"APPROVED"|"REJECTED"){
  const notes=(reviewNotes[item.id]||"").trim();setBusy(true);setNotice("");
  try{
   if(notes.length<20)throw new Error("Explain this evidence decision in at least 20 characters");
   const response=await request("/api/workspace/evidence/"+encodeURIComponent(item.id),{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,decision,version:item.reviewVersion,notes})
   });
   await response.json();setReviewNotes(x=>({...x,[item.id]:""}));
   setNotice(decision==="APPROVED"?"Evidence reviewed by an independent person; suitability remains subject to applicable standards.":"Evidence rejected with a recorded rationale.");
   await loadEvidence(orgId,taskId);
  }catch(e){setNotice(e instanceof Error?e.message:"Decision failed")}finally{setBusy(false)}
 }
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a href="/workbench" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>PRIVATE EVIDENCE REVIEW</small></span></a>
   <div className={shell.sideCaption}>WORKSPACE</div>
   <nav className={shell.sideNav}><a href="/workbench">◉ &nbsp;Today's demo</a><a href="/team">▤ &nbsp;Private team tasks</a><a className={shell.active} aria-current="page" href="/team/evidence">▣ &nbsp;Evidence vault</a><a href="/ai">✦ &nbsp;AI Studio</a><a href="/traceability">◈ &nbsp;Traceability</a></nav>
   <div className={shell.sideFoot}><strong>Controlled access</strong><p>Upload, scan, verify and request independent review. Files are stored in a private bucket only when the security services are configured.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Private workspace / Evidence vault</span><span className={shell.demo}>STAGING PILOT · NO CUSTOMER DATA</span></div>
   <header className={ui.hero}><div><span>REGPILOT / EVIDENCE VAULT</span><h1>Evidence you can<br/><em>actually verify.</em></h1><p>Private PDF storage, antivirus scanning, SHA-256 file integrity and a second-person approval process.</p></div><div className={ui.heroGlyph}>◈</div></header>
   <div className={shell.warning}><strong>Not a compliance certificate.</strong> A clean antivirus check and a file hash do not establish the authenticity, completeness or regulatory adequacy of a document. Keep genuine confidential records out of the staging pilot.</div>
   {notice&&<p className={ui.notice} role="status">{notice}</p>}
   {enabled===false&&<section className={ui.setup}><strong>Evidence vault disabled in this environment.</strong><p>Activation requires a verified private Supabase Storage bucket, server-side credentials, an operational ClamAV scanner and database migration. Nothing is publicly uploaded while disabled.</p></section>}
   {!user&&<section className={ui.setup}>Sign in at the <a href="/team">private team workspace</a> to access authorised evidence records.</section>}
   {user&&orgs.length>0&&<>
    <section className={ui.bar}><div><label>Organisation<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label></div>
     <div><label>Task<select value={taskId} onChange={e=>setTaskId(e.target.value)}>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div></section>
    <section className={ui.stats}><div><span>Stored files</span><strong>{summary.total}</strong></div><div><span>Awaiting review</span><strong>{summary.pending}</strong></div><div><span>Independently reviewed</span><strong>{summary.approved}</strong></div></section>
    {canUpload&&taskId&&<section className={ui.card}><div className={ui.head}><span>01 / ADD EVIDENCE</span><h2>Attach a supporting PDF</h2><p>Files are only stored after the configured antivirus scanner returns an explicit clean result.</p></div>
     <form onSubmit={upload} className={ui.upload}><input type="file" accept="application/pdf,.pdf" required onChange={e=>setFile(e.target.files?.[0]||null)}/><button disabled={busy||!file||!enabled} type="submit">Scan and store privately</button></form>
     <p className={ui.help}>PDF only · Maximum 5 MB · Separate reviewer required · No public download links</p>
    </section>}
    <section className={ui.card}><div className={ui.head}><span>02 / REVIEW EVIDENCE</span><h2>Files linked to this task</h2><p>Files are accessed through verified organisation membership and checked against their stored SHA-256 fingerprint before download.</p></div>
     {rows.length===0?<p className={ui.empty}>No scanned PDF evidence has been recorded for this task.</p>:<div className={ui.list}>{rows.map(item=><article key={item.id} className={ui.record}><div className={ui.itemTop}><div><strong>{item.filename}</strong><p>Uploaded {fmt(item.createdAt)} · {(item.sizeBytes/1024).toFixed(1)} KB</p></div><span className={ui.pill}>{item.reviewStatus.replaceAll("_"," ")}</span></div>
      <div className={ui.meta}><span><b>Antivirus</b> {item.scanStatus}</span><span><b>SHA-256</b> {item.sha256.slice(0,18)}…</span><span><b>Review</b> Version {item.reviewVersion}</span></div>
      <button className={ui.secondary} disabled={busy} type="button" onClick={()=>void download(item)}>Download verified PDF</button> <a className={ui.secondary} style={{textDecoration:"none",display:"inline-block",marginLeft:7}} href={"/ai?evidenceId="+encodeURIComponent(item.id)}>AI document review (private pilot)</a>
      {item.reviewStatus==="PENDING_REVIEW"&&canReview&&item.uploadedById!==user.id&&<div className={ui.reviewForm}><label>Independent review rationale<textarea rows={3} minLength={20} maxLength={800} value={reviewNotes[item.id]||""} onChange={e=>setReviewNotes(x=>({...x,[item.id]:e.target.value}))} placeholder="Explain the scope, suitability and limitations of this evidence…"/></label><div><button disabled={busy} type="button" onClick={()=>void decide(item,"APPROVED")}>Record reviewed</button><button disabled={busy} type="button" onClick={()=>void decide(item,"REJECTED")}>Reject with rationale</button></div></div>}
      {item.reviewStatus==="PENDING_REVIEW"&&item.uploadedById===user.id&&<p className={ui.help}>A different owner or administrator must review evidence you uploaded.</p>}
      {item.reviewerNotes&&<p className={ui.reviewNote}>Reviewer rationale: {item.reviewerNotes}</p>}
     </article>)}</div>}
    </section>
   </>}
  </main>
 </div>;
}
