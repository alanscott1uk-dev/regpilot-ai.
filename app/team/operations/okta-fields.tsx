"use client";
import {useEffect,useRef,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import ui from "./operations.module.css";

type Group={id:string;name:string};
type Action="connect"|"directories"|"groups";
export function OktaFields({organizationId,active,saved,group,removed}:{organizationId:string;active:boolean;saved?:string;group?:string;removed?:string}){
  const [connections,setConnections]=useState<string[]>([]),[selected,setSelected]=useState(saved||"");
  const [query,setQuery]=useState(""),[groups,setGroups]=useState<Group[]>([]),[groupId,setGroupId]=useState(group||"");
  const [link,setLink]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  function selectDirectory(id:string){
    if (id!==selected) {setGroups([]);setGroupId("");setQuery("");}
    setSelected(id);
  }
  async function request(action:Action) {
    pending.current?.abort();
    const abort=new AbortController();pending.current=abort;
    setBusy(true);setMessage("");setLink("");
    if (action==="groups") setGroups([]);
    try {
      const token=(await browserAuth().auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Sign in to this workspace again.");
      const params=new URLSearchParams({organizationId});
      if(action==="groups"){params.set("connectionId",selected);params.set("query",query);}
      const connect=action==="connect";
      const url="/api/workspace/connectors/okta"+(connect?"":"?"+params);
      const response=await fetch(url,{method:connect?"POST":"GET",cache:"no-store",signal:abort.signal,
        headers:{authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:connect?JSON.stringify({organizationId}):undefined});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reach Okta.");
      if (abort.signal.aborted) return;
      if (connect) setLink(data.link);
      if (action==="directories") {
        const dirs:string[]=data.connections;
        setConnections(dirs);selectDirectory(dirs.includes(selected)?selected:dirs[0]||"");
        setMessage(dirs.length?"Choose a directory below.":"No authorised directories found. Connect Okta to add one.");
      }
      if (action==="groups") {
        setGroups(data.groups);setMessage(data.groups.length?"Choose a group from the results.":"No matching groups. Try another name or enter the group ID.");
      }
    } catch(error) {if (!abort.signal.aborted) setMessage(error instanceof Error?error.message:"Could not load Okta.");}
    finally {if (!abort.signal.aborted) setBusy(false);}
  }
  return <>
    <div className={ui.full}><div className={ui.buttons}>
      <button type="button" disabled={busy||!active} onClick={()=>void request("connect")}>Connect Okta</button>
      <button type="button" disabled={busy||!active} onClick={()=>void request("directories")}>Load authorised directories</button>
    </div>{link&&<p><a href={link} target="_blank" rel="noreferrer">Open Okta authorisation ↗</a> Return here and load the directories when finished.</p>}
    <p role="status">{busy?"Contacting Nango…":message}</p></div>
    <label>Authorised Okta directory<select name="connectionId" required value={selected} onChange={event=>{pending.current?.abort();setBusy(false);setMessage("");selectDirectory(event.target.value);}}>
      <option value="">Choose a directory</option>{[...new Set([...(selected?[selected]:[]),...connections])].map(id=><option key={id}>{id}</option>)}</select></label>
    <label>Group name<input maxLength={80} disabled={!selected||busy} value={query} onChange={e=>{setQuery(e.target.value);setGroups([]);}}/></label>
    <div className={ui.buttons}><button type="button" disabled={!selected||!active||busy||query.trim().length<2} onClick={()=>void request("groups")}>Find Okta groups</button></div>
    {groups.length>0&&<label>Matching groups<select value={groups.some(g=>g.id===groupId)?groupId:""} onChange={e=>setGroupId(e.target.value)}>
      <option value="">Choose a group</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
    <label>Okta group ID<input name="groupId" required pattern="00g[A-Za-z0-9]{17}" value={groupId} onChange={e=>setGroupId(e.target.value)}/></label>
    <label>User ID to verify removal (optional)<input key={selected} name="removedUserId" pattern="00u[A-Za-z0-9]{17}" defaultValue={selected===saved?removed:""}/></label>
  </>;
}
