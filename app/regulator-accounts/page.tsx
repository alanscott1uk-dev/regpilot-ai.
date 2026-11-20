"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import WorkspaceNav from "../components/workspace-nav";
import {OfficialLink} from "../components/regulator-account-links";
import {servicesForNation} from "../../lib/regulator-services";
import {useWorkspaceContext,workspaceHref} from "../../lib/client/workspace-context";
import type {workspaceRegulatorAccounts} from "../../lib/server/workspace-account-shortcuts";
import shell from "../workbench/workbench.module.css";
import ui from "../sop-builder/sop.module.css";

export default function RegulatorAccounts() {
  const workspace=useWorkspaceContext();
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
    <Directory key={workspace.revision} workspace={workspace}/>
  </main></div>;
}

type Shortcuts=Awaited<ReturnType<typeof workspaceRegulatorAccounts>>;
function Directory({workspace}:{workspace:ReturnType<typeof useWorkspaceContext>}) {
  const [nation,setNation]=useState("");
  const [shortcuts,setShortcuts]=useState<Shortcuts|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const writing=useRef(false);
  const {organizationId,request,capture}=workspace;
  const services=servicesForNation(nation);
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!organizationId)return;
    const current=capture();setError("");
    try {
      const value:Shortcuts=await request("/api/workspace/regulator-accounts?"+new URLSearchParams({organizationId}),{signal});
      if(value.organizationId!==organizationId)throw Error("The response belongs to a different workspace.");
      if(current()&&!signal?.aborted)setShortcuts(value);
    } catch(e) {if(current()&&!signal?.aborted)setError(e instanceof Error?e.message:"Could not load workspace shortcuts.");}
  },[organizationId,request,capture]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();},[load]);
  async function pin(serviceId:string,pinned:boolean) {
    if(!shortcuts?.canManage||writing.current)return;
    const current=capture();writing.current=true;setBusy(true);setError("");
    try {
      const value:Shortcuts=await request("/api/workspace/regulator-accounts",{method:"POST",
        headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,serviceId,pinned})});
      if(value.organizationId!==organizationId)throw Error("The response belongs to a different workspace.");
      if(current())setShortcuts(value);
    } catch(e) {if(current())setError(e instanceof Error?e.message:"Could not save the shortcut.");}
    finally {writing.current=false;if(current())setBusy(false);}
  }
  const pinned=services.filter(s=>shortcuts?.serviceIds.includes(s.id));
  return <div className={ui.body}>
    <header className={ui.intro}><div><h1>Regulator accounts</h1>
      <p>Sign in on the regulator’s website using the account authorised for your organisation. Official services open in a new tab.</p></div></header>
    <div className={ui.grid}>{workspace.organisations.length>0&&<label>Organisation<select aria-label="Organisation" value={organizationId} onChange={e=>workspace.chooseOrganization(e.target.value)}>
      {!organizationId&&<option value="">Choose an organisation</option>}{workspace.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
    </select></label>}
    <label>Where is the site?<select aria-label="Where is the site?" value={nation} onChange={e=>setNation(e.target.value)}>
      <option value="">All UK nations</option>{["England","Scotland","Wales","Northern Ireland"].map(n=><option key={n}>{n}</option>)}
    </select></label></div>
    {error&&<div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={()=>void load()}>Reload workspace shortcuts</button></div>}
    {shortcuts&&<section className={ui.card} aria-labelledby="pinned-accounts"><h2 id="pinned-accounts">Workspace shortcuts</h2>
      {pinned.length?<ul>{pinned.map(s=><li key={s.id}><OfficialLink href={s.href}>{s.action}</OfficialLink> · {s.territory}</li>)}</ul>:
        <p>{shortcuts.serviceIds.length?"No saved shortcuts cover the selected nation.":shortcuts.canManage?"Choose the services your organisation uses below.":"Your organisation has no saved regulator shortcuts."}</p>}
    </section>}
    {(["account","forms"] as const).map(kind=><section key={kind} aria-labelledby={"services-"+kind} className={ui.card}>
      <h2 id={"services-"+kind}>{kind==="account"?"Account sign-ins":"Application forms and guidance"}</h2>
      <div className={ui.grid}>{services.filter(s=>s.kind===kind).map(s=><article key={s.id}>
        <h3>{s.title}</h3><small>{s.authority} · {s.territory}</small><p>{s.description}</p>
        <p><OfficialLink href={s.href}>{s.action}</OfficialLink></p>
        {s.guidance&&<small><OfficialLink href={s.guidance}>Access help for {s.title.toLowerCase()}</OfficialLink></small>}
        {kind==="account"&&shortcuts?.canManage&&<p><button type="button" disabled={busy}
          aria-label={(shortcuts.serviceIds.includes(s.id)?"Remove ":"Save ")+s.title+" shortcut"}
          onClick={()=>void pin(s.id,!shortcuts.serviceIds.includes(s.id))}>
          {shortcuts.serviceIds.includes(s.id)?"Remove workspace shortcut":"Save workspace shortcut"}</button></p>}
      </article>)}</div>
    </section>)}
    <p><a href={workspaceHref("/team/accounting",organizationId)}>Manage your organisation’s accounting software</a></p>
  </div>;
}
