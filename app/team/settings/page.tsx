"use client";
import WorkspaceNav from "../../components/workspace-nav";
import {useEffect,useRef,useState} from "react";
import EmailSignIn from "../../components/email-sign-in";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {useWorkspaceContext,workspaceHref} from "../../../lib/client/workspace-context";
import {teamHandoff,teamInvitationHref,type TeamHandoff} from "../../../lib/team-handoff.mjs";
import {workUuid} from "../../../lib/work-hub.mjs";
import type {teamWorkspace,invitationInbox,invitationStatus} from "../../../lib/server/team-service";
import {mayManageRole} from "../../../lib/team-policy";
import CompanySignIn from "./company-signin";
import MemberCard from "./member-card";
import shell from "../../workbench/workbench.module.css";
import ui from "../operations/operations.module.css";
import styles from "./settings.module.css";

type Serial<T>=T extends Date?string:T extends Array<infer U>?Serial<U>[]:T extends object?{[K in keyof T]:Serial<T[K]>}:T;
type Team=Serial<Awaited<ReturnType<typeof teamWorkspace>>>;
type Invitation=Serial<Awaited<ReturnType<typeof invitationInbox>>>[number];
type SavedInvitation=Serial<Awaited<ReturnType<typeof invitationStatus>>>;
type Action={kind:"INVITE"|"DECIDE"|"REVOKE"|"MEMBER";organizationId:string;path:string;method:string;body:Record<string,unknown>;invitation?:Invitation};
type Versioned<T>={revision:number;value:T};
const date=(s:string)=>new Date(s).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
const roleDescription:Record<string,string>={OWNER:"Own the workspace, manage people and independently review work.",ADMIN:"Manage work and independently review another person’s evidence.",EDITOR:"Prepare work and upload evidence for a different administrator to review.",VIEWER:"Read workspace records without changing or approving them."};
const emptyHandoff:TeamHandoff={organizationId:"",invitationId:"",taskId:"",error:""};

export default function TeamSettings(){
 const workspace=useWorkspaceContext();
 const {organizationId:orgId,organisations,userId,email,revision,signedIn,loading,capture,request,refreshContext,chooseOrganization}=workspace;
 const [handoff,setHandoff]=useState<TeamHandoff>(emptyHandoff),[origin,setOrigin]=useState("");
 const [enabled,setEnabled]=useState<boolean|null>(null),[reload,setReload]=useState(0);
 const [teamResult,setTeamResult]=useState<Versioned<Team>|null>(null),[inboxResult,setInboxResult]=useState<Versioned<Invitation[]>|null>(null),[linkedResult,setLinkedResult]=useState<Versioned<SavedInvitation>|null>(null);
 const [teamError,setTeamError]=useState(""),[inboxError,setInboxError]=useState(""),[linkError,setLinkError]=useState("");
 const [notice,setNotice]=useState<{email:string;message:string}|null>(null);
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState<Versioned<Action>|null>(null);
 const [share,setShare]=useState<Versioned<Team["invitations"][number]>|null>(null);
 const busyRef=useRef(false);
 const current=organisations.find(o=>o.id===orgId),admin=!!current&&["OWNER","ADMIN"].includes(current.role);
 const data=teamResult?.revision===revision?teamResult.value:null;
 const invitations=inboxResult?.revision===revision?inboxResult.value:null;
 const linked=linkedResult?.revision===revision?linkedResult.value:null;
 const unconfirmed=uncertain?.revision===revision?uncertain.value:null;
 const shared=share?.revision===revision?share.value:null;
 const taskId=handoff.organizationId===orgId?handoff.taskId:"";
 const writesBlocked=busy||!!unconfirmed;

 useEffect(()=>{setHandoff(teamHandoff(window.location.search));setOrigin(window.location.origin);},[]);
 useEffect(()=>{
  const abort=new AbortController();
  void fetch("/api/ai/analyse",{cache:"no-store",signal:abort.signal}).then(r=>r.json()).then(status=>setEnabled(status.workspaceEnabled===true)).catch(()=>{if(!abort.signal.aborted)setEnabled(null);});
  return()=>abort.abort();
 },[]);
 useEffect(()=>{
  busyRef.current=false;setBusy(false);setUncertain(null);setShare(null);setTeamError("");setInboxError("");setLinkError("");
 },[revision]);
 useEffect(()=>{
  setInboxResult(null);setLinkedResult(null);setInboxError("");setLinkError("");
  if(!signedIn||loading)return;
  const valid=capture(),abort=new AbortController();
  void request("/api/workspace/invitations",{signal:abort.signal}).then(value=>{if(valid()&&!abort.signal.aborted)setInboxResult({revision,value:value.invitations});}).catch(error=>{if(valid()&&!abort.signal.aborted)setInboxError(error instanceof Error?error.message:"Invitations could not be loaded.");});
  if(handoff.invitationId&&!handoff.error){
   void request("/api/workspace/invitations?"+new URLSearchParams({invitationId:handoff.invitationId}),{signal:abort.signal}).then(value=>{
    if(!valid()||abort.signal.aborted)return;
    if(value.invitation?.id!==handoff.invitationId||value.invitation?.organization?.id!==handoff.organizationId)throw new Error("This invitation does not match the company in the link. Ask the owner for a fresh link.");
    setLinkedResult({revision,value:value.invitation});
   }).catch(error=>{if(valid()&&!abort.signal.aborted)setLinkError(error instanceof Error?error.message:"This invitation could not be verified for your account.");});
  }
  return()=>abort.abort();
 },[signedIn,loading,revision,reload,handoff.invitationId,handoff.organizationId,handoff.error,capture,request]);
 useEffect(()=>{
  setTeamResult(null);setTeamError("");
  if(!orgId||!admin||loading||handoff.error)return;
  const valid=capture(),abort=new AbortController();
  void request("/api/workspace/team?"+new URLSearchParams({organizationId:orgId}),{signal:abort.signal}).then(value=>{
   if(!valid()||abort.signal.aborted)return;
   if(value.organizationId!==orgId)throw new Error("The team response belongs to another organisation. Refresh team access.");
   setTeamResult({revision,value});
  }).catch(error=>{if(valid()&&!abort.signal.aborted)setTeamError(error instanceof Error?error.message:"Team access could not be loaded.");});
  return()=>abort.abort();
 },[orgId,admin,loading,revision,reload,handoff.error,capture,request]);

 function note(message:string){setNotice({email,message});}
 function showHandoff(invitation:Invitation){
  const next={organizationId:invitation.organization.id,invitationId:invitation.id,taskId:handoff.organizationId===invitation.organization.id?handoff.taskId:"",error:""};
  setHandoff(next);
  const href=teamInvitationHref(next.organizationId,next.invitationId,next.taskId);
  if(href){window.history.replaceState(window.history.state,"",href);window.dispatchEvent(new Event("regpilot-workspace-navigation"));}
 }
 async function finishDecision(invitation:Invitation,status:string){
  showHandoff(invitation);
  if(status==="ACCEPTED"){
   const refreshed=await refreshContext(invitation.organization.id);
   if(!refreshed)return;
   note("Invitation accepted. Review your current access below.");
  }else note("Invitation declined. No workspace access was granted.");
 }
 async function mutate(action:Action){
  if(busyRef.current||unconfirmed)return;
  busyRef.current=true;setBusy(true);setNotice(null);const valid=capture();
  try{
   const value=await request(action.path,{method:action.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(action.body)});
   if(!valid())return;
   if(action.kind==="INVITE"){
    if(!workUuid(value.id)||value.email!==action.body.email||value.role!==action.body.role)throw new Error("The saved invitation response could not be confirmed.");
    setShare({revision,value});note("Invitation saved. Share the invitation link with this colleague. No invitation email has been sent.");
   }else if(action.kind==="DECIDE"){
    const expected=action.body.decision==="ACCEPT"?"ACCEPTED":"DECLINED";
    if(value.organizationId!==action.organizationId||value.status!==expected)throw new Error("The invitation response could not be confirmed.");
    await finishDecision(action.invitation!,value.status);
   }else if(action.kind==="REVOKE"){
    if(value.id!==action.body.id||value.status!=="REVOKED")throw new Error("The saved revocation response could not be confirmed.");
    note("Invitation revoked. The saved access history has been updated.");
   }else {
    const expectedRole=action.body.action==="REMOVE"?null:action.body.action==="TRANSFER"?"OWNER":action.body.role;
    if(value.userId!==action.body.userId||value.role!==expectedRole)throw new Error("The saved access change could not be confirmed.");
    note("Team access updated. Existing approvals retain their original attribution.");await refreshContext(orgId);
   }
   setReload(n=>n+1);
  }catch(error){
   if(valid()){
    setUncertain({revision,value:action});
    note((error instanceof Error?error.message:"The request did not return a confirmed result.")+" Check the saved status before trying another change.");
   }
  }finally{if(valid()){busyRef.current=false;setBusy(false);}}
 }
 async function reconcile(){
  if(!unconfirmed||busyRef.current)return;
  const action=unconfirmed,valid=capture();busyRef.current=true;setBusy(true);setNotice(null);
  // Remove previously loaded records while a result is unconfirmed. A failed
  // read must not leave an older team or invitation visible as the current state.
  setTeamResult(null);setLinkedResult(null);setInboxResult(null);
  try{
   if(action.kind==="DECIDE"){
    const value=await request("/api/workspace/invitations?"+new URLSearchParams({invitationId:String(action.body.id)}));
    if(!valid())return;
    const saved:SavedInvitation=value.invitation;
    if(saved.id!==action.body.id||saved.organization.id!==action.organizationId)throw new Error("The saved invitation does not match this change.");
    if(saved.status==="ACCEPTED"&&saved.membership){
     setUncertain(null);await finishDecision(action.invitation!,saved.status);
    }else if(saved.status==="ACCEPTED"){
     setUncertain(null);note("The invitation was accepted, but membership is no longer available. Ask an owner to review your access.");
    }else{
     setUncertain(null);setLinkedResult({revision,value:saved});
     note(saved.status==="PENDING"?"The invitation is still pending. No saved decision was found; you can choose again.":"Saved invitation status: "+saved.status.toLowerCase()+". No decision was resubmitted.");
    }
   }else{
    const value:Team=await request("/api/workspace/team?"+new URLSearchParams({organizationId:action.organizationId}));
    if(!valid())return;
    if(value.organizationId!==action.organizationId)throw new Error("The team response belongs to another organisation.");
    setTeamResult({revision,value});
    if(action.kind==="INVITE"){
     const saved=value.invitations.find(i=>i.email===action.body.email&&i.role===action.body.role&&i.status==="PENDING"&&new Date(i.expiresAt)>new Date());
     if(saved){setShare({revision,value:saved});note("The invitation is saved. Share its link with the intended colleague. No second invitation was submitted.");}
     else note("No matching pending invitation was found in the latest invitation history. Review the team and invitation history before choosing another change.");
    }else if(action.kind==="REVOKE"){
     const saved=value.invitations.find(i=>i.id===action.body.id);
     note(saved?"Saved invitation status: "+saved.status.toLowerCase()+". No revocation was resubmitted.":"The invitation is outside the latest history. Ask an owner to confirm its status; no revocation was resubmitted.");
    }else{
     const member=value.members.find(m=>m.user.id===action.body.userId);
     if(!member&&value.memberLimitReached)throw new Error("The member list is incomplete, so this access change cannot yet be confirmed.");
     note(member?"The colleague’s saved role is "+member.role.toLowerCase()+". No access change was resubmitted.":"The colleague is no longer listed in this workspace. No access change was resubmitted.");
     await refreshContext(action.organizationId);
    }
    setUncertain(null);
   }
   setReload(n=>n+1);
  }catch(error){if(valid())note((error instanceof Error?error.message:"Saved status could not be checked.")+" The result remains unconfirmed. Check again when the workspace is available.");}
  finally{if(valid()){busyRef.current=false;setBusy(false);}}
 }
 function decide(invitation:Invitation,decision:"ACCEPT"|"DECLINE"){
  void mutate({kind:"DECIDE",organizationId:invitation.organization.id,path:"/api/workspace/invitations",method:"POST",body:{id:invitation.id,version:invitation.version,decision},invitation});
 }
 function choose(id:string){
  setHandoff(emptyHandoff);setNotice(null);
  const url=new URL(window.location.href);url.searchParams.delete("invitationId");url.searchParams.delete("taskId");window.history.replaceState(window.history.state,"",url.pathname+url.search);
  chooseOrganization(id);
 }
 function invitationCard(invitation:Invitation){return <article key={invitation.id} className={styles.invitation}>
  <span className={ui.eyebrow}>{invitation.role.toLowerCase()} invitation</span><h3>{invitation.organization.name}</h3><p>{roleDescription[invitation.role]}</p><p>For <strong>{email}</strong> · Expires {date(invitation.expiresAt)}</p>
  <div className={ui.buttons}><button disabled={writesBlocked} onClick={()=>decide(invitation,"ACCEPT")}>Join workspace</button><button disabled={writesBlocked} onClick={()=>decide(invitation,"DECLINE")}>Decline</button></div>
 </article>;}
 const sharePath=shared?teamInvitationHref(orgId,shared.id,taskId):null;
 const targetTask=linked&&handoff.organizationId===linked.organization.id?handoff.taskId:"";
 const joined=linked?.status==="ACCEPTED"&&!!linked.membership;
 const pendingLinked=linked?.status==="PENDING"&&!linked.membership;
 const showWorkspaceError=workspace.error&&!handoff.invitationId;

 return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
  <header className={styles.heading}><span className={ui.eyebrow}>{current?.name||"YOUR WORKSPACE"}</span><h1>Bring the right people into the work.</h1><p>Give colleagues a clear role, keep responsibility in the right company and prepare work for independent review.</p></header>
  {notice?.email===email&&<p className={ui.notice} role="status">{notice?.message}</p>}
  {unconfirmed&&<section className={styles.reconcile} aria-label="Unconfirmed team change"><h2>Check what was saved</h2><p>This change has no confirmed result in this browser. Checking saved status only reads the current record; it does not send the change again.</p><button disabled={busy} onClick={()=>void reconcile()}>Check saved invitation status</button></section>}
  {(loading||enabled===null)&&<p role="status">Checking your workspace…</p>}
  {enabled===false&&<section className={ui.empty}><h2>Your private workspace is awaiting activation</h2><p>Sign-in, database access and pilot accounts must be configured before you can invite colleagues or store work.</p><a href="/workbench">Explore the fictional demonstration ↗</a></section>}
  {enabled&&!signedIn&&!loading&&<><section className={ui.card}><h2>Sign in to your workspace</h2><p>Use the verified email your owner invited. You can inspect the company and role before choosing to join.</p><EmailSignIn destination="/team/settings"/></section><CompanySignIn/></>}
  {handoff.error&&<p className={styles.error} role="alert">{handoff.error}</p>}
  {showWorkspaceError&&<p className={styles.error} role="alert">{workspace.error}</p>}
  {signedIn&&<>
   <div className={styles.toolbar}><p>Signed in as <strong>{email}</strong></p><div className={ui.buttons}><button disabled={busy||!!unconfirmed} onClick={()=>{setReload(n=>n+1);void refreshContext();}}>Refresh team access</button><button disabled={busy} onClick={()=>void browserAuth().auth.signOut()}>Sign out</button></div></div>
   {handoff.invitationId&&!handoff.error&&<section className={ui.card} aria-label="Linked invitation"><h2>Your workspace invitation</h2>
    {linkError?<div className={styles.error} role="alert"><p>{linkError}</p><p>Check that you signed in with the invited email. This link has not opened another company.</p></div>:!linked?<p role="status">Checking the invitation for your account…</p>:pendingLinked?invitationCard(linked):<article className={styles.invitation}><h3>{linked.organization.name}</h3><p>Saved invitation status: <strong>{linked.status.toLowerCase()}</strong>.</p>
     {joined?<><p>Your current role is <strong>{linked.membership?.role.toLowerCase()}</strong>. {roleDescription[linked.membership!.role]}</p><a className={styles.primary} href={workspaceHref(targetTask?"/team/work":"/team/operations",linked.organization.id,targetTask?{taskId:targetTask}:{})}>{targetTask?"Open invited task":"Open workspace"} →</a></>:<p>{linked.status==="PENDING"?"You already have access to this company. Ask the owner to confirm the correct role before acting on this invitation.":"This invitation cannot grant access. Ask the owner for a new invitation if you still need to join."}</p>}
    </article>}
   </section>}
   {!handoff.invitationId&&!handoff.error&&<section className={ui.card} aria-label="Your invitations"><h2>Your invitations</h2>{inboxError?<p className={styles.error} role="alert">{inboxError}</p>:invitations===null?<p role="status">Loading your invitations…</p>:invitations.length?<div className={ui.controlGrid}>{invitations.map(invitationCard)}</div>:<p>No pending invitations for this email.</p>}{invitations?.length===50&&<p className={ui.hint}>Showing the latest 50 pending invitations. A specific invitation link opens its own record.</p>}</section>}
   {organisations.length>0&&<label className={ui.org}>Organisation<select disabled={writesBlocked} value={orgId} onChange={e=>choose(e.target.value)}>{!orgId&&<option value="">Choose your organisation</option>}{organisations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label>}
   {!organisations.length&&!handoff.invitationId&&invitations?.length===0&&<section className={ui.empty}><h2>No workspace yet</h2><p>Ask an owner to invite this email, or create an approved pilot workspace for your business.</p><a href="/team/setup">Set up your organisation →</a></section>}
   {current&&!admin&&<section className={ui.card}><h2>Your access: {current.role.toLowerCase()}</h2><p>{roleDescription[current.role]}</p><a href={workspaceHref(taskId?"/team/work":"/team/operations",orgId,taskId?{taskId}:{})}>{taskId?"Open your linked task":"Open your work"} →</a></section>}
   {admin&&teamError&&<p className={styles.error} role="alert">{teamError}</p>}
   {admin&&!data&&!teamError&&!unconfirmed&&<p role="status">Loading team access…</p>}
   {data&&admin&&!handoff.error&&<>
    {taskId&&<section className={styles.handoff}><div><span className={ui.eyebrow}>CONTINUE THE SAME WORK</span><h2>Bring a colleague to this task</h2><p>The invitation link will retain this company and task. Your colleague must sign in, inspect the role and choose to join before opening the work.</p><p>Independent review requires a different owner or administrator.{data.role!=="OWNER"?" Ask an owner to invite another administrator if one is needed.":" Choose Administrator when inviting an independent reviewer."}</p></div><a href={workspaceHref("/team/work",orgId,{taskId})}>Return to task →</a></section>}
    <section className={ui.card}><h2>Invite a colleague</h2><p>The colleague must use an approved pilot account. Create an in-app invitation, then share its link with that person. No invitation email is sent automatically.</p>
     <form className={ui.formGrid} key={orgId+":"+revision} onSubmit={e=>{
      e.preventDefault();const f=new FormData(e.currentTarget),inviteEmail=String(f.get("email")||"").trim().toLowerCase();
      void mutate({kind:"INVITE",organizationId:orgId,path:"/api/workspace/team",method:"POST",body:{organizationId:orgId,email:inviteEmail,role:f.get("role")}});
     }}><label>Colleague’s email<input name="email" type="email" required maxLength={254} disabled={writesBlocked}/></label><label>Role<select name="role" defaultValue={taskId&&data.role==="OWNER"?"ADMIN":"EDITOR"} disabled={writesBlocked}>{data.role==="OWNER"&&<option value="ADMIN">Administrator — manage work and independently review</option>}<option value="EDITOR">Editor — prepare work and upload evidence</option><option value="VIEWER">Viewer — read workspace records</option></select></label><button disabled={writesBlocked}>Create invitation</button></form>
    </section>
    {shared&&sharePath&&<section className={styles.share} aria-label="Share invitation"><span className={ui.eyebrow}>INVITATION SAVED</span><h2>Share with {shared.email}</h2><p>{shared.role.toLowerCase()} access to {current?.name} · Expires {date(shared.expiresAt)}.</p><label>Invitation link<input readOnly value={origin+sharePath} onFocus={e=>e.currentTarget.select()}/></label><button disabled={busy} onClick={async()=>{const valid=capture();try{await navigator.clipboard.writeText(origin+sharePath);if(valid())note("Invitation link copied. Share it with the invited colleague.");}catch{if(valid())note("Select and copy the invitation link above. Your browser did not allow automatic copying.");}}}>Copy invitation link</button><p className={ui.hint}>Only the invited verified email can accept. The link itself grants no access.</p></section>}
    <section className={ui.card}><h2>Your team · {data.members.length}</h2><div className={ui.controlGrid}>{data.members.map(m=><MemberCard key={m.user.id+":"+m.role} member={m} members={data.members} actorRole={data.role} userId={userId} busy={writesBlocked} onChange={body=>void mutate({kind:"MEMBER",organizationId:orgId,path:"/api/workspace/team",method:"PATCH",body:{organizationId:orgId,...body}})}/>)}</div>{data.memberLimitReached&&<p>Showing the first 100 members.</p>}</section>
    <section className={ui.card}><h2>Invitation history</h2><div className={styles.rows}>{data.invitations.map(i=><article key={i.id}><div><strong>{i.email}</strong><p>{i.role} · {i.status==="PENDING"&&new Date(i.expiresAt)<new Date()?"EXPIRED":i.status} · Expires {date(i.expiresAt)}</p></div>{i.status==="PENDING"&&new Date(i.expiresAt)>new Date()&&mayManageRole(data.role,i.role)&&<div className={ui.buttons}><button disabled={writesBlocked} onClick={()=>setShare({revision,value:i})}>Share invitation</button><button disabled={writesBlocked} onClick={()=>void mutate({kind:"REVOKE",organizationId:orgId,path:"/api/workspace/team",method:"DELETE",body:{organizationId:orgId,id:i.id,version:i.version}})}>Revoke</button></div>}</article>)}</div>{!data.invitations.length&&<p>No invitations yet.</p>}<p className={ui.hint}>Latest 100 invitations. Up to {data.limits.pending} pending and {data.limits.dailyInvitations} new invitations per day.</p></section>
    <section className={ui.card}><h2>Recent access changes</h2><div className={styles.rows}>{data.activity.map(a=><article key={a.id}><div><strong>{a.action.replace("team.","").replaceAll("_"," ")}</strong><p>{a.actor.email} · {date(a.createdAt)}</p></div></article>)}</div>{!data.activity.length&&<p>No access changes recorded yet.</p>}<p className={ui.hint}>Latest 30 access events. Previous approvals remain attributed to the original person.</p></section>
   </>}
  </>}
  <footer className={shell.footer}>Private pilot · Use fictional or non-sensitive records until service acceptance is complete.</footer>
 </main></div>;
}
