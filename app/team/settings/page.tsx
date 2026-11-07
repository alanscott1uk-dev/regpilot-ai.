"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import type {teamWorkspace,invitationInbox} from "../../../lib/server/team-service";
import {mayManageRole} from "../../../lib/team-policy";
import CompanySignIn from "./company-signin";
import MemberCard from "./member-card";
import shell from "../../workbench/workbench.module.css";
import ui from "../operations/operations.module.css";
import styles from "./settings.module.css";
type Serial<T>=T extends Date?string:T extends Array<infer U>?Serial<U>[]:T extends object?{[K in keyof T]:Serial<T[K]>}:T;
type Team=Serial<Awaited<ReturnType<typeof teamWorkspace>>>;
type Invitations=Serial<Awaited<ReturnType<typeof invitationInbox>>>;
type Context={email:string;userId:string|null;organisations:Array<{id:string;name:string;role:string}>};
const date=(s:string)=>new Date(s).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
export default function TeamSettings(){
 const [ctx,setCtx]=useState<Context|null>(null),[orgId,setOrgId]=useState(""),[data,setData]=useState<Team|null>(null),[invitations,setInvitations]=useState<Invitations>([]);
 const [enabled,setEnabled]=useState<boolean|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[email,setEmail]=useState("");
 const epoch=useRef(0),orgEpoch=useRef(0),busyRef=useRef(false),active=useRef("");active.current=orgId;
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const token=(await browserAuth().auth.getSession()).data.session?.access_token;if(!token)throw new Error("Sign in with your approved pilot email.");
  const r=await fetch(path,{...options,cache:"no-store",headers:{...options.headers,authorization:"Bearer "+token}});const body=await r.json();if(!r.ok)throw new Error(body.error||"Workspace unavailable");return body;
 },[]);
 const refresh=useCallback(async()=>{
  const gen=++epoch.current;
  try{
   const [context,inbox]=await Promise.all([request("/api/ai/context") as Promise<Context>,request("/api/workspace/invitations")]);
   if(gen!==epoch.current)return;setCtx(context);setInvitations(inbox.invitations);setOrgId(prev=>context.organisations.some(o=>o.id===prev)?prev:context.organisations[0]?.id||"");
  }catch(e){if(gen===epoch.current){setCtx(null);setOrgId("");setData(null);setInvitations([]);setNotice(e instanceof Error?e.message:"Cannot load workspace");}}
  finally{if(gen===epoch.current)setLoading(false);}
 },[request]);
 useEffect(()=>{let alive=true,unsubscribe=()=>{};const controller=new AbortController();
  void fetch("/api/ai/analyse",{cache:"no-store",signal:controller.signal}).then(r=>r.json()).then(status=>{if(!alive)return;setEnabled(status.workspaceEnabled===true);if(!status.workspaceEnabled){setLoading(false);return;}
   try{const auth=browserAuth().auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){epoch.current++;orgEpoch.current++;active.current="";setCtx(null);setData(null);setInvitations([]);setOrgId("");}else setTimeout(()=>{if(alive)void refresh();},0);});unsubscribe=()=>auth.data.subscription.unsubscribe();void refresh();}
   catch{setNotice("Sign-in is awaiting service activation.");setLoading(false);}
  }).catch(()=>{if(alive){setNotice("Cannot check workspace availability. Please reload.");setLoading(false);}});
  return()=>{alive=false;controller.abort();epoch.current++;orgEpoch.current++;unsubscribe();};
 },[refresh]);
 const current=ctx?.organisations.find(o=>o.id===orgId),admin=!!current&&["OWNER","ADMIN"].includes(current.role);
 const loadTeam=useCallback(async(id:string)=>{const gen=++orgEpoch.current;setData(null);try{const team=await request("/api/workspace/team?organizationId="+encodeURIComponent(id));if(gen===orgEpoch.current&&active.current===id)setData(team);}catch(e){if(gen===orgEpoch.current)setNotice(e instanceof Error?e.message:"Cannot load team");}},[request]);
 useEffect(()=>{orgEpoch.current++;setData(null);if(orgId&&admin)void loadTeam(orgId);return()=>{orgEpoch.current++;};},[orgId,admin,loadTeam]);
 async function action(path:string,method:string,body:Record<string,unknown>,message:string){
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setNotice("");const selected=orgId,generation=epoch.current;
  try{await request(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(epoch.current!==generation||active.current!==selected)return;setNotice(message);await refresh();if(selected&&active.current===selected&&admin)await loadTeam(selected);}
  catch(e){if(epoch.current===generation&&active.current===selected)setNotice(e instanceof Error?e.message:"Could not save change");}
  finally{busyRef.current=false;setBusy(false);}
 }
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);try{const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/team/settings",shouldCreateUser:false}});if(error)throw error;setNotice("Open the sign-in email in this browser to continue.");}catch{setNotice("Could not request sign-in. Use your approved pilot account or contact the workspace owner.");}finally{setBusy(false);}}
 return <div className={shell.app}><aside className={shell.sidebar}><a className={shell.logo} href="/team/operations"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>TEAM WORKSPACE</small></span></a><nav className={shell.sideNav}><a href="/team/operations">Operations</a><a href="/team/library">Obligation Library</a><a href="/team">Team tasks</a><a href="/team/evidence">Evidence vault</a><a href="/team/services">Services & spending</a><a className={shell.active} href="/team/settings" aria-current="page">Team & access</a><a href="/team/people">People &amp; policies</a><a href="/team/vendors">Vendor assurance</a><a href="/team/audits">Auditor workspace</a></nav></aside>
 <main className={shell.main}><div className={shell.topbar}><span className={shell.crumb}>Workspace / Team & access</span><span className={shell.demo}>PRIVATE PILOT</span></div>
  <header className={ui.hero}><div><span>THE RIGHT PEOPLE. THE RIGHT ACCESS.</span><h1>Work together.<br/><em>Review independently.</em></h1><p>Bring colleagues into your workspace, give them a clear role and keep responsibility with the right person as your team changes.</p></div><div className={ui.heroNote}><strong>One person prepares.<br/>Another checks.</strong><p>Independent review needs distinct verified accounts. Your roles make that possible.</p></div></header>
  {notice&&<p className={ui.notice} role="status">{notice}</p>}{loading&&<p role="status">Checking your workspace…</p>}
  {enabled===false&&<section className={ui.empty}><h2>Your private workspace is awaiting activation</h2><p>Sign-in, database access and pilot accounts must be configured before you can invite colleagues or store work. There is nothing you need to enter here yet.</p><a href="/workbench">Explore the fictional demonstration ↗</a></section>}
  {enabled&&!ctx&&!loading&&<section className={ui.card}><h2>Sign in to your workspace</h2><p>Use the verified email your owner invited. Invites appear here after sign-in.</p><form className={ui.formGrid} onSubmit={login}><label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><div><button disabled={busy}>Send secure sign-in link</button></div></form></section>}
  {enabled&&!ctx&&!loading&&<CompanySignIn/>}
  {ctx&&<><div className={ui.toolbar}><p>Signed in as <strong>{ctx.email}</strong></p><button disabled={busy} onClick={()=>void browserAuth().auth.signOut()}>Sign out</button></div>
   {!!invitations.length&&<section className={ui.card}><h2>Your invitations</h2><div className={ui.controlGrid}>{invitations.map(i=><article key={i.id}><span className={ui.eyebrow}>{i.role} ACCESS</span><h3>{i.organization.name}</h3><p>Expires {date(i.expiresAt)}</p><div className={ui.buttons}><button disabled={busy} onClick={()=>void action("/api/workspace/invitations","POST",{id:i.id,version:i.version,decision:"ACCEPT"},"Invitation accepted. Your workspace is now available.")}>Join workspace</button><button disabled={busy} onClick={()=>void action("/api/workspace/invitations","POST",{id:i.id,version:i.version,decision:"DECLINE"},"Invitation declined.")}>Decline</button></div></article>)}</div></section>}
   {!ctx.organisations.length&&!invitations.length&&<section className={ui.empty}><h2>No workspace yet</h2><p>Ask your owner to invite this email, or start an approved pilot for your business.</p><a href="/team">Create a pilot workspace ↗</a></section>}
   {!!ctx.organisations.length&&<label className={ui.org}>Organisation<select disabled={busy} value={orgId} onChange={e=>{orgEpoch.current++;setData(null);setOrgId(e.target.value);setNotice("");}}>{ctx.organisations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label>}
   {current&&!admin&&<section className={ui.card}><h2>Your access: {current.role.toLowerCase()}</h2><p>Team access is managed by your owner or administrator.</p><a href="/team/operations">Open your work ↗</a></section>}
   {data&&admin&&<>
    <section className={ui.card}><h2>Invite a colleague</h2><p>The colleague must already have an approved pilot account. This creates an invitation in their account; no email is sent automatically.</p><form className={ui.formGrid} key={orgId} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action("/api/workspace/team","POST",{organizationId:orgId,email:f.get("email"),role:f.get("role")},"Invitation saved. Ask your colleague to sign in at Team & access within seven days.");}}><label>Colleague’s email<input name="email" type="email" required maxLength={254}/></label><label>Role<select name="role" defaultValue="EDITOR">{data.role==="OWNER"&&<option value="ADMIN">Administrator — manage work and independently review</option>}<option value="EDITOR">Editor — prepare work and upload evidence</option><option value="VIEWER">Viewer — read workspace records</option></select></label><button disabled={busy}>Create invitation</button></form><p className={ui.hint}>Share this page address with your colleague: <strong>/team/settings</strong>. Knowing the address does not grant access.</p></section>
    <section className={ui.card}><h2>Your team · {data.members.length}</h2><div className={ui.controlGrid}>{data.members.map(m=><MemberCard key={m.user.id+":"+m.role} member={m} members={data.members} actorRole={data.role} userId={ctx.userId||""} busy={busy} onChange={body=>void action("/api/workspace/team","PATCH",{organizationId:orgId,...body},"Team access updated and recorded in the audit history.")}/>)}</div>{data.memberLimitReached&&<p>Showing the first 100 members.</p>}</section>
    <section className={ui.card}><h2>Invitation history</h2><div className={styles.rows}>{data.invitations.map(i=><article key={i.id}><div><strong>{i.email}</strong><p>{i.role} · {i.status==="PENDING"&&new Date(i.expiresAt)<new Date()?"EXPIRED":i.status} · Expires {date(i.expiresAt)}</p></div>{i.status==="PENDING"&&mayManageRole(data.role,i.role)&&<button disabled={busy} onClick={()=>void action("/api/workspace/team","DELETE",{organizationId:orgId,id:i.id,version:i.version},"Invitation revoked.")}>Revoke</button>}</article>)}</div>{!data.invitations.length&&<p>No invitations yet.</p>}<p className={ui.hint}>Latest 100 invitations. Up to {data.limits.pending} pending and {data.limits.dailyInvitations} new invitations per day.</p></section>
    <section className={ui.card}><h2>Recent access changes</h2><div className={styles.rows}>{data.activity.map(a=><article key={a.id}><div><strong>{a.action.replace("team.","").replaceAll("_"," ")}</strong><p>{a.actor.email} · {date(a.createdAt)}</p></div></article>)}</div>{!data.activity.length&&<p>No access changes recorded yet.</p>}<p className={ui.hint}>Latest 30 access events. Previous approvals remain attributed to the original person.</p></section>
   </>}
  </>}
  <footer className={shell.footer}>Private pilot · Use fictional or non-sensitive records until service acceptance is complete.</footer>
 </main></div>;
}
