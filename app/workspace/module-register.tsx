"use client";
import { useMemo, useState } from "react";
import { createModuleBackup, parseModuleBackup } from "../../lib/module-backup.mjs";
import { fieldsForModule } from "../../lib/module-fields.mjs";
type RecordItem = {id:string;name:string;owner:string;due:string;status:"Open"|"In progress"|"Complete";notes:string};
export default function ModuleRegister({moduleId,moduleName,onCreateAction}:{moduleId:string;moduleName:string;onCreateAction:(item:{title:string;owner:string;due:string;status:string;category:string})=>void}) {
 const [records,setRecords]=useState<RecordItem[]>([]);
 const [name,setName]=useState(""); const [owner,setOwner]=useState(""); const [due,setDue]=useState(""); const [notes,setNotes]=useState("");
 const [query,setQuery]=useState(""); const [editing,setEditing]=useState<string|null>(null);
 const [message,setMessage]=useState("");
 const [backupText,setBackupText]=useState("");
 const [extra,setExtra]=useState<Record<string,string>>({});
 const moduleFields=fieldsForModule(moduleId);
 function exportDemo() {
  try {
   const data=createModuleBackup(moduleId,records);
   const url=URL.createObjectURL(new Blob([data],{type:"application/json"}));
   const link=document.createElement("a");
   link.href=url;link.download="regpilot-"+moduleId+"-demo.json";link.click();
   URL.revokeObjectURL(url);
   setMessage("Demo backup downloaded.");
  } catch { setMessage("Unable to export demo backup."); }
 }
 function restoreDemo() {
  try {
   const restored=parseModuleBackup(backupText,moduleId) as RecordItem[];
   setRecords(restored);setEditing(null);setBackupText("");setMessage("Demo backup restored.");
  } catch { setMessage("Invalid backup; existing records were not changed."); }
 }
 const visible=useMemo(()=>records.filter(r=>[r.name,r.owner,r.notes].join(" ").toLowerCase().includes(query.toLowerCase())),[records,query]);
 function submit(e:React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  if(!name.trim()||!owner.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(due)){setMessage("Enter a title, owner and valid date.");return;}
  if(editing){setRecords(prev=>prev.map(r=>r.id===editing?{...r,name:name.trim(),owner:owner.trim(),due,notes:notes.trim()}:r));setEditing(null);setMessage("Demo record updated.");}
  else {setRecords(prev=>[...prev,{id:crypto.randomUUID(),name:name.trim(),owner:owner.trim(),due,notes:notes.trim(),status:"Open"}]);setMessage("Demo record added.");}
  setName("");setOwner("");setDue("");setNotes("");
 }
 const input:React.CSSProperties={padding:11,border:"1px solid #cbd5e1",borderRadius:10,width:"100%",boxSizing:"border-box"};
 return <section style={{display:"grid",gap:18}}>
  <div><h3 style={{marginBottom:5}}>{moduleName} register</h3><p style={{color:"#64748b",fontSize:13}}>Interactive demonstration only. Entries are held in memory and disappear on refresh. Do not enter real business or personal data.</p></div>
  <form onSubmit={submit} style={{display:"grid",gap:12,padding:16,borderRadius:14,background:"white",border:"1px solid #dbe3ee"}}>
   <strong>{editing?"Edit demo record":"Add demo record"}</strong>
   <label>Title<input style={input} value={name} maxLength={160} required onChange={e=>setName(e.target.value)} placeholder="e.g. Review supplier approval"/></label>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
    <label>Owner<input style={input} value={owner} maxLength={80} required onChange={e=>setOwner(e.target.value)} placeholder="Responsible department"/></label>
    <label>Review date<input style={input} type="date" value={due} required onChange={e=>setDue(e.target.value)}/></label>
   </div>
   {moduleFields.length>0&&<fieldset style={{border:"1px solid #e2e8f0",borderRadius:12,padding:12}}><legend style={{fontWeight:700}}>Module-specific details (demo)</legend><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12}}>
   {moduleFields.map((field:{key:string;label:string;type:string;options?:string[]})=><label key={field.key}>{field.label}{field.type==="select"?<select style={input} value={extra[field.key]??""} onChange={e=>setExtra(prev=>({...prev,[field.key]:e.target.value}))}><option value="">Not specified</option>{field.options?.map((option:string)=><option key={option}>{option}</option>)}</select>:<input style={input} type={field.type} value={extra[field.key]??""} onChange={e=>setExtra(prev=>({...prev,[field.key]:e.target.value}))}/>}</label>)}
  </div><p style={{fontSize:12,color:"#64748b"}}>Additional fields are for interface testing only and are not saved in this demo register.</p></fieldset>}
  <label>Notes<textarea style={input} value={notes} maxLength={500} rows={2} onChange={e=>setNotes(e.target.value)}/></label>
   <div style={{display:"flex",gap:8}}><button type="submit" style={{border:0,background:"#2659df",color:"white",padding:"10px 15px",borderRadius:10,cursor:"pointer"}}>{editing?"Save changes":"Add record"}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setName("");setOwner("");setDue("");setNotes("");}}>Cancel</button>}</div>
   {message&&<p role="status" style={{fontSize:13,color:"#475569"}}>{message}</p>}
  </form>
  <details style={{padding:14,background:"#f1f5f9",borderRadius:12}}><summary style={{cursor:"pointer",fontWeight:700}}>Demo backup and restore</summary>
   <p style={{fontSize:13,color:"#64748b"}}>Export fictional records to JSON, or paste a previous module backup. Restoring replaces the current demo register. Never use this for confidential data.</p>
   <button type="button" onClick={exportDemo}>Download demo backup</button>
   <label style={{display:"block",marginTop:12}}>Paste backup JSON<textarea rows={3} value={backupText} onChange={e=>setBackupText(e.target.value)} style={input}/></label>
   <button type="button" disabled={!backupText.trim()} onClick={restoreDemo}>Restore demo backup</button>
  </details>
  <label>Search register<input style={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search title, owner or notes"/></label>
  {visible.length===0?<div style={{border:"1px dashed #cbd5e1",borderRadius:12,padding:22,color:"#64748b"}}>No demo records yet. Add one above to try this module.</div>:visible.map(r=><article key={r.id} style={{padding:16,background:"white",border:"1px solid #e2e8f0",borderRadius:12}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>{r.name}</strong><p style={{fontSize:13,color:"#64748b",margin:"6px 0"}}>{r.owner} · Review {r.due} · {r.status}</p>{r.notes&&<p style={{fontSize:13}}>{r.notes}</p>}</div><div style={{display:"flex",gap:7,alignItems:"start",flexWrap:"wrap"}}>
    <button type="button" onClick={()=>{setEditing(r.id);setName(r.name);setOwner(r.owner);setDue(r.due);setNotes(r.notes);}} >Edit</button>
    <button type="button" onClick={()=>setRecords(prev=>prev.map(x=>x.id===r.id?{...x,status:x.status==="Complete"?"Open":"Complete"}:x))}>{r.status==="Complete"?"Reopen":"Complete"}</button>
    <button type="button" onClick={()=>{onCreateAction({title:r.name,owner:r.owner,due:r.due,status:"Open",category:moduleName});setMessage("Added to this session's action list.");}}>Create action</button>
   </div></div>
  </article>)}
 </section>;
}
