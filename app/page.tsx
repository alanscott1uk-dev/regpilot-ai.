"use client";
import { useEffect, useMemo, useState } from "react";
import { validateObligation, isOverdue, exportObligationsCsv } from "../lib/obligations.mjs";

type Status = "Open" | "In progress" | "Complete";
type Obligation = { id: string; title: string; regulator: string; owner: string; due: string; status: Status; notes: string };
const KEY = "regpilot-demo-obligations-v1";
const initial: Obligation[] = [
  { id: "sample-1", title: "Review training records", regulator: "Internal", owner: "Quality lead", due: "2026-11-15", status: "Open", notes: "Illustrative example only" },
  { id: "sample-2", title: "Review supplier qualification procedure", regulator: "Internal", owner: "Operations lead", due: "2026-12-01", status: "In progress", notes: "Illustrative example only" }
];
const field: React.CSSProperties = {padding:"11px 12px",border:"1px solid #cbd5e1",borderRadius:8,font:"inherit",width:"100%",boxSizing:"border-box"};
const btn: React.CSSProperties = {padding:"10px 14px",border:0,borderRadius:8,background:"#1d4ed8",color:"white",cursor:"pointer",fontWeight:700};
export default function Home() {
  const [items,setItems] = useState<Obligation[]>([]);
  const [ready,setReady] = useState(false);
  const [filter,setFilter] = useState("All");
  const [search,setSearch] = useState("");
  const [title,setTitle] = useState("");
  const [regulator,setRegulator] = useState("");
  const [owner,setOwner] = useState("");
  const [due,setDue] = useState("");
  const [notes,setNotes] = useState("");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) { setItems(initial); }
      else {
        const parsed: unknown = JSON.parse(raw);
        setItems(Array.isArray(parsed) ? parsed.filter((x): x is Obligation => validateObligation(x)) : initial);
      }
    } catch { setItems(initial); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { window.localStorage.setItem(KEY,JSON.stringify(items)); } catch {} } },[items,ready]);
  const visible = useMemo(() => items.filter(x => (filter === "All" || x.status === filter) && [x.title,x.owner,x.regulator].join(" ").toLowerCase().includes(search.toLowerCase())),[items,filter,search]);
  const overdue = items.filter(x => isOverdue(x, new Date().toISOString().slice(0,10))).length;
  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !owner.trim() || !due) return;
    setItems(current => [{id:crypto.randomUUID(),title:title.trim(),regulator:regulator.trim() || "Internal",owner:owner.trim(),due,status:"Open",notes:notes.trim()},...current]);
    setTitle("");setRegulator("");setOwner("");setDue("");setNotes("");
  }
  function update(id:string,status:Status) {setItems(current=>current.map(x=>x.id===id?{...x,status}:x));}
  function exportCsv() {
    const csv=exportObligationsCsv(visible);
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="regpilot-obligations.csv";a.click();URL.revokeObjectURL(url);
  }
  return <main style={{maxWidth:1100,margin:"0 auto",padding:"40px 20px",lineHeight:1.5}}>
    <div style={{fontSize:13,color:"#1d4ed8",fontWeight:800,letterSpacing:1}}>REGPILOT AI / DEMO</div>
    <h1 style={{fontSize:38,margin:"8px 0"}}>Compliance workspace</h1>
    <p style={{color:"#475569"}}>Track tasks, owners, deadlines and progress in one place.</p>
    <div role="alert" style={{padding:16,background:"#fff7ed",border:"1px solid #fdba74",borderRadius:10,margin:"20px 0"}}>
      <strong>Prototype only.</strong> Data stays in this browser's local storage, is not backed up, and may be lost. Do not enter personal, patient, confidential or production compliance data. Examples are not regulatory requirements.
    </div>
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,margin:"24px 0"}}>
      {([["Total",items.length],["Open",items.filter(x=>x.status==="Open").length],["In progress",items.filter(x=>x.status==="In progress").length],["Overdue",overdue]] as const).map(([label,count])=><div key={label} style={{background:"white",border:"1px solid #e2e8f0",borderRadius:12,padding:20}}><div style={{color:"#64748b"}}>{label}</div><strong style={{fontSize:30}}>{count}</strong></div>)}
    </section>
    <section style={{background:"white",border:"1px solid #e2e8f0",padding:22,borderRadius:12,marginBottom:22}}>
      <h2 style={{marginTop:0}}>Add an obligation or action</h2>
      <form onSubmit={add} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
        <label>Title *<input style={field} maxLength={160} required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Action title"/></label>
        <label>Category / regulator<input style={field} maxLength={80} value={regulator} onChange={e=>setRegulator(e.target.value)} placeholder="e.g. Internal"/></label>
        <label>Owner *<input style={field} maxLength={80} required value={owner} onChange={e=>setOwner(e.target.value)} placeholder="Responsible role"/></label>
        <label>Due date *<input style={field} type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label style={{gridColumn:"1 / -1"}}>Notes<input style={field} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes"/></label>
        <div><button style={btn} type="submit">Add action</button></div>
      </form>
    </section>
    <section style={{background:"white",border:"1px solid #e2e8f0",padding:22,borderRadius:12}}>
      <h2 style={{marginTop:0}}>Obligation register</h2>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:18}}>
        <input aria-label="Search obligations" style={{...field,flex:"1 1 220px",width:"auto"}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search title, owner or category"/>
        <select aria-label="Filter by status" style={{...field,width:"auto"}} value={filter} onChange={e=>setFilter(e.target.value)}>{["All","Open","In progress","Complete"].map(s=><option key={s}>{s}</option>)}</select>
        <button type="button" style={btn} onClick={exportCsv}>Export CSV</button>
      </div>
      {!ready?<p>Loading local demo data…</p>:visible.length===0?<p>No matching actions.</p>:
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left",minWidth:680}}>
        <thead><tr>{["Action","Category","Owner","Due","Status",""].map(h=><th key={h} style={{padding:10,borderBottom:"2px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
        <tbody>{visible.map(x=><tr key={x.id}>
          <td style={{padding:10,borderBottom:"1px solid #e2e8f0"}}><strong>{x.title}</strong>{x.notes&&<div style={{fontSize:12,color:"#64748b"}}>{x.notes}</div>}</td>
          <td style={{padding:10}}>{x.regulator}</td><td style={{padding:10}}>{x.owner}</td>
          <td style={{padding:10,color:x.status!=="Complete"&&x.due<new Date().toISOString().slice(0,10)?"#b91c1c":undefined}}>{x.due}</td>
          <td style={{padding:10}}><select aria-label={"Status for "+x.title} style={{...field,width:"auto"}} value={x.status} onChange={e=>update(x.id,e.target.value as Status)}>{["Open","In progress","Complete"].map(s=><option key={s}>{s}</option>)}</select></td>
          <td style={{padding:10}}><button type="button" onClick={()=>{if(window.confirm("Delete this action?"))setItems(current=>current.filter(v=>v.id!==x.id));}} style={{background:"transparent",border:"1px solid #cbd5e1",borderRadius:6,padding:8,cursor:"pointer"}}>Delete</button></td>
        </tr>)}</tbody></table></div>}
    </section>
  </main>;
}
