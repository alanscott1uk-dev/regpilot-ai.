"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { stagingSupabase } from "../../lib/staging-supabase";
import { fieldsForModule, validateModuleDetails } from "../../lib/module-fields.mjs";
const MODULES = [
 ["licences","Licences & certifications"],["policies","Policies & SOPs"],["audits","Audits & inspections"],
 ["risk","Risk management"],["safety","Health & safety"],["hr","HR compliance"],
 ["privacy","Data protection"],["suppliers","Supplier qualification"],["imports","Imports & distribution"],
 ["training","Training & competency"],["departments","Departments & ownership"],["reporting","Management reporting"],
 ["regulatory","Regulatory intelligence"],["obligations","Compliance register"],["environment","Environmental compliance"]
] as const;
const configured=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
type Org = { organization_id:string; role:string; organizations: {id:string;name:string} | {id:string;name:string}[] | null };
type RecordRow = {id:string;title:string;module_id:string;status:string;due_date:string|null;owner_name:string;details?:Record<string,string>};
const input:React.CSSProperties={width:"100%",padding:12,border:"1px solid #cbd5e1",borderRadius:10,boxSizing:"border-box"};
export default function BetaPage() {
 const [email,setEmail]=useState("");const [newOrg,setNewOrg]=useState("");const [userEmail,setUserEmail]=useState<string|null>(null);
 const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
 const [memberships,setMemberships]=useState<Org[]>([]);const [orgId,setOrgId]=useState("");
 const [records,setRecords]=useState<RecordRow[]>([]);
 const [title,setTitle]=useState("");const [owner,setOwner]=useState("");const [moduleId,setModuleId]=useState("suppliers");
 const [due,setDue]=useState("");
 const [details,setDetails]=useState<Record<string,string>>({});
 const [savingId,setSavingId]=useState<string|null>(null);
 const [recordFilter,setRecordFilter]=useState("all");
 const [recordSearch,setRecordSearch]=useState("");
 const visibleRecords=records.filter(r=>(recordFilter==="all"||r.module_id===recordFilter)&&[r.title,r.owner_name,r.module_id].join(" ").toLowerCase().includes(recordSearch.toLowerCase()));
 async function load() {
  const db=stagingSupabase();
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user){setUserEmail(null);setMemberships([]);setRecords([]);return;}
  setUserEmail(user.email??"Signed-in user");
  const {data,error}=await db.from("organization_memberships").select("organization_id,role,organizations(id,name)");
  if(error){setMessage(error.message);return;}
  const orgs=(data??[]) as unknown as Org[];
  setMemberships(orgs);
  setOrgId(previous=>orgs.some(x=>x.organization_id===previous)?previous:(orgs[0]?.organization_id??""));
 }
 useEffect(()=>{if(!configured){setMessage("This preview was built without Supabase configuration. Redeploy the branch to enable sign-in.");return;}load().catch(()=>setMessage("Staging connection unavailable."));const {data:{subscription}}=stagingSupabase().auth.onAuthStateChange(()=>{void load();});return()=>subscription.unsubscribe();},[]);
 useEffect(()=>{if(!orgId){setRecords([]);return;}let alive=true;stagingSupabase().from("module_records").select("id,title,module_id,status,due_date,owner_name,details").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(100).then(({data,error})=>{if(!alive)return;if(error)setMessage(error.message);else setRecords((data??[]) as RecordRow[]);});return()=>{alive=false;};},[orgId]);
 async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");const {error}=await stagingSupabase().auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/beta"}});setMessage(error?error.message:"Check your email for the sign-in link. Access to an organisation requires an invitation.");setBusy(false);}
 async function createOrg(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");
  const {error}=await stagingSupabase().rpc("create_beta_organization",{p_name:newOrg.trim()});
  if(error)setMessage(error.message);else{setNewOrg("");setMessage("Demo organisation created.");await load();}
  setBusy(false);
 }
 async function addRecord(e:React.FormEvent){e.preventDefault();if(!orgId)return;setBusy(true);setMessage("");
  if(!validateModuleDetails(moduleId,details)){setMessage("Check the module-specific fields.");setBusy(false);return;}
  const membership=memberships.find(m=>m.organization_id===orgId);
  if(!membership||!["OWNER","ADMIN","EDITOR"].includes(membership.role)){setMessage("You do not have edit permission.");setBusy(false);return;}
  const {data,error}=await stagingSupabase().from("module_records").insert({organization_id:orgId,module_id:moduleId,title:title.trim(),owner_name:owner.trim(),due_date:due||null,status:"OPEN",notes:"",details}).select("id,title,module_id,status,due_date,owner_name").single();
  if(error)setMessage(error.message);else{setRecords(prev=>[data as RecordRow,...prev]);setTitle("");setOwner("");setDue("");setDetails({});setMessage("Record saved to staging.");}
  setBusy(false);
 }
 async function changeStatus(record:RecordRow,next:"OPEN"|"IN_PROGRESS"|"COMPLETE") {
  const member=memberships.find(m=>m.organization_id===orgId);
  if(!member||!["OWNER","ADMIN","EDITOR"].includes(member.role)){setMessage("You do not have permission to update this record.");return;}
  setSavingId(record.id);setMessage("");
  const {data,error}=await stagingSupabase().from("module_records").update({status:next}).eq("id",record.id).eq("organization_id",orgId).select("id,status").single();
  if(error)setMessage(error.message);else setRecords(prev=>prev.map(r=>r.id===data.id?{...r,status:data.status}:r));
  setSavingId(null);
 }
 return <main style={{maxWidth:850,margin:"auto",padding:"30px 18px",fontFamily:"system-ui",color:"#17233b"}}>
  <Link href="/workspace">← Workspace preview</Link><h1>EAGNEXIS AI private beta</h1>
  <p style={{color:"#64748b"}}>Staging only. Do not enter confidential or regulated information.</p>
  {!configured?<section role="alert" style={{padding:20,background:"#fff4e5",border:"1px solid #f2d3a0",borderRadius:14}}><h2>Staging connection unavailable</h2><p>This preview was built before its Supabase configuration was available. A new preview deployment is required.</p></section>:!userEmail?<form onSubmit={signIn} style={{background:"white",border:"1px solid #dbe3ee",borderRadius:16,padding:22,display:"grid",gap:12}}>
   <h2 style={{margin:0}}>Sign in by email</h2><label>Email address<input style={input} type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <button disabled={busy} style={{padding:12,background:"#2659df",color:"white",border:0,borderRadius:10}}>{busy?"Sending…":"Send sign-in link"}</button>
  </form>:<><div style={{background:"#fff",padding:18,borderRadius:14,border:"1px solid #dbe3ee"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><strong>{userEmail}</strong><button onClick={async()=>{await stagingSupabase().auth.signOut();setOrgId("");setRecords([]);setUserEmail(null);}}>Sign out</button></div>
   {memberships.length===0?<p>No organisation yet. Create a synthetic test organisation below to try the beta.</p>:<>
    <label style={{display:"block",marginTop:16}}>Organisation<select style={input} value={orgId} onChange={e=>setOrgId(e.target.value)}>{memberships.map(m=><option key={m.organization_id} value={m.organization_id}>{Array.isArray(m.organizations)?m.organizations[0]?.name:m.organizations?.name??m.organization_id} ({m.role})</option>)}</select></label>
   </>}
  </div>
  <form onSubmit={createOrg} style={{background:"white",padding:18,borderRadius:14,border:"1px solid #dbe3ee",display:"grid",gap:10,marginTop:18}}>
   <h2 style={{margin:0,fontSize:19}}>Create test organisation</h2>
   <p style={{fontSize:13,color:"#64748b",margin:0}}>For fictional beta data only. Maximum three organisations per account.</p>
   <label>Organisation name<input style={input} required minLength={2} maxLength={120} value={newOrg} onChange={e=>setNewOrg(e.target.value)} placeholder="Example Trading Ltd"/></label>
   <button disabled={busy} style={{padding:12,background:"#2659df",color:"white",border:0,borderRadius:10}}>Create organisation</button>
  </form>
  {orgId&&<><form onSubmit={addRecord} style={{background:"white",padding:20,borderRadius:14,border:"1px solid #dbe3ee",display:"grid",gap:12,marginTop:18}}>
   <h2 style={{margin:0}}>Add staging record</h2><label>Module<select style={input} value={moduleId} onChange={e=>{setModuleId(e.target.value);setDetails({});}}>{MODULES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label>Action title<input style={input} maxLength={160} required value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Owner<input style={input} maxLength={80} required value={owner} onChange={e=>setOwner(e.target.value)}/></label>
   <label>Review date<input style={input} type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
   {fieldsForModule(moduleId).length>0&&<fieldset style={{border:"1px solid #dbe3ee",borderRadius:12,padding:12}}><legend>Module-specific details</legend><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>{fieldsForModule(moduleId).map((field:{key:string;label:string;type:string;options?:string[]})=><label key={field.key}>{field.label}{field.type==="select"?<select style={input} value={details[field.key]??""} onChange={e=>setDetails(p=>({...p,[field.key]:e.target.value}))}><option value="">Not specified</option>{field.options?.map((v:string)=><option key={v} value={v}>{v}</option>)}</select>:<input style={input} maxLength={180} type={field.type} value={details[field.key]??""} onChange={e=>setDetails(p=>({...p,[field.key]:e.target.value}))}/>}</label>)}</div></fieldset>}
   <button disabled={busy} style={{padding:12,background:"#2659df",color:"white",border:0,borderRadius:10}}>Save record</button>
  </form><section style={{marginTop:20}}><h2>Saved records</h2><div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}><select aria-label="Filter module" style={{...input,flex:"1 1 180px"}} value={recordFilter} onChange={e=>setRecordFilter(e.target.value)}><option value="all">All modules</option>{MODULES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><input aria-label="Search saved records" style={{...input,flex:"1 1 180px"}} value={recordSearch} onChange={e=>setRecordSearch(e.target.value)} placeholder="Search records"/></div>{visibleRecords.length===0?<p>No matching records.</p>:visibleRecords.map(r=><article key={r.id} style={{background:"white",border:"1px solid #dbe3ee",padding:14,marginBottom:10,borderRadius:12}}><strong>{r.title}</strong><div style={{color:"#64748b",fontSize:13}}>{r.module_id} · {r.owner_name} · {r.status} · {r.due_date??"No date"}</div><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>{Object.entries(r.details??{}).filter(([,v])=>v).map(([key,value])=><span key={key} style={{fontSize:12,background:"#eef4ff",padding:"5px 8px",borderRadius:7}}>{key}: {String(value)}</span>)}</div><label style={{display:"block",marginTop:10,fontSize:13}}>Update status <select aria-label={"Status for "+r.title} disabled={savingId===r.id} value={r.status} onChange={e=>void changeStatus(r,e.target.value as "OPEN"|"IN_PROGRESS"|"COMPLETE")}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Complete</option></select></label></article>)}</section></>}
  </>}
  {message&&<p role="status" style={{padding:12,background:"#eef4ff",borderRadius:10}}>{message}</p>}
 </main>;
}
