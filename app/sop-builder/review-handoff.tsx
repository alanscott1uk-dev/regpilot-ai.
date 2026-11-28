"use client";
import {useEffect,useRef,useState} from "react";
import {useWorkspaceContext,workspaceHref} from "../../lib/client/workspace-context";

export type ExportedSop={blob:Blob;filename:string};
type Workspace=ReturnType<typeof useWorkspaceContext>;
export function ReviewHandoff({workspace,document,onSending}:{workspace:Workspace;document:ExportedSop;onSending?:(value:boolean)=>void}){
  const [tasks,setTasks]=useState<{id:string;title:string}[]>([]),[task,setTask]=useState("");
  const [notice,setNotice]=useState(""),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(""),[uncertain,setUncertain]=useState(false);
  const locked=useRef(false);
  const {request,capture,organizationId}=workspace;
  const org=workspace.organisations.find(o=>o.id===organizationId),writable=!!org&&["OWNER","ADMIN","EDITOR"].includes(org.role);
  useEffect(()=>{
    if(!writable)return;
    const ac=new AbortController(),current=capture();
    void request("/api/workspace/obligations?"+new URLSearchParams({organizationId}),{signal:ac.signal}).then(body=>{
      if(!ac.signal.aborted&&current())setTasks(body.items);
    }).catch(error=>{if(!ac.signal.aborted&&current())setNotice(error.message);}).finally(()=>{if(!ac.signal.aborted&&current())setLoading(false);});
    return ()=>ac.abort();
  },[organizationId,request,capture,writable]);
  async function transfer(){
    if(!task||locked.current)return;
    locked.current=true;onSending?.(true);setSaving(true);setNotice("");const current=capture();
    let posted=false;
    try{
      const bytes=await document.blob.arrayBuffer();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      if(!current())return;
      const form=new FormData();form.set("organizationId",organizationId);form.set("obligationId",task);form.set("file",document.blob,document.filename);form.set("reuseExactUpload","true");
      posted=true;const response=await request("/api/workspace/evidence",{method:"POST",body:form});
      if(!current())return;
      if(response.evidence?.sha256!==digest||response.evidence?.organizationId!==organizationId||response.evidence?.obligationId!==task)throw Error("The upload receipt could not be matched.");
      setSaved(response.evidence.id);
    }catch(error){if(current()){if(posted)setUncertain(true);setNotice(error instanceof Error?error.message:"The file could not be saved.");}}
    finally{locked.current=false;if(current()){onSending?.(false);setSaving(false);}}
  }
  if(!writable)return <p>To submit the Word draft for independent review, use a workspace editor account in the <a href="/team/evidence">Evidence Vault</a>.</p>;
  return <div><h3>Independent workspace review</h3><p>{org.name}</p>
    {saved?<p role="status">The exact Word draft is in the <a href={workspaceHref("/team/evidence",organizationId,{taskId:task,evidenceId:saved})}>Evidence Vault</a>. After independent review, an administrator can prepare a version in <a href={workspaceHref("/team/people",organizationId)}>People &amp; policies</a>.</p>:
    <><label>Evidence task<select value={task} disabled={loading||saving||uncertain} onChange={e=>setTask(e.target.value)}><option value="">{loading?"Loading tasks…":"Choose a task"}</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      {!loading&&!tasks.length&&<p><a href={workspaceHref("/team/work",organizationId)}>Open the work hub to choose or create a task</a></p>}
      <button type="button" disabled={saving||!task} onClick={()=>void transfer()}>{saving?"Checking vault…":uncertain?"Check and retry the same file":"Send Word draft for review"}</button>
      {uncertain&&<p><a href={workspaceHref("/team/evidence",organizationId,{taskId:task})}>Inspect this task in the vault</a></p>}</>}
    {notice&&<p role="status">{notice}</p>}</div>;
}
