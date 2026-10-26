"use client";
import {useEffect,useState} from "react";
import {parseDemoBackup} from "../../lib/demo-backup.mjs";
type Item={id:string;title:string;owner:string;due:string;done:boolean};
const KEY="regpilot-checklist-v1";
export default function Prototype(){
 const [items,setItems]=useState<Item[]>([]),[ready,setReady]=useState(false);
 const [title,setTitle]=useState(""),[owner,setOwner]=useState(""),[due,setDue]=useState("");
 const [feedback,setFeedback]=useState("");
 useEffect(()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||"[]");if(Array.isArray(x))setItems(x.filter(v=>v&&typeof v.id==="string"&&typeof v.title==="string"&&typeof v.owner==="string"&&typeof v.due==="string"&&typeof v.done==="boolean"));}catch{}setReady(true)},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify(items))}catch{}},[items,ready]);
 function add(e:React.FormEvent){e.preventDefault();if(!title.trim()||!owner.trim()||!due)return;setItems(s=>[{id:crypto.randomUUID(),title:title.trim().slice(0,160),owner:owner.trim().slice(0,80),due,done:false},...s]);setTitle("");setOwner("");setDue("")}
 async function importData(file:File|undefined){
  if(!file)return;
  if(file.size>2000000){setFeedback("Backup exceeds 2 MB limit.");return;}
  try {const restored=parseDemoBackup(await file.text());if(!window.confirm("Replace all current demo actions with "+restored.length+" imported actions?"))return;setItems(restored);setFeedback("Backup restored: "+restored.length+" actions.");}
  catch(e){setFeedback(e instanceof Error?e.message:"Import failed");}
 }
 function exportData(){const url=URL.createObjectURL(new Blob([JSON.stringify(items,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="regpilot-demo-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const overdue=items.filter(x=>!x.done&&x.due<new Date().toLocaleDateString("en-CA")).length;
 return <main style={{maxWidth:850,margin:"auto",padding:30,fontFamily:"Arial,sans-serif"}}>
 <p style={{color:"#2457d6",fontWeight:700}}>REGPILOT AI / LOCAL PROTOTYPE</p><h1>Compliance action tracker</h1>
 <p style={{background:"#fff4dc",padding:14,borderRadius:8}}>Demo only. No login, server storage, or regulatory verification. Do not enter real confidential or patient data.</p>
 <p><strong>{items.length}</strong> actions · <strong>{items.filter(x=>x.done).length}</strong> complete · <strong>{overdue}</strong> overdue</p>
 <form onSubmit={add} style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:25}}>
 <input aria-label="Action" required maxLength={160} placeholder="Compliance action" value={title} onChange={e=>setTitle(e.target.value)}/>
 <input aria-label="Owner" required maxLength={80} placeholder="Owner" value={owner} onChange={e=>setOwner(e.target.value)}/>
 <input aria-label="Due date" required type="date" value={due} onChange={e=>setDue(e.target.value)}/>
 <button>Add action</button></form>
 <button type="button" onClick={exportData}>Export JSON backup</button>
 <label style={{display:"inline-block",marginLeft:12}}>Restore backup <input type="file" accept=".json,application/json" aria-label="Restore JSON backup" onChange={e=>{void importData(e.target.files?.[0]);e.target.value="";}}/></label>
 {feedback&&<p role="status">{feedback}</p>}
 {!ready?<p>Loading…</p>:items.length===0?<p>No actions yet. Add your first example above.</p>:
 <ul style={{padding:0,listStyle:"none"}}>{items.map(x=><li key={x.id} style={{padding:15,borderBottom:"1px solid #ddd",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
 <input type="checkbox" aria-label={"Complete "+x.title} checked={x.done} onChange={e=>setItems(s=>s.map(v=>v.id===x.id?{...v,done:e.target.checked}:v))}/>
 <span style={{flex:1,minWidth:200}}><strong style={{textDecoration:x.done?"line-through":"none"}}>{x.title}</strong><small style={{display:"block"}}>{x.owner} · Due {x.due}</small></span>
 <button onClick={()=>{if(confirm("Delete action?"))setItems(s=>s.filter(v=>v.id!==x.id))}}>Delete</button></li>)}</ul>}
 </main>;
}
