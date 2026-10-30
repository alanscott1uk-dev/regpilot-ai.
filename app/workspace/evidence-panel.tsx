"use client";
import { useMemo, useState } from "react";
type EvidenceItem = {id:string;name:string;category:string;status:"DRAFT"|"PENDING_REVIEW"|"APPROVED"|"REJECTED";expiresOn:string;linkedActions:string[]};
const sample:EvidenceItem[]=[
 {id:"demo-e1",name:"Example insurance certificate.pdf",category:"Insurance",status:"PENDING_REVIEW",expiresOn:"2026-12-15",linkedActions:["a1"]},
 {id:"demo-e2",name:"Example supplier qualification.pdf",category:"Suppliers",status:"APPROVED",expiresOn:"2027-03-01",linkedActions:["a2"]}
];
const badge=(s:string)=>s.toLowerCase().replaceAll("_"," ");
export default function EvidencePanel({actionId}:{actionId?:string}) {
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("All");
 const [showOnlyPending,setShowOnlyPending]=useState(false);
 const items=useMemo(()=>sample.filter(x=>(!actionId||x.linkedActions.includes(actionId))&&(category==="All"||x.category===category)&&(!showOnlyPending||x.status==="PENDING_REVIEW")&&x.name.toLowerCase().includes(query.toLowerCase())),[actionId,query,category,showOnlyPending]);
 return <section aria-label="Document evidence" style={{display:"grid",gap:12}}>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   <input aria-label="Search documents" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search documents" style={{padding:10,border:"1px solid #cbd5e1",borderRadius:10,flex:"1 1 150px",minWidth:0}}/>
   <select aria-label="Document category" value={category} onChange={e=>setCategory(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:10}}><option>All</option><option>Insurance</option><option>Suppliers</option></select>
  </div>
  <label style={{fontSize:13,color:"#475569"}}><input type="checkbox" checked={showOnlyPending} onChange={e=>setShowOnlyPending(e.target.checked)}/> Pending reviews only</label>
  {items.length===0?<p style={{color:"#64748b"}}>No matching documents in this preview.</p>:items.map(x=><article key={x.id} style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{x.name}</strong><span style={{fontSize:12,fontWeight:700,color:x.status==="APPROVED"?"#047857":"#92400e"}}>{badge(x.status)}</span></div>
   <div style={{fontSize:12,color:"#64748b",marginTop:6}}>{x.category} · Expires {x.expiresOn} · {x.linkedActions.length} linked action(s)</div>
  </article>)}
  <div style={{padding:12,border:"1px dashed #a9b8d0",borderRadius:12,fontSize:13,color:"#64748b"}}>Demo documents only. Secure uploads, downloads and approvals will be enabled after authentication, private storage and audit testing.</div>
 </section>;
}
