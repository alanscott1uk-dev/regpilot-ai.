"use client";
import {useCallback,useEffect,useState} from "react";
import {browserAuth} from "../../lib/client/supabase-auth";
import shell from "../workbench/workbench.module.css";
import ui from "./team.module.css";
type Org={id:string;name:string;role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER"};
type Task={id:string;title:string;ownerName:string;category:string;dueDate:string;status:"OPEN"|"IN_PROGRESS"|"COMPLETE";notes:string;completionException:boolean;completionRationale:string;sourceUrl:string|null;sourceCheckedAt:string|null;createdAt:string};
const fmt=(s:string)=>s?new Date(s).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
export default function Team(){
 const [ready,setReady]=useState(false),[user,setUser]=useState<{email:string}|null>(null);
 const [organisations,setOrganisations]=useState<Org[]>([]),[orgId,setOrgId]=useState("");
 const [company,setCompany]=useState("Demo pilot business"),[email,setEmail]=useState("");
 const [items,setItems]=useState<Task[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[showCreate,setShowCreate]=useState(false);
 const [completionNotes,setCompletionNotes]=useState<Record<string,string>>({});
 const [draft,setDraft]=useState({title:"",ownerName:"",category:"Internal",dueDate:today(),notes:""});
 async function sessionToken(){return (await browserAuth().auth.getSession()).data.session?.access_token||""}
 const loadSession=useCallback(async()=>{
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token){setUser(null);setOrganisations([]);setOrgId("");return;}
   const r=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+token},cache:"no-store"});
   const result=await r.json();
   if(!r.ok)throw new Error(result.error||"Workspace unavailable");
   const list:Org[]=Array.isArray(result.organisations)?result.organisations:[];
   setUser({email:result.email});
   setOrganisations(list);
   setOrgId(id=>list.some(o=>o.id===id)?id:list[0]?.id||"");
  }catch(e){setUser(null);setMessage(e instanceof Error?e.message:"Cannot load secure session")}
  finally{setReady(true)}
 },[]);
 useEffect(()=>{
  let alive=true;try{
   const {data}=browserAuth().auth.onAuthStateChange(()=>{
    // Run Supabase API calls outside the synchronous auth callback to avoid session lock contention.
    setTimeout(()=>{if(alive)void loadSession()},0);
   });
   void loadSession();
   return()=>{alive=false;data.subscription.unsubscribe()};
  }catch(e){setMessage("Supabase public login settings are missing");setReady(true);}
 },[loadSession]);
 const loadTasks=useCallback(async(id:string)=>{
  if(!id)return;try{
   const token=await sessionToken();if(!token)throw new Error("Sign in first");
   const r=await fetch("/api/workspace/obligations?organizationId="+encodeURIComponent(id),{headers:{authorization:"Bearer "+token},cache:"no-store"});
   const data=await r.json();if(!r.ok)throw new Error(data.error||"Cannot retrieve work queue");
   setItems(Array.isArray(data.items)?data.items:[]);
  }catch(e){setMessage(e instanceof Error?e.message:"Could not load tasks")}
 },[]);
 useEffect(()=>{setItems([]);if(orgId&&user)void loadTasks(orgId)},[orgId,user?.email,loadTasks]);
 async function login(e:React.FormEvent){
  e.preventDefault();setBusy(true);try{
   const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/team",shouldCreateUser:false}});
   if(error)throw error;setMessage("Sign-in link sent. Open it using this browser.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not send sign-in link")}finally{setBusy(false)}
 }
 async function bootstrap(e:React.FormEvent){
  e.preventDefault();setBusy(true);try{
   const token=await sessionToken();if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/ai/context",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({company})});
   const data=await res.json();if(!res.ok)throw new Error(data.error||"Organisation setup failed");
   await loadSession();setMessage("Private pilot workspace created.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not create team workspace")}finally{setBusy(false)}
 }
 async function create(e:React.FormEvent){
  e.preventDefault();setBusy(true);
  try{
   const token=await sessionToken();if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/workspace/obligations",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({organizationId:orgId,...draft})});
   const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not create task");
   setDraft({title:"",ownerName:"",category:"Internal",dueDate:today(),notes:""});setShowCreate(false);
   setMessage("Task recorded for this organisation. Completion status is not a legal compliance approval.");
   await loadTasks(orgId);
  }catch(e){setMessage(e instanceof Error?e.message:"Could not save task")}finally{setBusy(false)}
 }
 async function changeStatus(task:Task,status:Task["status"]){
  setBusy(true);try{
   const token=await sessionToken();if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/workspace/obligations/"+encodeURIComponent(task.id),{method:"PATCH",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({organizationId:orgId,status,completionRationale:completionNotes[task.id]||""})});
   const data=await res.json();if(!res.ok)throw new Error(data.error||"Status update failed");
   await loadTasks(orgId);setCompletionNotes(n=>({...n,[task.id]:""}));setMessage("Work status updated with an audit event. Completion without approved evidence is documented as an exception, not certification.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not update task")}finally{setBusy(false)}
 }
 async function signOut(){await browserAuth().auth.signOut();setUser(null);setOrgId("");setOrganisations([]);setItems([]);}
 const current=organisations.find(x=>x.id===orgId);
 const canWrite=!!current&&current.role!=="VIEWER";
 const visible=items.filter(x=>(filter==="all"||x.status===filter)&&[x.title,x.ownerName,x.category].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a className={shell.logo} href="/workbench"><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>PRIVATE TEAM PILOT</small></span></a>
   <div className={shell.sideCaption}>WORKSPACE</div>
   <nav className={shell.sideNav}><a href="/workbench">◉ &nbsp;Today's demo</a><a href="/ai">✦ &nbsp;AI Studio</a><a href="/traceability">◈ &nbsp;Traceability</a><a className={shell.active} href="/team" aria-current="page">▣ &nbsp;Secure team tasks</a><a href="/team/evidence">◈ &nbsp;Evidence vault</a><a href="/team/sources">✦ &nbsp;Source history</a><a href="/assurance">◇ &nbsp;Review centre</a></nav>
   <div className={shell.sideFoot}><strong>Private pilot only</strong><p>Work items are stored in a tenant-scoped database when this feature is enabled. Real sensitive records remain prohibited until security testing is complete.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / Team tasks</span><span className={shell.demo}>PRIVATE PILOT · DISABLED BY DEFAULT</span></div>
   <header className={ui.hero}><div><span className={ui.overline}>REGPILOT / TEAM OPERATIONS</span><h1>One team.<br/><em>Clear ownership.</em></h1><p>Authenticated work items, assigned responsibility, due dates and auditable changes. AI suggestions enter this queue only when a user deliberately accepts them.</p></div><span className={ui.heroMark}>R</span></header>
   <div className={shell.warning}><strong>Staging-first:</strong> This feature requires verified Supabase authentication and a migrated PostgreSQL database. Private evidence files can be stored only after configuring a private bucket and antivirus scanner. Neither a file nor a work status certifies compliance. Do not use confidential or regulated information.</div>
   {message&&<p className={ui.message} role="status">{message}</p>}
   <section className={ui.bar}>
    {user?<><div><span className={ui.overline}>SIGNED IN AS</span><strong>{user.email}</strong></div><button onClick={()=>void signOut()} disabled={busy}>Sign out</button></>:
    <form onSubmit={login} className={ui.login}><label>Email sign-in<input type="email" autoComplete="email" required placeholder="you@company.co.uk" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>Send secure link</button></form>}
   </section>
   {user&&organisations.length===0&&<section className={ui.card}><h2>Start an approved pilot workspace</h2><p>Only invited, email-verified pilot accounts can create a company.</p><form onSubmit={bootstrap} className={ui.newForm}><label>Company name<input value={company} minLength={3} maxLength={100} onChange={e=>setCompany(e.target.value)}/></label><button disabled={busy}>Create pilot workspace</button></form></section>}
   {user&&organisations.length>0&&<>
    <section className={ui.bar}><label>Organisation<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{organisations.map(o=><option value={o.id} key={o.id}>{o.name} · {o.role}</option>)}</select></label>
     <div className={ui.barActions}><button onClick={()=>void loadTasks(orgId)} disabled={busy}>↻ Refresh</button>{canWrite&&<button className={ui.primary} onClick={()=>setShowCreate(x=>!x)}>{showCreate?"Close form":"＋ New task"}</button>}</div>
    </section>
    {showCreate&&canWrite&&<section className={ui.card}><h2>Create a team task</h2><p>Keep task details factual. Do not enter sensitive information in the pilot.</p><form onSubmit={create} className={ui.newForm}>
     <label>Task title<input required maxLength={160} value={draft.title} onChange={e=>setDraft(x=>({...x,title:e.target.value}))}/></label>
     <label>Category<input maxLength={80} value={draft.category} onChange={e=>setDraft(x=>({...x,category:e.target.value}))}/></label>
     <label>Responsible owner<input required maxLength={80} value={draft.ownerName} onChange={e=>setDraft(x=>({...x,ownerName:e.target.value}))}/></label>
     <label>Due date<input required type="date" value={draft.dueDate} onChange={e=>setDraft(x=>({...x,dueDate:e.target.value}))}/></label>
     <label className={ui.full}>Working notes<textarea maxLength={500} rows={3} value={draft.notes} onChange={e=>setDraft(x=>({...x,notes:e.target.value}))}/></label>
     <button disabled={busy} className={ui.primary}>Save team task</button>
    </form></section>}
    <section className={ui.card}><div className={ui.heading}><div><span className={ui.overline}>SHARED WORK QUEUE</span><h2>{items.length} recorded tasks</h2><p>Changes are associated with authenticated users and organisation membership.</p></div><span className={ui.count}>{items.filter(x=>x.status!=="COMPLETE").length} open</span></div>
     <div className={ui.filters}><input aria-label="Search tasks" placeholder="Search work or owners…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Filter work status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Recorded complete</option></select></div>
     <div className={ui.tasks}>{visible.length===0?<p className={ui.empty}>No matching tasks. {ready?"Record a task to begin.":"Loading…"}</p>:visible.map(task=><article className={ui.task} key={task.id}><div><span className={ui.overline}>{task.category} · Due {fmt(task.dueDate)}</span><h3>{task.title}</h3><p>{task.ownerName} · {task.notes||"No additional notes"}</p>{task.completionException&&<p className={ui.completionFlag}>Completion exception recorded: {task.completionRationale}</p>}{task.sourceUrl&&<a href={task.sourceUrl} target="_blank" rel="noopener noreferrer">View recorded source ↗</a>} <a href={"/team/evidence?taskId="+encodeURIComponent(task.id)}>Attach or review evidence ↗</a></div><div><label>Exception rationale (if no reviewed evidence)<textarea rows={2} maxLength={500} value={completionNotes[task.id]||""} onChange={e=>setCompletionNotes(n=>({...n,[task.id]:e.target.value}))} placeholder="Needed only when closing without approved evidence"/></label><label>Work status<select disabled={!canWrite||busy} value={task.status} onChange={e=>void changeStatus(task,e.target.value as Task["status"])}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Recorded complete</option></select></label></div></article>)}</div>
     <p className={ui.foot}>Only the most recent 100 tasks are returned. Completion indicates work status, not verified compliance or evidence approval.</p>
    </section>
   </>}
   <footer className={shell.footer}>Private test environment only · Secure evidence storage, true organisation invitations and regulatory sign-off require further development.</footer>
  </main>
 </div>;
}
