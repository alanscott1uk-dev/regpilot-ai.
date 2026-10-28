"use client";
import { useEffect, useState } from "react";
import { stagingSupabase } from "../../lib/staging-supabase";
import { filterRecords, recordUrgency } from "../../lib/record-workspace.mjs";
type Org = {organization_id:string;role:string;organizations:{name:string}|{name:string}[]|null};
type Row = {id:string;module_id:string;title:string;owner_name:string;due_date:string|null;status:string;details?:Record<string,string>};
export default function LiveWorkspace({onOpenBeta}:{onOpenBeta:()=>void}) {
 const [state,setState]=useState<"loading"|"signed-out"|"no-org"|"ready"|"error">("loading");
 const [orgs,setOrgs]=useState<Org[]>([]);const [org,setOrg]=useState("");
 const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState("");
 const [filter,setFilter]=useState("all");
 const [newTitle,setNewTitle]=useState("");
 const [newOwner,setNewOwner]=useState("");
 const [newDue,setNewDue]=useState("");
 const [sopCode,setSopCode]=useState("");
 const [sopRevision,setSopRevision]=useState("");
 const [creating,setCreating]=useState(false);
 const [showCreate,setShowCreate]=useState(false);
 const [selectedRecord,setSelectedRecord]=useState<string|null>(null);
 const [query,setQuery]=useState("");
 const [urgency,setUrgency]=useState("all");
 const [today,setToday]=useState("2026-10-27");
 const [reload,setReload]=useState(0);
 const [updating,setUpdating]=useState<string|null>(null);
 useEffect(()=>{const d=new Date();setToday([d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"));},[]);
 useEffect(()=>{
  let active=true;
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){setError("This preview needs a fresh deployment with Supabase configuration.");setState("error");return;}
  let db: ReturnType<typeof stagingSupabase>;
  try { db=stagingSupabase(); } catch {setError("Staging connection is not configured.");setState("error");return;}
  async function init(){
   const {data:{user},error:authError}=await db.auth.getUser();
   if(!active)return;
   if(authError||!user){setState("signed-out");return;}
   const {data,error}=await db.from("organization_memberships").select("organization_id,role,organizations(name)");
   if(!active)return;
   if(error){setError(error.message);setState("error");return;}
   const list=(data??[]) as unknown as Org[];
   setOrgs(list);setOrg(list[0]?.organization_id??"");setState(list.length?"ready":"no-org");
  }
  init().catch(()=>{if(active){setState("error");setError("Unable to connect to staging.");}});
  const {data:{subscription}}=db.auth.onAuthStateChange(()=>{void init();});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!org){setRows([]);return;}
  let active=true;
  stagingSupabase().from("module_records").select("id,module_id,title,owner_name,due_date,status,details").eq("organization_id",org).order("created_at",{ascending:false}).limit(100).then(({data,error})=>{
   if(!active)return;if(error){setError(error.message);setState("error");}else setRows((data??[]) as Row[]);
  });
  return()=>{active=false;};
 },[org,reload]);
 const panel:React.CSSProperties={padding:20,border:"1px solid #dbe3ee",borderRadius:16,background:"white"};
 if(state==="loading")return <section style={panel} aria-live="polite">Loading your business workspace…</section>;
 if(state==="signed-out"||state==="no-org")return <section style={panel}><h2>{state==="signed-out"?"Sign in to RegPilot":"Create your test organisation"}</h2><p>Access saved records and departmental modules from one secure staging workspace.</p><button onClick={onOpenBeta} style={{padding:12,border:0,borderRadius:10,background:"#2659df",color:"white"}}>Open account setup</button></section>;
 if(state==="error")return <section style={panel} role="alert"><h2>Unable to load workspace</h2><p>{error}</p></section>;
 const visible=filterRecords(rows,{module:filter,query,urgency,today}) as Row[];
 const selected=rows.find(r=>r.id===selectedRecord);
 const role=orgs.find(o=>o.organization_id===org)?.role;
 const canEdit=["OWNER","ADMIN","EDITOR"].includes(role??"");
 async function createRecord(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!canEdit||!org)return;setCreating(true);setError("");
  const {data,error}=await stagingSupabase().from("module_records").insert({organization_id:org,module_id:filter==="all"?"obligations":filter,title:newTitle.trim(),owner_name:newOwner.trim(),due_date:newDue||null,status:"OPEN",notes:"",details:filter==="policies"?{documentCode:sopCode.trim(),revision:sopRevision.trim(),reviewDate:newDue}:{} }).select("id,module_id,title,owner_name,due_date,status").single();
  if(error)setError(error.message);else{setRows(prev=>[data as Row,...prev]);setNewTitle("");setNewOwner("");setNewDue("");setSopCode("");setSopRevision("");setShowCreate(false);}
  setCreating(false);
 }
 async function changeStatus(record:Row,next:string){if(!canEdit)return;setUpdating(record.id);setError("");const {data,error}=await stagingSupabase().from("module_records").update({status:next}).eq("organization_id",org).eq("id",record.id).select("id,status").single();if(error)setError(error.message);else setRows(prev=>prev.map(r=>r.id===data.id?{...r,status:data.status}:r));setUpdating(null);}
 const modules=[...new Set(rows.map(r=>r.module_id))].sort();
 return <section style={{display:"grid",gap:16}}>
  <div style={panel}><h2 style={{marginTop:0}}>Your business records</h2><label>Organisation<select value={org} onChange={e=>setOrg(e.target.value)} style={{display:"block",padding:11,marginTop:7,width:"100%",maxWidth:440}}>{orgs.map(o=><option key={o.organization_id} value={o.organization_id}>{Array.isArray(o.organizations)?o.organizations[0]?.name:o.organizations?.name??"Organisation"} ({o.role})</option>)}</select></label></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>{[["Saved records",rows.length],["Open",rows.filter(x=>x.status==="OPEN").length],["In progress",rows.filter(x=>x.status==="IN_PROGRESS").length],["Completed",rows.filter(x=>x.status==="COMPLETE").length]].map(([label,value])=><div key={label} style={panel}><div style={{fontSize:13,color:"#64748b"}}>{label}</div><strong style={{fontSize:27}}>{value}</strong></div>)}</div>
  <div style={panel}><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><h2 style={{margin:0}}>Departmental records</h2><div style={{display:"flex",gap:8}}><button onClick={()=>setReload(v=>v+1)}>Refresh</button>{canEdit&&<button onClick={()=>setShowCreate(v=>!v)}>{showCreate?"Cancel":"Add record"}</button>}</div></div><label style={{display:"block",marginTop:16}}>Module<select style={{display:"block",padding:10,marginTop:5,width:"100%",maxWidth:350}} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All modules</option>{modules.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}><button type="button" onClick={()=>{setFilter("policies");setShowCreate(false);}}>Policies &amp; SOPs</button><button type="button" onClick={()=>{setFilter("suppliers");setShowCreate(false);}}>Suppliers</button><button type="button" onClick={()=>{setFilter("licences");setShowCreate(false);}}>Licences</button></div>
   {showCreate&&canEdit&&<form onSubmit={createRecord} style={{display:"grid",gap:10,padding:16,marginTop:14,background:"#f8fafc",borderRadius:12}}>
    <strong>Create action in {filter==="all"?"Compliance register":filter}</strong>
    <label>Action title<input required maxLength={160} value={newTitle} onChange={e=>setNewTitle(e.target.value)} style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label>
    <label>Responsible person or department<input required maxLength={80} value={newOwner} onChange={e=>setNewOwner(e.target.value)} style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label>
    {filter==="policies"&&<><label>Document code<input required maxLength={80} value={sopCode} onChange={e=>setSopCode(e.target.value)} placeholder="SOP-001" style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label><label>Revision<input required maxLength={30} value={sopRevision} onChange={e=>setSopRevision(e.target.value)} placeholder="1.0" style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label><p style={{fontSize:12,color:"#64748b"}}>This saves SOP metadata only. No document file or approval is stored.</p></>}
    <label>Review date<input type="date" value={newDue} onChange={e=>setNewDue(e.target.value)} style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label>
    <button disabled={creating} style={{padding:11,background:"#2659df",color:"white",border:0,borderRadius:10}}>{creating?"Saving…":"Save action"}</button>
   </form>}
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginTop:12}}>
    <label>Search<input aria-label="Search records" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Title, owner or module" style={{display:"block",padding:10,width:"100%",boxSizing:"border-box",marginTop:5}}/></label>
    <label>Deadline<select aria-label="Deadline filter" value={urgency} onChange={e=>setUrgency(e.target.value)} style={{display:"block",padding:10,width:"100%",marginTop:5}}><option value="all">All deadlines</option><option value="overdue">Overdue</option><option value="due-soon">Due within 7 days</option><option value="upcoming">Due within 30 days</option><option value="undated">No date</option><option value="complete">Complete</option></select></label>
   </div>
   {selected&&<aside style={{border:"1px solid #c7d8ff",background:"#f4f7ff",borderRadius:14,padding:16,marginTop:16}} aria-label="Selected action details">
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}><h3 style={{margin:0}}>{selected.title}</h3><button onClick={()=>setSelectedRecord(null)}>Close</button></div>
    <p style={{fontSize:13,color:"#475569"}}>Owner: {selected.owner_name} · Module: {selected.module_id} · Due: {selected.due_date??"Not set"}</p>
    <strong>Supporting evidence</strong>
    <p style={{fontSize:13,color:"#64748b"}}>Secure document uploads are not yet enabled. Evidence review is not operational in this beta.</p>
    <button onClick={onOpenBeta}>Open record management</button>
   </aside>}
   {error&&<p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
   <p style={{fontSize:13,color:"#64748b"}}>{visible.length} of {rows.length} records · Ordered by due date and urgency</p>
   {visible.length===0?<p style={{color:"#64748b"}}>No saved records for this selection.</p>:visible.map(r=><article key={r.id} style={{padding:"15px 0",borderBottom:"1px solid #e2e8f0"}}><button onClick={()=>setSelectedRecord(r.id)} style={{background:"transparent",border:0,padding:0,fontWeight:750,color:"#2144a4",cursor:"pointer",textAlign:"left"}}>{r.title}</button><div style={{fontSize:13,color:"#64748b"}}>{r.module_id} · {r.owner_name} {r.module_id==="policies"&&r.details?.documentCode?" · "+r.details.documentCode+" rev "+(r.details.revision??""):""} · {r.due_date??"No review date"} · {recordUrgency(r,today).replace("-"," ")}</div>{canEdit?<label style={{display:"block",marginTop:10,fontSize:13}}>Status <select aria-label={"Status for "+r.title} value={r.status} disabled={updating===r.id} onChange={e=>void changeStatus(r,e.target.value)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Complete</option></select></label>:<span style={{fontSize:12}}>Status: {r.status}</span>}</article>)}
  </div>
 </section>;
}
