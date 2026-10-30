"use client";
import {useState} from "react";
import {stagingSupabase} from "../../lib/staging-supabase";
import {validateEvidenceCandidate} from "../../lib/evidence-preflight.mjs";
export default function QuarantineUpload({orgId,documentId}:{orgId:string;documentId:string}){
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function submit(e:React.FormEvent){e.preventDefault();if(!file||busy)return;
  const validation=validateEvidenceCandidate({name:file.name,size:file.size,type:file.type});
  if(!validation.ok){setMessage(validation.errors.join(". "));return;}
  setBusy(true);setMessage("");
  try{
   const db=stagingSupabase();
   const {data:{user},error:authError}=await db.auth.getUser();
   if(authError||!user)throw new Error("Please sign in again.");
   const id=crypto.randomUUID();
   const objectPath=orgId+"/"+documentId+"/"+id;
   const {error:intakeError}=await db.from("evidence_upload_intake").insert({
    id,organization_id:orgId,document_id:documentId,object_path:objectPath,
    filename:file.name,mime_type:file.type,size_bytes:file.size,created_by:user.id
   });
   if(intakeError)throw intakeError;
   const {error:uploadError}=await db.storage.from("eagnexis-quarantine").upload(objectPath,file,{contentType:file.type,upsert:false});
   if(uploadError)throw new Error("Quarantine upload failed. Intake remains pending; do not retry repeatedly. "+uploadError.message);
   setMessage("File received in isolated quarantine. It is NOT scanned, approved or available as evidence.");
   setFile(null);
  }catch(error){setMessage(error instanceof Error?error.message:"Unable to upload test file.");}
  finally{setBusy(false);}
 }
 return <form onSubmit={e=>void submit(e)} style={{display:"grid",gap:8,padding:12,border:"1px dashed #94a3b8",borderRadius:10}}>
 <strong>Upload a test file to quarantine</strong>
 <p style={{fontSize:12,color:"#64748b",margin:0}}>Staging only. Use fictional documents, never personal, confidential or regulated information. Files cannot be downloaded or approved yet.</p>
 <label style={{fontSize:13}}>Choose a PDF, PNG or JPEG (up to 10 MB)<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)} style={{display:"block",marginTop:8,maxWidth:"100%"}}/></label>
 <button type="submit" disabled={!file||busy} style={{padding:11,border:0,borderRadius:9,background:"#2659df",color:"white",opacity:(!file||busy)?0.6:1}}>{busy?"Uploading…":"Upload test file"}</button>
 {message&&<p role="status" style={{fontSize:13,margin:0}}>{message}</p>}
 </form>;
}
