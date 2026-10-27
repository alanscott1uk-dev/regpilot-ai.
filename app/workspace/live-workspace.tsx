"use client";
import { useEffect, useState } from "react";
import { stagingSupabase } from "../../lib/staging-supabase";
type Org = {organization_id:string;role:string;organizations:{name:string}|{name:string}[]|null};
type Row = {id:string;module_id:string;title:string;owner_name:string;due_date:string|null;status:string};
export default function LiveWorkspace({onOpenBeta}:{onOpenBeta:()=>void}) {
 const [state,setState]=useState<"loading"|"signed-out"|"no-org"|"ready"|"error">("loading");
 const [orgs,setOrgs]=useState<Org[]>([]);const [org,setOrg]=useState("");
 const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState("");
 const [filter,setFilter]=useState("all");
 useEffect(()=>{
  let active=true;
  const db=stagingSupabase();
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
  stagingSupabase().from("module_records").select("id,module_id,title,owner_name,due_date,status").eq("organization_id",org).order("created_at",{ascending:false}).limit(100).then(({data,error})=>{
   if(!active)return;if(error){setError(error.message);setState("error");}else setRows((data??[]) as Row[]);
  });
  return()=>{active=false;};
 },[org]);
 const panel:React.CSSProperties={padding:20,border:"1px solid #dbe3ee",borderRadius:16,background:"white"};
 if(state==="loading")return <section style={panel} aria-live="polite">Loading your business workspace…</section>;
 if(state==="signed-out"||state==="no-org")return <section style={panel}><h2>{state==="signed-out"?"Sign in to RegPilot":"Create your test organisation"}</h2><p>Access saved records and departmental modules from one secure staging workspace.</p><button onClick={onOpenBeta} style={{padding:12,border:0,borderRadius:10,background:"#2659df",color:"white"}}>Open account setup</button></section>;
 if(state==="error")return <section style={panel} role="alert"><h2>Unable to load workspace</h2><p>{error}</p></section>;
 const visible=rows.filter(r=>filter==="all"||r.module_id===filter);
 const modules=[...new Set(rows.map(r=>r.module_id))].sort();
 return <section style={{display:"grid",gap:16}}>
  <div style={panel}><h2 style={{marginTop:0}}>Your business records</h2><label>Organisation<select value={org} onChange={e=>setOrg(e.target.value)} style={{display:"block",padding:11,marginTop:7,width:"100%",maxWidth:440}}>{orgs.map(o=><option key={o.organization_id} value={o.organization_id}>{Array.isArray(o.organizations)?o.organizations[0]?.name:o.organizations?.name??"Organisation"} ({o.role})</option>)}</select></label></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>{[["Saved records",rows.length],["Open",rows.filter(x=>x.status==="OPEN").length],["In progress",rows.filter(x=>x.status==="IN_PROGRESS").length],["Completed",rows.filter(x=>x.status==="COMPLETE").length]].map(([label,value])=><div key={label} style={panel}><div style={{fontSize:13,color:"#64748b"}}>{label}</div><strong style={{fontSize:27}}>{value}</strong></div>)}</div>
  <div style={panel}><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><h2 style={{margin:0}}>Departmental records</h2><button onClick={onOpenBeta}>Manage records</button></div><label style={{display:"block",marginTop:16}}>Module<select style={{display:"block",padding:10,marginTop:5,width:"100%",maxWidth:350}} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All modules</option>{modules.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
   {visible.length===0?<p style={{color:"#64748b"}}>No saved records for this selection.</p>:visible.map(r=><article key={r.id} style={{padding:"15px 0",borderBottom:"1px solid #e2e8f0"}}><strong>{r.title}</strong><div style={{fontSize:13,color:"#64748b"}}>{r.module_id} · {r.owner_name} · {r.status} · {r.due_date??"No review date"}</div></article>)}
  </div>
 </section>;
}
