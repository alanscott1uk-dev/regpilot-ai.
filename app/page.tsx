"use client";
import { useEffect, useMemo, useState } from "react";
import { validateObligation, isOverdue, exportObligationsCsv } from "../lib/obligations.mjs";
import { pilot } from "../fixtures/star-medical-demo.mjs";
import styles from "./dashboard.module.css";

type Status = "Open" | "In progress" | "Complete";
type Obligation = { id: string; title: string; regulator: string; owner: string; due: string; status: Status; notes: string };
const KEY = "regpilot-demo-obligations-v1";
function todayLocal(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
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
  const overdue = items.filter(x => isOverdue(x, todayLocal())).length;
  function loadPilot() {
    if (!window.confirm("Replace local demo obligations with eight fictional Star Medical examples? Export your current CSV first.")) return;
    setItems(pilot.actions.map(x => ({ id:x.id, title:x.title, regulator:x.category, owner:x.owner, due:x.due, status:x.done ? "Complete" : "Open", notes:"Fictional pilot record — not regulatory advice" })));
  }
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
  const counts=[["Total actions",items.length],["Open",items.filter(x=>x.status==="Open").length],["In progress",items.filter(x=>x.status==="In progress").length],["Overdue",overdue]] as const;
  return <main className={styles.shell}>
    <header className={styles.top}>
      <div className={styles.brand}><span className={styles.mark}>R</span>RegPilot <span style={{color:"#3159df"}}>AI</span></div>
      <span className={styles.pill}>DEMO WORKSPACE</span>
    </header>
    <section className={styles.hero}>
      <div><div className={styles.eyebrow}>Overview / Compliance</div><h1 className={styles.heading}>Compliance workspace</h1><p className={styles.sub}>Track obligations, deadlines and ownership in one place.</p></div>
    </section>
    <div className={styles.notice} role="note"><strong>Prototype only.</strong> Records stay in this browser, without secure backup. Use fictional examples only — no patient, confidential or production compliance information.</div>
    <section className={styles.stats} aria-label="Compliance summary">{counts.map(([label,count])=><div key={label} className={styles.stat}><div className={styles.statLabel}>{label}</div><div className={styles.statNumber}>{count}</div></div>)}</section>
    <div className={styles.content}>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Obligation register</h2>
        <div className={styles.toolbar}>
          <input className={styles.field+" "+styles.search} aria-label="Search obligations" placeholder="Search obligations..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className={styles.field+" "+styles.filter} aria-label="Filter by status" value={filter} onChange={e=>setFilter(e.target.value)}>{["All","Open","In progress","Complete"].map(x=><option key={x}>{x}</option>)}</select>
          <button className={styles.button+" "+styles.outline} type="button" onClick={exportCsv}>Export CSV</button>
          <button className={styles.button+" "+styles.outline} type="button" onClick={loadPilot}>Load Star Medical demo</button>
        </div>
        {!ready?<p className={styles.empty}>Loading local records…</p>:visible.length===0?<p className={styles.empty}>No matching actions yet.</p>:<div className={styles.list}>{visible.map(x=><article className={styles.item} key={x.id}>
          <div><span className={styles.category}>{x.regulator}</span><div className={styles.itemTitle}>{x.title}</div><div className={styles.meta}>{x.owner} · Due {x.due}{isOverdue(x,todayLocal())?" · Overdue":""}</div>{x.notes&&<div className={styles.meta}>{x.notes}</div>}</div>
          <div className={styles.actions}><select className={styles.field+" "+styles.status} aria-label={"Status for "+x.title} value={x.status} onChange={e=>update(x.id,e.target.value as Status)}>{["Open","In progress","Complete"].map(v=><option key={v}>{v}</option>)}</select><button className={styles.delete} type="button" onClick={()=>{if(window.confirm("Delete this action?"))setItems(current=>current.filter(v=>v.id!==x.id));}}>Delete</button></div>
        </article>)}</div>}
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Create an action</h2>
        <form className={styles.form} onSubmit={add}>
          <label className={styles.label}>Action title *<input className={styles.field} maxLength={160} required value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Review temperature SOP"/></label>
          <label className={styles.label}>Category / regulator<input className={styles.field} maxLength={80} value={regulator} onChange={e=>setRegulator(e.target.value)} placeholder="e.g. GDP"/></label>
          <label className={styles.label}>Responsible owner *<input className={styles.field} maxLength={80} required value={owner} onChange={e=>setOwner(e.target.value)} placeholder="e.g. Quality lead"/></label>
          <label className={styles.label}>Due date *<input className={styles.field} type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label>
          <label className={styles.label+" "+styles.wide}>Notes<input className={styles.field} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes"/></label>
          <div><button className={styles.button} type="submit">+ Add action</button></div>
        </form>
      </section>
    </div>
    <p className={styles.footer}>RegPilot AI · Demonstration environment · Local browser storage only</p>
  </main>;
}
