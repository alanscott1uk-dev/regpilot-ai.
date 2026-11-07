"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import shell from "../../workbench/workbench.module.css";
import ui from "../operations/operations.module.css";
export type Context={email:string;userId:string|null;organisations:Array<{id:string;name:string;role:string}>};
export async function auditFetch(path:string,options:RequestInit={}){
 const session=(await browserAuth().auth.getSession()).data.session;
 if(!session)throw new Error("Sign in to continue.");
 const r=await fetch(path,{...options,cache:"no-store",headers:{...options.headers,authorization:"Bearer "+session.access_token}});
 if(!r.ok){const b=await r.json();throw new Error(b.error||"The request could not be completed.");}
 const current=(await browserAuth().auth.getSession()).data.session;
 if(current?.user.id!==session.user.id)throw new Error("Your session changed. Sign in again.");
 return r;
}
export async function auditRequest(path:string,body?:Record<string,unknown>,method="POST"){
 return (await auditFetch(path,body?{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})).json();
}
export type Serial<T>=T extends Date?string:T extends Array<infer U>?Serial<U>[]:T extends object?{[K in keyof T]:Serial<T[K]>}:T;
export const date=(s:string)=>new Date(s).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
export default function AuditSession({guest=false,section="audits",children}:{guest?:boolean;section?:"audits"|"people"|"vendors";children:(ctx:Context)=>ReactNode}){
 const copy=section==="people"?{label:"People & policies",first:"Clear policies.",second:"Recorded understanding.",intro:"Publish a reviewed policy, give each person the right version and see who still needs to read it.",steps:"1. Prepare a policy\n2. Get independent approval\n3. Read and acknowledge"}:section==="vendors"?{label:"Vendor assurance",first:"Know your suppliers.",second:"Act on the gaps.",intro:"Record the service, inspect the evidence and turn an independent review into owned follow-up work.",steps:"1. Record the supplier\n2. Assess the evidence\n3. Review and follow up"}:null;
 const [ctx,setCtx]=useState<Context|null>(null),[loading,setLoading]=useState(true),[enabled,setEnabled]=useState(false),[notice,setNotice]=useState(""),[email,setEmail]=useState(""),[busy,setBusy]=useState(false);
 const epoch=useRef(0);
 useEffect(()=>{let alive=true,unsubscribe=()=>{};
  async function refresh(){const gen=++epoch.current;try{const c=await auditRequest("/api/ai/context");if(alive&&gen===epoch.current){setCtx(c);setNotice("");}}catch(e){if(alive&&gen===epoch.current){setCtx(null);setNotice(e instanceof Error?e.message:"Sign-in unavailable.");}}finally{if(alive&&gen===epoch.current)setLoading(false);}}
  void fetch("/api/ai/analyse",{cache:"no-store"}).then(r=>r.json()).then(s=>{if(!alive)return;setEnabled(s.workspaceEnabled===true);if(!s.workspaceEnabled){setLoading(false);return;}
   const {data}=browserAuth().auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"||event==="SIGNED_IN"){epoch.current++;setCtx(null);}setTimeout(()=>{if(alive)void refresh();},0);});unsubscribe=()=>data.subscription.unsubscribe();void refresh();
  }).catch(()=>{if(alive){setLoading(false);setNotice("Could not check availability. Reload to try again.");}});
  return()=>{alive=false;epoch.current++;unsubscribe();};
 },[]);
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);try{const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:window.location.origin+(guest?"/auditor":"/team/"+section)}});if(error)throw error;setNotice("Open the sign-in email in this browser to continue.");}catch{setNotice("Sign-in could not be requested. Use your approved pilot email.");}finally{setBusy(false);}}
 return <div className={shell.app}><aside className={shell.sidebar}><a className={shell.logo} href={guest?"/auditor":"/team/operations"}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>{guest?"AUDITOR WORKSPACE":"PRIVATE TEAM PILOT"}</small></span></a><nav className={shell.sideNav}>{guest?<a href="/auditor" aria-current="page">Shared with me</a>:<><a href="/team/operations">Operations</a><a href="/team/library">Requirements</a><a href="/team">Team tasks</a><a href="/team/evidence">Evidence vault</a><a href="/team/assurance">Evidence assessment</a><a href="/team/people" className={section==="people"?shell.active:undefined}>People &amp; policies</a><a href="/team/vendors" className={section==="vendors"?shell.active:undefined}>Vendor assurance</a><a href="/team/audits" className={section==="audits"?shell.active:undefined}>Auditor workspace</a><a href="/team/settings">Team &amp; access</a></>}</nav><div className={shell.sideFoot}><strong>{copy?"Clear ownership":"Named, limited access"}</strong><p>{copy?"Current evidence, named decisions and visible follow-up.":"Rooms contain a selected set of reviewed files. Each guest signs in. Owners can close access at any time."}</p></div></aside><main className={shell.main}><div className={shell.topbar}><span className={shell.crumb}>{copy?"Workspace / "+copy.label:guest?"External review / Shared with me":"Workspace / Audit preparation"}</span><span className={shell.demo}>PRIVATE PILOT</span></div><header className={ui.hero}><div><span>REGPILOT / {copy?copy.label.toUpperCase():"AUDITOR WORKSPACE"}</span><h1>{copy?copy.first:guest?"Everything shared.":"Ready for review."}<br/><em>{copy?copy.second:guest?"Nothing to chase.":"On your terms."}</em></h1><p>{copy?copy.intro:guest?"Review the files selected for you, ask for clarification and track responses in one place.":"Choose the evidence, check the disclosure and invite your reviewer. Keep the conversation beside the documents."}</p></div><div className={ui.heroNote}><strong>{copy?"Your next steps":guest?"Your review desk":"A clear path to external review"}</strong><p>{copy?copy.steps:guest?"Access expires automatically. File review status is a recorded decision, not a certification.":"1. Select reviewed files\n2. Preview and publish\n3. Invite and respond"}</p></div></header>
 <p className={ui.warning}>Pilot testing uses fictional information only. Customer and confidential records are not approved for use.</p>
 {notice&&<p role="status" className={ui.warning}>{notice}</p>}
 {loading?<section className={ui.empty}><h2>Checking your workspace…</h2></section>:!enabled?<section className={ui.empty}><h2>{copy?copy.label:"Auditor workspace"} awaits activation</h2><p>The private workspace is disabled. Sign-in and data access require activation by the operator.</p><a href="/team/operations">Return to operations</a></section>:!ctx?<section className={ui.card}><h2>Sign in to continue</h2><p>Use your approved workspace email.</p><form className={ui.formGrid} onSubmit={login}><label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>Send sign-in link</button></form></section>:<><section className={ui.toolbar}><span>Signed in as <strong>{ctx.email}</strong></span><button onClick={()=>{epoch.current++;setCtx(null);void browserAuth().auth.signOut().catch(()=>setNotice("Sign-out could not complete. Please retry."));}}>Sign out</button></section><div key={ctx.email}>{children(ctx)}</div></>}
 </main></div>;
}
