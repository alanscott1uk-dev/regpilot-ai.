'use client';
import {useEffect,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {retainValidation} from '../../../lib/server/retained-validation';
type Meta=Awaited<ReturnType<typeof retainValidation>>;
export function ValidationArchive({w,id,release}:{w:ReturnType<typeof useWorkspaceContext>;id:string;release:string}){
 const [saved,setSaved]=useState<Meta|null>(null),[file,setFile]=useState<File|null>(null),[busy,lock]=useState(false),[error,tell]=useState('');
 const url='/api/workspace/trials/'+id+'/release-validation/archive?'+new URLSearchParams({organizationId:w.organizationId});
 useEffect(()=>{let active=true;const current=w.capture();void w.request(url).then(r=>{if(active&&current()&&r.revision===release)setSaved(r.archive);}).catch(e=>{if(active&&current())tell(e.message);});return()=>{active=false;};},[url,release,w.request,w.capture]);
 async function act(op:()=>Promise<void>){const current=w.capture();lock(true);tell('');try{await op();}catch(e){if(current())tell(e instanceof Error?e.message:'Archive unavailable.');}finally{if(current())lock(false);}}
 return <section aria-label="Retained release evidence"><h4>Keep the release pack with this workspace</h4>
 {saved?<><p>Retained {saved.retainedAt.slice(0,10)} · {saved.size.toLocaleString()} bytes · <code>{saved.digest}</code></p>
 <button disabled={busy} onClick={()=>{const current=w.capture();void act(async()=>{
  const response=await w.requestResponse(url+'&download=1'),blob=await response.blob();if(!current())return;
  const a=document.createElement('a'),href=URL.createObjectURL(blob);a.href=href;a.download='regpilot-validation-'+release+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 });}}>Download retained validation ZIP</button></>:<form onSubmit={e=>{e.preventDefault();if(!file)return;const current=w.capture();void act(async()=>{
  const result=await w.request(url,{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
  if(current()&&result.revision===release){setSaved(result);setFile(null);}
 });}}><fieldset disabled={busy}><p>Upload the original GitHub ZIP before its download expires. RegPilot checks the exact release and archive hash before keeping a copy.</p>
 <label>Supplier validation ZIP<input required type="file" accept=".zip" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button disabled={!file}>Verify and retain release pack</button></fieldset></form>}
 {error&&<p role="alert">{error}</p>}</section>;
}
