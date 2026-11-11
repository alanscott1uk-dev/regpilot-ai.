"use client";
import {useEffect,useRef,useState} from "react";
import styles from "./recognition.module.css";
type Candidate={id:string;filename:string;sizeBytes:number;eligible:boolean;reviewStatus:string;scanStatus:string};
type Candidates={files:Candidate[];candidateLimitReached:boolean;notice:string};
type Preview={previewHash:string;selectedCount:number;selectedBytes:number;notice:string;plan:{requirements:Array<{text:string;assessment:string}>;files:Array<{id:string;filename:string}>}};
type Props={organizationId:string;trackId:string;request:(path:string,options?:RequestInit)=>Promise<Response>};
const endpoint="/api/workspace/recognition/package";
export default function PackagePanel({organizationId,trackId,request}:Props){
 const [candidates,setCandidates]=useState<Candidates|null>(null),[selected,setSelected]=useState<string[]>([]);
 const [preview,setPreview]=useState<Preview|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(true),[message,setMessage]=useState("");
 const lifetime=useRef(0),locked=useRef(false);
 useEffect(()=>{
  const epoch=++lifetime.current;
  setCandidates(null);setSelected([]);setPreview(null);setAck(false);setBusy(true);
  request(endpoint+"?organizationId="+encodeURIComponent(organizationId)+"&trackId="+encodeURIComponent(trackId))
   .then(response=>response.json()).then(value=>{if(lifetime.current===epoch)setCandidates(value);})
   .catch(error=>{if(lifetime.current===epoch)setMessage(error instanceof Error?error.message:"Evidence list unavailable");})
   .finally(()=>{if(lifetime.current===epoch)setBusy(false);});
  return()=>{lifetime.current++;};
 },[organizationId,trackId,request]);
 function toggle(id:string){
  if(busy)return;setPreview(null);setAck(false);
  setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):ids.length<10?[...ids,id]:ids);
 }
 async function prepare(){
  if(!selected.length||locked.current)return;
  const epoch=lifetime.current;locked.current=true;setBusy(true);setMessage("");setPreview(null);setAck(false);
  try{
   const response=await request(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId,trackId,action:"PREVIEW",evidenceIds:selected})});
   const value=await response.json();if(lifetime.current===epoch)setPreview(value);
  }catch(error){if(lifetime.current===epoch)setMessage(error instanceof Error?error.message:"Preview unavailable");}
  finally{locked.current=false;if(lifetime.current===epoch)setBusy(false);}
 }
 async function download(){
  if(!preview||!ack||locked.current)return;
  const epoch=lifetime.current;locked.current=true;setBusy(true);setMessage("");
  try{
   const response=await request(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({organizationId,trackId,action:"EXPORT",evidenceIds:selected,previewHash:preview.previewHash,confirm:true})});
   const bytes=await response.arrayBuffer(),expected=response.headers.get("X-RegPilot-Archive-SHA256")||"";
   if(!/^[a-f0-9]{64}$/.test(expected)||bytes.byteLength>16*1024*1024)throw Error("Archive verification metadata invalid");
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
   if(digest!==expected)throw Error("Archive integrity check failed; download stopped");
   if(lifetime.current!==epoch)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:"application/zip"})),a=document.createElement("a");
   a.href=url;a.download="regpilot-preparation-"+trackId+".zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage("Selected evidence verified and private preparation pack downloaded. Nothing was submitted or certified.");
   setAck(false);
  }catch(error){if(lifetime.current===epoch){setPreview(null);setAck(false);setMessage(error instanceof Error?error.message:"Export unavailable; prepare a fresh preview");}}
  finally{locked.current=false;if(lifetime.current===epoch)setBusy(false);}
 }
 return <section className={styles.packPanel} aria-label="Assessment preparation pack">
  <h3>Prepare a private assessment pack</h3><p>Select up to ten independently approved files, totalling no more than 15 MB. No file is selected automatically.</p>
  {message&&<p role="status" className={styles.notice}>{message}</p>}
  {busy&&<p role="status">Checking selected evidence…</p>}
  {candidates&&<><fieldset disabled={busy} className={styles.fileList}><legend>Evidence attached to this action</legend>
   {!candidates.files.length&&<p>No files are attached. Add evidence through the private vault and obtain an independent review.</p>}
   {candidates.files.map(file=><label key={file.id} className={styles.fileChoice}>
    <input type="checkbox" checked={selected.includes(file.id)} disabled={!file.eligible||(!selected.includes(file.id)&&selected.length>=10)} onChange={()=>toggle(file.id)}/>
    <span><strong>{file.filename}</strong><small>{Math.ceil(file.sizeBytes/1024)} KB · {file.eligible?"Internal independent approval recorded":file.scanStatus+" / "+file.reviewStatus+" — not eligible"}</small></span>
   </label>)}
  </fieldset>{candidates.candidateLimitReached&&<p>Only the most recent 100 files are shown. This is not a complete evidence inventory.</p>}
  <button type="button" disabled={busy||!selected.length} onClick={()=>void prepare()}>Preview {selected.length} selected file(s)</button></>}
  {preview&&<div className={styles.packPreview}>
   <h3>Review before download</h3><p>{preview.selectedCount} selected files · {(preview.selectedBytes/1024/1024).toFixed(2)} MB. Export will include these files, a README and a manifest of hashes and review versions.</p>
   <p><strong>{preview.plan.requirements.length} preparation requirements remain unassessed.</strong> Internal document approval is not proof of external certification or requirement coverage.</p>
   <label className={styles.fileChoice}><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/><span>I am authorised to download these private files for assessment preparation. I understand this does not submit them to an authority or award recognition.</span></label>
   <button type="button" disabled={busy||!ack} onClick={()=>void download()}>Verify files and download ZIP</button>
  </div>}
 </section>;
}
