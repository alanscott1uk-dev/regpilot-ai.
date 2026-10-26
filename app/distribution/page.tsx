"use client";
import {useEffect,useMemo,useState} from "react";
import styles from "../dashboard.module.css";
import {saveDemoCertificateFile,readDemoCertificateFile,deleteDemoCertificateFile} from "../../lib/demo-certificate-files.mjs";

type Supplier={id:string;name:string;country:string;role:string;status:"Pending"|"Approved"|"Suspended";notes:string};
type Certificate={id:string;supplierId:string;kind:string;reference:string;expires:string;verified:boolean};
type ImportRecord={id:string;supplierId:string;product:string;origin:string;reference:string;status:"Planning"|"Documentation review"|"Awaiting authorisation"|"Received"|"On hold"};
type Data={suppliers:Supplier[];certificates:Certificate[];imports:ImportRecord[]};
const KEY="regpilot-distribution-demo-v1";
const demo:Data={
 suppliers:[
 {id:"supplier-demo-a",name:"Example EU Manufacturer",country:"Germany",role:"Manufacturer",status:"Pending",notes:"Fictional qualification example"},
 {id:"supplier-demo-b",name:"Example Export Partner",country:"Portugal",role:"Exporter",status:"Pending",notes:"Fictional export partner"}
 ],
 certificates:[
 {id:"cert-demo-a",supplierId:"supplier-demo-a",kind:"GMP evidence",reference:"DEMO-GMP-001",expires:"2027-06-30",verified:false}
 ],
 imports:[
 {id:"import-demo-a",supplierId:"supplier-demo-b",product:"Fictional medicinal product",origin:"Portugal",reference:"DEMO-IMP-001",status:"Documentation review"}
 ]
};
const field:React.CSSProperties={width:"100%",boxSizing:"border-box",padding:"10px",border:"1px solid #d5deeb",borderRadius:8,font:"inherit",fontSize:14};
const button:React.CSSProperties={border:0,background:"#3159df",color:"white",borderRadius:9,padding:"11px 14px",fontWeight:700,cursor:"pointer"};
const card:React.CSSProperties={background:"white",border:"1px solid #e1e7f0",borderRadius:13,padding:17};
function validData(value:unknown):value is Data{
 if(!value||typeof value!=="object")return false;
 const v=value as Partial<Data>;
 if(!Array.isArray(v.suppliers)||!Array.isArray(v.certificates)||!Array.isArray(v.imports))return false;
 if(v.suppliers.length>500||v.certificates.length>2000||v.imports.length>2000)return false;
 const ids=new Set<string>();
 for(const s of v.suppliers){if(!s||typeof s.id!=="string"||ids.has(s.id)||typeof s.name!=="string"||typeof s.country!=="string"||typeof s.role!=="string"||typeof s.notes!=="string"||!["Pending","Approved","Suspended"].includes(s.status))return false;ids.add(s.id);}
 for(const c of v.certificates){if(!c||!ids.has(c.supplierId)||typeof c.kind!=="string"||typeof c.reference!=="string"||typeof c.expires!=="string"||typeof c.verified!=="boolean")return false;}
 for(const i of v.imports){if(!i||!ids.has(i.supplierId)||typeof i.product!=="string"||typeof i.origin!=="string"||typeof i.reference!=="string"||!["Planning","Documentation review","Awaiting authorisation","Received","On hold"].includes(i.status))return false;}
 return true;
}
export default function Distribution(){
 const [data,setData]=useState<Data>(demo),[ready,setReady]=useState(false);
 const [tab,setTab]=useState<"suppliers"|"certificates"|"imports">("suppliers");
 const [name,setName]=useState(""),[country,setCountry]=useState(""),[role,setRole]=useState("Manufacturer");
 const [supplierId,setSupplierId]=useState("supplier-demo-a"),[kind,setKind]=useState("GMP evidence"),[reference,setReference]=useState(""),[expires,setExpires]=useState("");
 const [importSupplier,setImportSupplier]=useState("supplier-demo-a"),[product,setProduct]=useState(""),[origin,setOrigin]=useState(""),[importRef,setImportRef]=useState("");
 const [message,setMessage]=useState("");
 const [fileNames,setFileNames]=useState<Record<string,string>>({});
 useEffect(()=>{try{const raw=localStorage.getItem(KEY);if(raw){const parsed:unknown=JSON.parse(raw);if(validData(parsed))setData(parsed)}}catch{}setReady(true)},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify(data))}catch{setMessage("Local storage unavailable. Records may not persist.")}},[data,ready]);
 const selected=useMemo(()=>new Map(data.suppliers.map(x=>[x.id,x.name])),[data.suppliers]);
 const today=new Date().toISOString().slice(0,10);
 function addSupplier(e:React.FormEvent){e.preventDefault();if(!name.trim()||!country.trim())return;setData(d=>({...d,suppliers:[...d.suppliers,{id:crypto.randomUUID(),name:name.trim().slice(0,120),country:country.trim().slice(0,80),role,status:"Pending",notes:"Demonstration record"}]}));setName("");setCountry("");setMessage("Supplier added as pending qualification.")}
 function addCertificate(e:React.FormEvent){e.preventDefault();const sid=data.suppliers.some(s=>s.id===supplierId)?supplierId:data.suppliers[0]?.id;if(!sid||!reference.trim()||!expires)return;setData(d=>({...d,certificates:[...d.certificates,{id:crypto.randomUUID(),supplierId:sid,kind,reference:reference.trim().slice(0,100),expires,verified:false}]}));setReference("");setExpires("");setMessage("Certificate evidence recorded; not verified.")}
 async function uploadCertificate(id:string,file:File|undefined){
  if(!file)return;
  try{const result=await saveDemoCertificateFile(id,file);setFileNames(current=>({...current,[id]:result.name}));setMessage("Demo file saved in this browser only. It is not backed up or verified.");}
  catch(e){setMessage(e instanceof Error?e.message:"Upload failed");}
 }
 async function viewCertificate(id:string){
  try{
   const stored=await readDemoCertificateFile(id);
   if(!stored){setMessage("No local file found for this certificate.");return;}
   const url=URL.createObjectURL(stored.blob);
   const link=document.createElement("a");link.href=url;link.download=stored.name;document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{setMessage("Could not retrieve the local file.");}
 }
 async function removeCertificateFile(id:string){
  if(!window.confirm("Remove the locally stored certificate file?"))return;
  try{await deleteDemoCertificateFile(id);setFileNames(current=>{const next={...current};delete next[id];return next;});setMessage("Local certificate file removed.");}
  catch{setMessage("Unable to remove the file.");}
 }
 function addImport(e:React.FormEvent){e.preventDefault();const sid=data.suppliers.some(s=>s.id===importSupplier)?importSupplier:data.suppliers[0]?.id;if(!sid||!product.trim()||!origin.trim()||!importRef.trim())return;setData(d=>({...d,imports:[...d.imports,{id:crypto.randomUUID(),supplierId:sid,product:product.trim().slice(0,120),origin:origin.trim().slice(0,80),reference:importRef.trim().slice(0,100),status:"Planning"}]}));setProduct("");setOrigin("");setImportRef("");setMessage("Import planning record added; no import authorisation implied.")}
 return <main className={styles.shell}>
  <header className={styles.top}><div className={styles.brand}><span className={styles.mark}>R</span>RegPilot <span style={{color:"#3159df"}}>AI</span></div><span className={styles.pill}>DEMO WORKSPACE</span></header>
  <a href="/" style={{fontSize:13,color:"#3159df"}}>← Compliance dashboard</a>
  <div style={{marginTop:24}}><div className={styles.eyebrow}>Distribution / Supply chain</div><h1 className={styles.heading}>Suppliers, certification & imports</h1><p className={styles.sub}>Manage demonstration qualification and import planning records.</p></div>
  <div className={styles.notice}><strong>Prototype only.</strong> Browser-local records and demo file attachments only; files are not encrypted, synced, backed up or reviewed by regulators. No real import approvals. Do not enter confidential supplier details, actual shipment records or personal information. Verification and regulatory authorisation must happen outside this demo.</div>
  <section className={styles.stats}>{[["Suppliers",data.suppliers.length],["Certificate records",data.certificates.length],["Imports planned",data.imports.length],["Expired certificates",data.certificates.filter(x=>x.expires<today).length]].map(([label,count])=><div className={styles.stat} key={label}><div className={styles.statLabel}>{label}</div><div className={styles.statNumber}>{count}</div></div>)}</section>
  <div className={styles.toolbar}>{(["suppliers","certificates","imports"] as const).map(x=><button type="button" key={x} className={styles.button+(tab===x?"":" "+styles.outline)} onClick={()=>setTab(x)} style={{textTransform:"capitalize"}}>{x}</button>)}</div>
  {message&&<p role="status" className={styles.meta}>{message}</p>}
  {tab==="suppliers"&&<section className={styles.panel}><h2 className={styles.panelTitle}>Supplier qualification</h2><div className={styles.list}>{data.suppliers.map(x=><article className={styles.item} key={x.id}><div><span className={styles.category}>{x.role} · {x.country}</span><div className={styles.itemTitle}>{x.name}</div><div className={styles.meta}>{x.notes}</div></div><div className={styles.actions}><select aria-label={"Qualification status for "+x.name} className={styles.field+" "+styles.status} value={x.status} onChange={e=>setData(d=>({...d,suppliers:d.suppliers.map(s=>s.id===x.id?{...s,status:e.target.value as Supplier["status"]}:s)}))}>{["Pending","Approved","Suspended"].map(v=><option key={v}>{v}</option>)}</select></div></article>)}</div><h3>Add supplier</h3><form className={styles.form} onSubmit={addSupplier}><label className={styles.label}>Supplier name *<input className={styles.field} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label className={styles.label}>Country *<input className={styles.field} required maxLength={80} value={country} onChange={e=>setCountry(e.target.value)}/></label><label className={styles.label}>Role<select className={styles.field} value={role} onChange={e=>setRole(e.target.value)}>{["Manufacturer","Exporter","Wholesaler","Laboratory","Other"].map(v=><option key={v}>{v}</option>)}</select></label><div style={{alignSelf:"end"}}><button style={button}>Add supplier</button></div></form></section>}
  {tab==="certificates"&&<section className={styles.panel}><h2 className={styles.panelTitle}>Certification evidence</h2><div className={styles.list}>{data.certificates.map(x=><article className={styles.item} key={x.id}><div><span className={styles.category}>{x.kind}</span><div className={styles.itemTitle}>{selected.get(x.supplierId)}</div><div className={styles.meta}>Ref: {x.reference} · Expiry: {x.expires} · {x.expires<today?"Expired":x.verified?"Marked verified":"Unverified"}</div><div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:10,alignItems:"center"}}><label className={styles.label}>Attach demo certificate (PDF, PNG, JPG; max 2 MB)<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>{void uploadCertificate(x.id,e.target.files?.[0]);e.target.value="";}}/></label><button type="button" className={styles.button+" "+styles.outline} onClick={()=>void viewCertificate(x.id)}>Download file</button><button type="button" className={styles.button+" "+styles.outline} onClick={()=>void removeCertificateFile(x.id)}>Remove file</button>{fileNames[x.id]&&<span className={styles.meta}>{fileNames[x.id]}</span>}</div></div><label className={styles.label}><input type="checkbox" checked={x.verified} onChange={e=>setData(d=>({...d,certificates:d.certificates.map(c=>c.id===x.id?{...c,verified:e.target.checked}:c)}))}/> Demo verification flag</label></article>)}</div><h3>Add certification record</h3><form className={styles.form} onSubmit={addCertificate}><label className={styles.label}>Supplier<select className={styles.field} value={data.suppliers.some(s=>s.id===supplierId)?supplierId:data.suppliers[0]?.id||""} onChange={e=>setSupplierId(e.target.value)}>{data.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className={styles.label}>Certificate type<select className={styles.field} value={kind} onChange={e=>setKind(e.target.value)}>{["GMP evidence","GDP evidence","Manufacturing authorisation","Wholesale authorisation","CoA","Other"].map(v=><option key={v}>{v}</option>)}</select></label><label className={styles.label}>Reference *<input className={styles.field} required maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className={styles.label}>Expiry date *<input className={styles.field} required type="date" value={expires} onChange={e=>setExpires(e.target.value)}/></label><div><button style={button}>Add certificate</button></div></form></section>}
  {tab==="imports"&&<section className={styles.panel}><h2 className={styles.panelTitle}>Import planning</h2><div className={styles.list}>{data.imports.map(x=><article className={styles.item} key={x.id}><div><span className={styles.category}>{x.origin} · {x.reference}</span><div className={styles.itemTitle}>{x.product}</div><div className={styles.meta}>Supplier: {selected.get(x.supplierId)} · Status: {x.status}</div></div><select className={styles.field+" "+styles.status} aria-label={"Import status for "+x.reference} value={x.status} onChange={e=>setData(d=>({...d,imports:d.imports.map(v=>v.id===x.id?{...v,status:e.target.value as ImportRecord["status"]}:v)}))}>{["Planning","Documentation review","Awaiting authorisation","Received","On hold"].map(v=><option key={v}>{v}</option>)}</select></article>)}</div><h3>Add import planning record</h3><form className={styles.form} onSubmit={addImport}><label className={styles.label}>Supplier<select className={styles.field} value={data.suppliers.some(s=>s.id===importSupplier)?importSupplier:data.suppliers[0]?.id||""} onChange={e=>setImportSupplier(e.target.value)}>{data.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className={styles.label}>Product *<input className={styles.field} required maxLength={120} value={product} onChange={e=>setProduct(e.target.value)}/></label><label className={styles.label}>Country of origin *<input className={styles.field} required maxLength={80} value={origin} onChange={e=>setOrigin(e.target.value)}/></label><label className={styles.label}>Reference *<input className={styles.field} required maxLength={100} value={importRef} onChange={e=>setImportRef(e.target.value)}/></label><div><button style={button}>Add import plan</button></div></form></section>}
  <p className={styles.footer}>Fictional records only · No external licensing, supplier verification or customs integration</p>
 </main>;
}
