"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import WorkspaceNav from "../../components/workspace-nav";
import EmailSignIn from "../../components/email-sign-in";
import {OfficialLink} from "../../components/regulator-account-links";
import {useWorkspaceContext} from "../../../lib/client/workspace-context";
import {accountingIds,accountingSoftware,businessRefLabel,type AccountingId} from "../../../lib/accounting-software";
import type {accountingWorkspace,accountingAction} from "../../../lib/server/accounting-service";
import shell from "../../workbench/workbench.module.css";
import ui from "../../sop-builder/sop.module.css";

type Workspace=ReturnType<typeof useWorkspaceContext>;
type State=Awaited<ReturnType<typeof accountingWorkspace>>;
type Result=Awaited<ReturnType<typeof accountingAction>>;
type Call=(input:Record<string,unknown>)=>Promise<Result|null>;

export default function Accounting() {
  const workspace=useWorkspaceContext();
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}><div className={ui.body}>
    <header className={ui.intro}><div><h1>Accounting software</h1>
      <p>Add the accounting packages your organisation uses. Open the provider account or authorise RegPilot to check the connected business.</p></div></header>
     {workspace.organizationId&&<p><a href={'/team/services/costs?'+new URLSearchParams({organizationId:workspace.organizationId})}>Workspace costs and allowances</a></p>}
    {workspace.organisations.length>0&&<label>Organisation<select aria-label="Organisation" value={workspace.organizationId} onChange={e=>workspace.chooseOrganization(e.target.value)}>
      {!workspace.organizationId&&<option value="">Choose an organisation</option>}{workspace.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
    </select></label>}
    {workspace.organizationId?<Packages key={workspace.revision} workspace={workspace}/>:workspace.loading?<p role="status">Loading workspace…</p>:
      workspace.signedIn?<p>Choose an organisation to view its accounting software.</p>:<section className={ui.card}><h2>Open your workspace</h2><EmailSignIn destination="/team/accounting"/></section>}
  </div></main></div>;
}

function Packages({workspace}:{workspace:Workspace}) {
  const {request,capture,organizationId}=workspace;
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [choice,setChoice]=useState<AccountingId|"">("");
  const pending=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const current=capture();setError("");
    try{
      const data:State=await request("/api/workspace/accounting-software?"+new URLSearchParams({organizationId}),{signal});
      if(data.organizationId!==organizationId)throw Error("Workspace changed. Reload accounting software.");
      if(current()&&!signal?.aborted)setState(data);
    }catch(e){if(current()&&!signal?.aborted)setError(e instanceof Error?e.message:"Could not load accounting software.");}
  },[capture,request,organizationId]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();},[load]);
  const call:Call=async input=>{
    if(pending.current)return null;
    const current=capture();pending.current=true;setBusy(true);setError("");
    try{
      const result:Result=await request("/api/workspace/accounting-software",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({organizationId,...input})});
      if(!current())return null;
      if((result.type==="workspace"?result.workspace.organizationId:result.organizationId)!==organizationId)throw Error("The response belongs to a different workspace.");
      if(result.type==="workspace"){setState(result.workspace);setChoice("");}
      return result;
    }catch(e){if(current())setError(e instanceof Error?e.message:"The request could not be completed.");return null;}
    finally{pending.current=false;if(current())setBusy(false);}
  };
  const remaining=accountingIds.filter(id=>!state?.serviceIds.includes(id));
  return <>{error&&<div role="alert"><p>{error}</p>{!state&&<button onClick={()=>void load()}>Reload accounting software</button>}</div>}
    {state?<>{state.canManage&&remaining.length>0&&<form className={ui.card} onSubmit={e=>{e.preventDefault();if(choice)void call({action:"ADD",provider:choice});}}>
      <h2>Add accounting software</h2><div className={ui.actions}><label>Accounting package<select aria-label="Accounting package" required disabled={busy} value={choice} onChange={e=>setChoice(e.target.value as AccountingId|"")}>
        <option value="">Choose a package</option>{remaining.map(id=><option key={id} value={id}>{accountingSoftware[id].name}</option>)}
      </select></label><button type="submit" disabled={busy||!choice}>Add to workspace</button></div></form>}
      {!state.serviceIds.length&&<p>Your workspace has no accounting software added.</p>}
      {accountingIds.filter(id=>state.serviceIds.includes(id)).map(id=><Package key={id} id={id} canManage={state.canManage}
        configured={state.available.includes(id)} call={call} busy={busy}/>)}</>:!error&&<p role="status">Loading accounting software…</p>}
  </>;
}

function Package({id,canManage,configured,call,busy}:{id:AccountingId;canManage:boolean;configured:boolean;call:Call;busy:boolean}) {
  const software=accountingSoftware[id];
  const [consent,setConsent]=useState<Extract<Result,{type:"consent"}>|null>(null);
  const [grants,setGrants]=useState<Extract<Result,{type:"grants"}>|null>(null);
  const [receipt,setReceipt]=useState<Extract<Result,{type:"business"}>|null>(null);
  const [disconnect,setDisconnect]=useState("");
  const inspect=async(action:"CHECK"|"AUTHORISE"|"DISCONNECT"|"VERIFY",fields:Record<string,unknown>={})=>{
    setConsent(null);setReceipt(null);setDisconnect("");
    if(action!=="VERIFY")setGrants(null);
    const result=await call({action,provider:id,...fields});
    if(result?.type==="consent")setConsent(result);
    if(result?.type==="grants")setGrants(result);
    if(result?.type==="business")setReceipt(result);
  };
  return <section className={ui.card} aria-label={software.name}><h2>{software.name}</h2>
    <div className={ui.actions}><OfficialLink href={software.login}>Open {software.name}</OfficialLink>
      <OfficialLink href={software.help}>{software.name} sign-in help</OfficialLink></div>
    {canManage&&<><h3>Provider authorisation</h3>{configured?<div className={ui.actions}>
      <button disabled={busy} onClick={()=>void inspect("AUTHORISE")}>Start authorisation</button>
      <button disabled={busy} onClick={()=>void inspect("CHECK")}>Check connections</button></div>:<p>Provider authorisation awaits configuration. The account link is available.</p>}
      {consent&&<p><OfficialLink href={consent.link}>Continue to {software.name} authorisation</OfficialLink> · expires {new Date(consent.expiresAt).toLocaleTimeString("en-GB")}. After returning, choose Check connections.</p>}
      {grants&&<div aria-live="polite"><p>Checked {new Date(grants.checkedAt).toLocaleString("en-GB")} · {grants.grants.length} {grants.grants.length===1?"connection":"connections"}.</p>
        {grants.grants.map(g=><article key={g.id}><h3>Connection {g.id}</h3><p>{g.state==="authorised"?"Authorisation recorded":"Authorisation needs attention"}</p>
          {g.state==="authorised"&&<form onSubmit={e=>{e.preventDefault();const reference=new FormData(e.currentTarget).get("reference");void inspect("VERIFY",{connectionId:g.id,reference});}}>
            <div className={ui.actions}><label>{businessRefLabel[id]}<input name="reference" required maxLength={100} autoComplete="off"/></label><button disabled={busy}>Check business identity</button></div>
          </form>}
          {receipt?.connectionId===g.id?<p role="status"><strong>{receipt.name}</strong> · {receipt.reference} · checked {new Date(receipt.checkedAt).toLocaleString("en-GB")}</p>:
            g.lastCheck&&<p>Last business check · <strong>{g.lastCheck.name}</strong> · {g.lastCheck.reference} · {new Date(g.lastCheck.checkedAt).toLocaleString("en-GB")}</p>}
          {disconnect===g.id?<p>Disconnect this authorisation from RegPilot? <button disabled={busy} onClick={()=>void inspect("DISCONNECT",{connectionId:g.id,confirm:true})}>Confirm disconnect</button> <button onClick={()=>setDisconnect("")}>Cancel</button></p>:
            <p><button disabled={busy} onClick={()=>setDisconnect(g.id)}>Disconnect authorisation</button></p>}
        </article>)}</div>}
      <details><summary>Remove {software.name} from this workspace</summary>
        <p>To revoke a RegPilot connection, disconnect it before removing the package from the workspace list.</p>
        <button disabled={busy} onClick={()=>void call({action:"REMOVE",provider:id})}>Remove package</button></details>
    </>}
  </section>;
}
