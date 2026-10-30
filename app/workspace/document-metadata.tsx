"use client";
import {useEffect,useState} from "react";
import {stagingSupabase} from "../../lib/staging-supabase";
import {assessEvidenceGap} from "../../lib/evidence-gap.mjs";
type DocumentRow={id:string;filename:string;category:string;review_status:string;version:number;expires_on:string|null};
export default function DocumentMetadata({orgId,actionId,canEdit,moduleId}:{orgId:string;actionId:string;canEdit:boolean;moduleId:string}){
 const [items,setItems]=useState<DocumentRow[]>([]),[name,setName]=useState(""),[category,setCategory]=useState("Supplier certificate"),[expiry,setExpiry]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;setItems([]);if(!orgId||!actionId)return;const db=stagingSupabase();
 (async()=>{const {data:links,error:linkError}=await db.from("document_action_links").select("document_id").eq("organization_id",orgId).eq("action_id",actionId);
 if(linkError)throw linkError;
 const ids=(links??[]).map(x=>x.document_id);if(!ids.length)return;
 const {data,error}=await db.from("document_records").select("id,filename,category,review_status,version,expires_on").eq("organization_id",orgId).in("id",ids);
 if(error)throw error;if(active)setItems((data??[]) as DocumentRow[]);
 })().catch(()=>{if(active)setError("Unable to load linked document metadata.");});return()=>{active=false;};},[orgId,actionId]);
 async function add(e:React.FormEvent){e.preventDefault();if(!canEdit||!orgId||!actionId)return;setBusy(true);setError("");
 const db=stagingSupabase();
 const {data:documentId,error:createError}=await db.rpc("create_linked_document_metadata",{p_organization_id:orgId,p_action_id:actionId,p_filename:name.trim(),p_category:category,p_expires_on:expiry||null});
 if(createError){setError(createError.message);}else{
  setItems(p=>[...p,{id:documentId as string,filename:name.trim(),category,review_status:"DRAFT",version:1,expires_on:expiry||null}]);
  setName("");setExpiry("");
 }
 setBusy(false);
 }
 const today=new Date().toISOString().slice(0,10);
 const assessment=assessEvidenceGap({moduleId,documents:items,today});
 return <section style={{display:"grid",gap:10,marginTop:12}}>
 <strong>Linked document register</strong>
 <div style={{padding:12,border:"1px solid #dbe3ee",borderRadius:10,background:"#f8fafc"}}><strong>Evidence checklist · {assessment.overall.replaceAll("_"," ").toLowerCase()}</strong>{assessment.findings.map((x:{category:string;status:string})=><div key={x.category} style={{fontSize:13,marginTop:5}}>{x.category}: {x.status.replaceAll("_"," ").toLowerCase()}</div>)}<p style={{fontSize:12,color:"#64748b",marginBottom:0}}>{assessment.notice}</p></div>
 <p style={{fontSize:13,color:"#64748b",margin:0}}>Metadata only. No file has been uploaded or verified. These entries cannot serve as approved evidence.</p>
 {items.length===0?<p style={{fontSize:13,color:"#64748b"}}>No linked documents registered.</p>:items.map(x=><article key={x.id} style={{padding:10,border:"1px solid #dbe3ee",borderRadius:10}}><strong>{x.filename}</strong><div style={{fontSize:12,color:"#64748b"}}>{x.category} · Version {x.version} · {x.review_status} · Expiry: {x.expires_on??"Not set"}</div></article>)}
 {canEdit&&<form onSubmit={add} style={{display:"grid",gap:8}}>
 <label>Document description<input required maxLength={180} value={name} onChange={e=>setName(e.target.value)} placeholder="Supplier GMP certificate (metadata only)" style={{display:"block",padding:10,width:"100%",boxSizing:"border-box"}}/></label>
 <label>Category<select value={category} onChange={e=>setCategory(e.target.value)} style={{display:"block",padding:10,width:"100%"}}>{["Supplier certificate","Policy / SOP","Licence","Audit report","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)} style={{display:"block",padding:10,width:"100%"}}/></label>
 <button disabled={busy} style={{padding:11,background:"#2659df",color:"white",border:0,borderRadius:9}}>{busy?"Saving…":"Link document metadata"}</button>
 </form>}
 {error&&<p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
 </section>;
}
