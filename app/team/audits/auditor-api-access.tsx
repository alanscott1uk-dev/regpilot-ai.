"use client";
import {useRef,useState} from "react";
import {auditRequest,date} from "./audit-session";
import ui from "../operations/operations.module.css";

type Grant={id:string;version:number;apiExpiresAt:string|null;apiLastUsedAt:string|null};
export function AuditorApiAccess({orgId,roomId,grant,enabled,disabled,onChange}:{
  orgId:string;roomId:string;grant:Grant;enabled:boolean;disabled:boolean;onChange:(grant:Grant)=>void;
}){
  const [key,setKey]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const locked=useRef(false);
  async function change(action:"ISSUE"|"REVOKE"){
    if(locked.current)return;
    locked.current=true;setBusy(true);setKey("");setNotice("");
    try{
      const data=await auditRequest("/api/workspace/audits/"+roomId+"/api-access?organizationId="+orgId,
        {action,grantId:grant.id,version:grant.version});
      onChange({...grant,version:grant.version+1,apiExpiresAt:data.expiresAt??null,apiLastUsedAt:action==="ISSUE"?null:grant.apiLastUsedAt});
      if(action==="ISSUE")setKey(data.token);
      else setNotice("API key revoked.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not update the auditor key.");}
    finally{locked.current=false;setBusy(false);}
  }
  return <details><summary>Audit firm API access</summary>
    <p>Grant this reviewer’s software read-only access to the published package and its available files. A key expires within seven days.</p>
    {grant.apiExpiresAt&&<p>Key expiry {date(grant.apiExpiresAt)}. {grant.apiLastUsedAt?"Last used "+date(grant.apiLastUsedAt)+".":"No recorded use."}</p>}
    <div className={ui.buttons}>{enabled&&<button type="button" disabled={disabled||busy} onClick={()=>void change("ISSUE")}>{grant.apiExpiresAt?"Replace API key":"Issue API key"}</button>}
      {grant.apiExpiresAt&&<button type="button" disabled={disabled||busy} onClick={()=>void change("REVOKE")}>Revoke API key</button>}</div>
    {key&&<div><label>One-time auditor key<input aria-label="One-time auditor key" readOnly value={key} onFocus={e=>e.currentTarget.select()} autoComplete="off" spellCheck={false}/></label>
      <p>Transfer this key through your firm’s secure credential channel.</p><button type="button" onClick={()=>setKey("")}>Hide key</button></div>}
    {notice&&<p role="status">{notice}</p>}
    <a href="/api/v1/auditor/openapi" target="_blank" rel="noreferrer">Auditor API specification</a>
  </details>;
}
