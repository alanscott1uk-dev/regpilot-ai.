"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {createRequestScope} from "../../../lib/client/request-scope.mjs";
import {RECOGNITION_TRACKS} from "../../../lib/recognition/registry.mjs";
import PackagePanel from "./package-panel";
import shell from "../../workbench/workbench.module.css";
import styles from "./recognition.module.css";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Work={tracks:Array<typeof RECOGNITION_TRACKS[number]&{publicStatus:string;task:null|{id:string;title:string;ownerName:string;status:string;dueDate:string;completionException:boolean;independentlyReviewedFiles:number}}>;notice:string};
export default function RecognitionWorkspace(){
 const [orgs,setOrgs]=useState<Org[]>([]),[selected,setSelected]=useState(""),[data,setData]=useState<Work|null>(null);
 const [message,setMessage]=useState(""),[loading,setLoading]=useState(true),[working,setWorking]=useState("");
 const [generation,setGeneration]=useState(0),[packTrack,setPackTrack]=useState("");
 const scope=useRef(createRequestScope()),preferred=useRef(""),mutation=useRef(false);
 const scopeCheck=useCallback(()=>{
  const current=scope.current.capture();return current.scope===selected&&current.version===generation&&!current.signal.aborted;
 },[selected,generation]);
 const replaceScope=useCallback((next:string)=>{
  const version=scope.current.invalidate(next);
  setData(null);setPackTrack("");setWorking("");setSelected(next);setGeneration(version);
 },[]);
 const send=useCallback(async(path:string,options:RequestInit={}):Promise<Response>=>{
  const ticket=scope.current.capture();
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!scope.current.current(ticket))throw Error("Workspace changed; stale request cancelled");
  if(!token)throw Error("Sign in to your private workspace first");
  const headers=new Headers(options.headers);headers.set("authorization","Bearer "+token);
  const res=await fetch(path,{...options,cache:"no-store",headers,signal:ticket.signal});
  if(!scope.current.current(ticket))throw Error("Workspace changed; stale response discarded");
  if(!res.ok){const body=await res.json().catch(()=>({error:"Service temporarily unavailable"}));throw Error(body.error||"Cannot access recognition workspace");}
  return res;
 },[]);
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const ticket=scope.current.capture(),res=await send(path,options),body=await res.json();
  if(!scope.current.current(ticket))throw Error("Workspace changed; stale response discarded");
  return body;
 },[send]);
 useEffect(()=>{
  let active=true,sequence=0,unsubscribe=()=>{};
  async function init(){
   const serial=++sequence,ticket=scope.current.capture();
   try{
    const body=await request("/api/ai/context");
    if(!active||serial!==sequence||!scope.current.current(ticket))return;
    const list:Org[]=Array.isArray(body.organisations)?body.organisations:[];
    const next=list.some(o=>o.id===preferred.current)?preferred.current:list[0]?.id||"";
    preferred.current=next;setOrgs(list);replaceScope(next);setMessage("");
   }catch(error){if(active&&serial===sequence&&scope.current.current(ticket)){setOrgs([]);replaceScope("");setMessage(error instanceof Error?error.message:"Sign in required");}}
   finally{if(active&&serial===sequence)setLoading(false);}
  }
  try{
   const auth=browserAuth().auth.onAuthStateChange(event=>{
    sequence++;setOrgs([]);replaceScope("");
    if(event==="SIGNED_OUT"){preferred.current="";setLoading(false);setMessage("Signed out. Private evidence has been cleared.");}
    else setTimeout(()=>{if(active)void init();},0);
   });
   unsubscribe=()=>auth.data.subscription.unsubscribe();void init();
  }catch{setLoading(false);setMessage("Private workspace sign-in is not configured.");}
  return()=>{active=false;sequence++;scope.current.invalidate();unsubscribe();};
 },[request,replaceScope]);
 useEffect(()=>{
  setData(null);if(!selected)return;
  let active=true;const ticket=scope.current.capture();setLoading(true);
  request("/api/workspace/recognition?organizationId="+encodeURIComponent(selected))
   .then(value=>{if(active&&scope.current.current(ticket)){setData(value);setMessage("");}})
   .catch(error=>{if(active&&scope.current.current(ticket))setMessage(error.message);})
   .finally(()=>{if(active&&scope.current.current(ticket))setLoading(false);});
  return()=>{active=false;};
 },[selected,generation,request]);
 async function create(trackId:string){
  if(!selected||mutation.current)return;
  const ticket=scope.current.capture();mutation.current=true;setWorking(trackId);setMessage("");
  try{
   const result=await request("/api/workspace/recognition",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:selected,trackId})});
   if(!scope.current.current(ticket))return;
   const updated=await request("/api/workspace/recognition?organizationId="+encodeURIComponent(selected));
   if(!scope.current.current(ticket))return;
   setData(updated);setMessage(result.reused?"Existing evidence-collection task reused; no certification claimed.":"Evidence-collection task created. This is not a regulator decision.");
  }catch(error){if(scope.current.current(ticket))setMessage(error instanceof Error?error.message:"Could not create evidence action");}
  finally{mutation.current=false;if(scope.current.current(ticket))setWorking("");}
 }
 const role=orgs.find(o=>o.id===selected)?.role,admin=role==="ADMIN"||role==="OWNER";
 const tracks=data?.tracks||RECOGNITION_TRACKS.map(t=>({...t,publicStatus:"NOT_VERIFIED",task:null}));
 return <div className={shell.app}><aside className={shell.sidebar}><a className={shell.logo} href="/team/operations"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>EXTERNAL ASSURANCE</small></span></a>
  <div className={shell.sideCaption}>PRIVATE WORKSPACE</div><nav className={shell.sideNav} aria-label="Navigation">
   <a href="/team/operations">Operations</a><a className={shell.active} aria-current="page" href="/team/recognition">Recognition readiness</a>
   <a href="/team/coverage">Source coverage</a><a href="/team/evidence">Evidence vault</a><a href="/team/audits">Auditor workspace</a>
   <a href="/team/briefing">Weekly intelligence</a><a href="/recognition">Public assurance status</a>
  </nav><div className={shell.sideFoot}><strong>Evidence before claims.</strong><p>Internal tasks do not represent regulator approval, ISO certification or GxP validation.</p></div>
 </aside><main className={shell.main}>
  <div className={shell.topbar}><span className={shell.crumb}>Trust &amp; assurance / Recognition readiness</span><span className={shell.demo}>INDEPENDENT ASSURANCE ROADMAP</span></div>
  <header className={styles.hero}><span>REGULATORY ENGAGEMENT + THIRD-PARTY CERTIFICATION</span><h1>Build the evidence.<br/><em>Earn the recognition.</em></h1><p>Track the documents and independent sign-offs needed for regulatory engagement and external assessment. Prepare a private, hash-verified evidence pack without claiming an award.</p></header>
  {message&&<p role="status" className={styles.notice}>{message}</p>}
  {loading&&<p role="status" className={styles.notice}>Loading your assurance actions…</p>}
  {orgs.length>0&&<label className={styles.org}>Organisation<select value={selected} onChange={e=>{preferred.current=e.target.value;replaceScope(e.target.value);}} disabled={!!working}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label>}
  <div className={styles.statement}><p><strong>Seven recognition pathways. Zero assumed awards.</strong> Preparing evidence or completing an internal task does not award certification. External issuer verification and customer-specific GxP validation remain separate.</p><a href="/recognition">View public assurance status →</a></div>
  <div className={styles.grid}>{tracks.map(t=><section key={t.id} className={styles.card}>
   <span className={styles.kind}>{t.kind.replaceAll("_"," ")} · {t.issuer}</span><h2>{t.title}</h2><p>{t.purpose}</p>
   <h3>Evidence to assemble</h3><ul>{t.requirements.map(x=><li key={x}>{x}</li>)}</ul>
   {t.task?<div className={styles.task}><p>Task: <strong>{t.task.status.replaceAll("_"," ")}</strong> · owner {t.task.ownerName} · target {t.task.dueDate}</p>
    <a href={"/team?taskId="+encodeURIComponent(t.task.id)}>Open evidence task →</a>
    <p><strong>{t.task.independentlyReviewedFiles}</strong> file(s) with internal independent approval recorded. Export separately verifies selected file bytes.</p>
    <a href={"/team/evidence?organizationId="+encodeURIComponent(selected)+"&obligationId="+encodeURIComponent(t.task.id)}>Open private evidence vault →</a>
    {t.task.completionException&&<p>Completion exception recorded. No external recognition is implied.</p>}
    {admin&&<p><button type="button" disabled={!!working} aria-expanded={packTrack===t.id} onClick={()=>setPackTrack(current=>current===t.id?"":t.id)}>{packTrack===t.id?"Close pack builder":"Prepare assessment pack"}</button></p>}
   </div>:admin&&selected?<button type="button" disabled={!!working||loading} onClick={()=>void create(t.id)}>{working===t.id?"Creating…":"Create evidence action"}</button>:<p className={styles.await}>An owner or administrator may create a tracked evidence action.</p>}
   {admin&&t.task&&packTrack===t.id&&<PackagePanel key={selected+":"+generation+":"+t.id} organizationId={selected} trackId={t.id} request={send} isCurrent={scopeCheck}/>}
   <div className={styles.legal}>{t.publicNote}</div>
  </section>)}</div>
  <footer className={styles.footer}><strong>Release control:</strong> Private pack downloads are audited, not automatically submitted. No action here awards certification, publishes evidence, contacts a regulator or activates paid services.</footer>
 </main></div>;
}
