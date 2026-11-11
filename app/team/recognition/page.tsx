"use client";
import {useCallback,useEffect,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {RECOGNITION_TRACKS} from "../../../lib/recognition/registry.mjs";
import shell from "../../workbench/workbench.module.css";
import styles from "./recognition.module.css";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Work={tracks:Array<typeof RECOGNITION_TRACKS[number]&{publicStatus:string;task:null|{id:string;title:string;ownerName:string;status:string;dueDate:string;completionException:boolean}}>;notice:string};
export default function RecognitionWorkspace(){
 const [orgs,setOrgs]=useState<Org[]>([]),[selected,setSelected]=useState(""),[data,setData]=useState<Work|null>(null);
 const [message,setMessage]=useState(""),[loading,setLoading]=useState(true),[working,setWorking]=useState("");
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;
  if(!token)throw Error("Sign in to your private workspace first");
  const res=await fetch(path,{...options,cache:"no-store",headers:{...options.headers,authorization:"Bearer "+token}});
  const body=await res.json().catch(()=>({error:"Service temporarily unavailable"}));
  if(!res.ok)throw Error(body.error||"Cannot access recognition workspace");
  return body;
 },[]);
 useEffect(()=>{
  let active=true;let unsubscribe=()=>{};
  async function init(){
   try{
    const body=await request("/api/ai/context");if(!active)return;
    const list:Org[]=Array.isArray(body.organisations)?body.organisations:[];
    setOrgs(list);setSelected(old=>list.some(o=>o.id===old)?old:list[0]?.id||"");setMessage("");
   }catch(e){if(active){setOrgs([]);setSelected("");setData(null);setMessage(e instanceof Error?e.message:"Sign in required");}}
   finally{if(active)setLoading(false);}
  }
  try{const auth=browserAuth().auth.onAuthStateChange(event=>{
   if(event==="SIGNED_OUT"){setOrgs([]);setSelected("");setData(null);}
   else setTimeout(()=>{if(active)void init();},0);
  });unsubscribe=()=>auth.data.subscription.unsubscribe();void init();}
  catch{setLoading(false);setMessage("Private workspace sign-in is not configured.");}
  return()=>{active=false;unsubscribe();};
 },[request]);
 const refresh=useCallback(async(org:string)=>request("/api/workspace/recognition?organizationId="+encodeURIComponent(org)),[request]);
 useEffect(()=>{
  setData(null);if(!selected)return;
  let active=true;setLoading(true);
  refresh(selected).then(value=>{if(active){setData(value);setMessage("");}}).catch(e=>{if(active)setMessage(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[selected,refresh]);
 async function create(trackId:string){
  if(!selected||working)return;
  setWorking(trackId);setMessage("");
  try{
   const result=await request("/api/workspace/recognition",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({organizationId:selected,trackId})});
   const updated=await refresh(selected);setData(updated);
   setMessage(result.reused?"Existing evidence-collection task opened; no certification claimed.":"A scoped evidence-collection task was created; this is not a regulator decision.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not create evidence action");}
  finally{setWorking("");}
 }
 const role=orgs.find(o=>o.id===selected)?.role,admin=role==="ADMIN"||role==="OWNER";
 const tracks=data?.tracks||RECOGNITION_TRACKS.map(t=>({...t,publicStatus:"NOT_VERIFIED",task:null}));
 return <div className={shell.app}><aside className={shell.sidebar}><a className={shell.logo} href="/team/operations"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>EXTERNAL ASSURANCE</small></span></a>
   <div className={shell.sideCaption}>PRIVATE WORKSPACE</div>
   <nav className={shell.sideNav} aria-label="Navigation">
    <a href="/team/operations">Operations</a><a className={shell.active} aria-current="page" href="/team/recognition">Recognition readiness</a>
    <a href="/team/coverage">Source coverage</a><a href="/team/evidence">Evidence vault</a><a href="/team/audits">Auditor workspace</a>
    <a href="/team/briefing">Weekly intelligence</a><a href="/recognition">Public assurance status</a>
   </nav>
   <div className={shell.sideFoot}><strong>Evidence before claims.</strong><p>Internal tasks do not represent regulator approval, ISO certification or GxP validation.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Trust &amp; assurance / Recognition readiness</span><span className={shell.demo}>INDEPENDENT ASSURANCE ROADMAP</span></div>
   <header className={styles.hero}><span>REGULATORY ENGAGEMENT + THIRD-PARTY CERTIFICATION</span><h1>Build the evidence.<br/><em>Earn the recognition.</em></h1><p>Track the actual documents and independent sign-offs needed for MHRA engagement, AI/security certification, UK data protection and public-sector supplier qualification.</p></header>
   {message&&<p role="status" className={styles.notice}>{message}</p>}
   {loading&&<p role="status" className={styles.notice}>Loading your assurance actions…</p>}
   {orgs.length>0&&<label className={styles.org}>Organisation<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!!working}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label>}
   <div className={styles.statement}><p><strong>Seven recognition pathways. Zero assumed awards.</strong> Our public status must remain “not independently verified” unless a genuine issuer, scope, reference, current dates, independent reviewer and verification route are recorded. Customer-specific GxP validation cannot be substituted with a RegPilot certificate.</p><a href="/recognition">View public assurance status →</a></div>
   <div className={styles.grid}>{tracks.map(t=><section key={t.id} className={styles.card}>
    <span className={styles.kind}>{t.kind.replaceAll("_"," ")} · {t.issuer}</span><h2>{t.title}</h2><p>{t.purpose}</p>
    <h3>Evidence to assemble</h3><ul>{t.requirements.map(x=><li key={x}>{x}</li>)}</ul>
    {t.task?<div className={styles.task}><p>Task: <strong>{t.task.status.replaceAll("_"," ")}</strong> · owner {t.task.ownerName} · target {t.task.dueDate}</p>
      <a href={"/team?taskId="+encodeURIComponent(t.task.id)}>Open existing evidence task →</a>
      {t.task.completionException&&<p>Recorded completion exception. No external recognition is implied.</p>}
     </div>:admin&&selected?<button type="button" disabled={!!working||loading} onClick={()=>void create(t.id)}>{working===t.id?"Creating…":"Create evidence action"}</button>
       :<p className={styles.await}>An owner or administrator may create a tracked evidence action.</p>}
    <div className={styles.legal}>{t.publicNote}</div>
   </section>)}</div>
   <footer className={styles.footer}><strong>Release control:</strong> document review, ISO/GxP certification preparation, clinical scope and customer validation require different qualified reviewers. No user action here awards certification, submits a regulator enquiry or activates paid services.</footer>
  </main>
 </div>;
}
