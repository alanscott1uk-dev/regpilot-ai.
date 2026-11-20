"use client";
import {useEffect, useRef, useState, type FormEvent} from "react";
import WorkspaceNav from "../../components/workspace-nav";
import EmailSignIn from "../../components/email-sign-in";
import {useWorkspaceContext} from "../../../lib/client/workspace-context";
import {accessLevels, dataClasses, impactAreas, systemKinds} from "../../../lib/ai-inventory";
import type {inventoryWorkspace} from "../../../lib/server/ai-inventory-service";
import shell from "../../workbench/workbench.module.css";
import ui from "../questionnaires/questionnaires.module.css";
import styles from "./inventory.module.css";

type Workspace = ReturnType<typeof useWorkspaceContext>;
type Inventory = Awaited<ReturnType<typeof inventoryWorkspace>>;
type Item = Inventory["systems"][number];
type Preview = {serial:string;version:number;inspected:number;candidates:{reference:string;name:string;componentVersion:string|null;state:string}[]};
type Send = (payload:Record<string, unknown>) => Promise<void>;
const names: Record<string,string> = {
  TOOL:"AI tool",MODEL:"Model", AGENT:"Agent",MCP_SERVER:"MCP server",PUBLIC:"Public",INTERNAL:"Internal",PERSONAL:"Personal",
  SENSITIVE:"Sensitive",READ:"Read only",DRAFT:"Draft for human approval",WRITE:"Write to connected systems",AUTONOMOUS:"Act without human approval",
  CUSTOMERS:"Customer-facing",EMPLOYMENT:"Employment decisions",HEALTH:"Health decisions",FINANCIAL_DECISIONS:"Financial decisions",
  APPROVED:"Approved",RESTRICTED:"Restricted",DECLINED:"Declined",
};
const explain = (e:unknown) => e instanceof Error ? e.message : "The inventory could not be updated.";
const options = (values:readonly string[]) => values.map(v=><option key={v} value={v}>{names[v]}</option>);
function selectedFromUrl() {
  if (typeof window === "undefined") return "";
  const p = new URLSearchParams(window.location.search);
  return p.get("systemId") || "";
}

export default function InventoryPage() {
  const workspace = useWorkspaceContext();
  return <div className={shell.app}><WorkspaceNav/><main className={shell.main}>
    <header className={ui.hero}><div><h1>AI inventory</h1><p>See which tools, models and agents your company uses, who owns them and which uses have been reviewed.</p></div></header>
    {workspace.error && <p role="alert" className={ui.error}>{workspace.error}</p>}
    {workspace.loading ? <p role="status">Opening workspace…</p> : !workspace.signedIn ? <section className={ui.panel}><h2>Sign in to view your AI inventory</h2><EmailSignIn destination="/team/ai-inventory"/></section> :
      <><label className={ui.field}>Company<select value={workspace.organizationId} onChange={e=>workspace.chooseOrganization(e.target.value)}><option disabled value="">Choose a company</option>{workspace.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      {workspace.organizationId && <Register key={workspace.revision} workspace={workspace}/>}</>}
  </main></div>;
}

function Register({workspace}: {workspace:Workspace}) {
  const {organizationId,request,capture} = workspace;
  const endpoint = "/api/workspace/ai-inventory?organizationId=" + encodeURIComponent(organizationId);
  const [data,setData] = useState<Inventory|null>(null), [error,setError] = useState(""), [notice,setNotice] = useState(""), [busy,setBusy] = useState(false);
  const [mode,setMode] = useState<"list"|"create"|"edit"|"import">("list"), [selected,setSelected] = useState(selectedFromUrl);
  const [search,setSearch] = useState(""), [filter,setFilter] = useState("All"), [refresh,setRefresh] = useState(0);
  const lock = useRef(false);
  useEffect(()=>{
    const controller = new AbortController(), valid = capture();
    request(endpoint,{signal:controller.signal}).then(value=>{
      if (valid() && !controller.signal.aborted && value.organizationId === organizationId) setData(value);
    }).catch(e=>{if (valid() && !controller.signal.aborted) setError(explain(e));});
    return ()=>controller.abort();
  },[endpoint,request,capture,organizationId,refresh]);
  function open(id:string) {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("systemId",id); else u.searchParams.delete("systemId");
    window.history.replaceState(window.history.state,"",u.pathname+u.search);
    setSelected(id);setMode("list");setError("");setNotice("");
  }
  async function write(payload:Record<string,unknown>) {
    if (lock.current) return;
    lock.current = true;setBusy(true);setError("");setNotice("");
    const valid = capture();
    try {
      const result = await request(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      if (!valid()) return;
      if (payload.action === "CREATE") open(result.id);
      setMode("list");
      setNotice(payload.action === "IMPORT" ? result.changed+" model records added or updated. "+result.unchanged+" already current." : payload.action === "DECIDE" ? "Decision recorded for this version." : "AI system saved.");
      setData(null);setRefresh(n=>n+1);
    } catch(e) { if (valid()) setError(explain(e)); }
    finally {lock.current=false;if (valid()) setBusy(false);}
  }
  const item = data?.systems.find(s=>s.id===selected);
  const visible = data?.systems.filter(s=>(filter==="All" || (filter==="Needs attention" ? !["Approved","Restricted","Declined"].includes(s.status) : s.assessment.priority==="High")) &&
    [s.name,s.owner,s.profile?.purpose].some(v=>v?.toLowerCase().includes(search.toLowerCase())));
  return <>
    {error && <p role="alert" className={ui.error}>{error} <button type="button" className={ui.secondary} onClick={()=>{setError("");setRefresh(n=>n+1);}}>Reload inventory</button></p>}
    {notice && <p role="status" className={ui.notice}>{notice}</p>}
    {!data ? !error && <p role="status">Loading inventory…</p> : <>
      <div className={ui.actions}>
        {(mode!=="list" || selected) && <button type="button" disabled={busy} className={ui.secondary} onClick={()=>open("")}>Back to inventory</button>}
        {mode==="list" && !selected && <><button type="button" onClick={()=>setMode("create")}>Register AI system</button><button type="button" className={ui.secondary} onClick={()=>setMode("import")}>Discover models from a BOM</button></>}
      </div>
      {mode==="import" ? <ImportModels workspace={workspace} endpoint={endpoint} busy={busy} send={write}/> :
       mode==="create" || mode==="edit" && item ? <ProfileForm key={item?.id ?? "new"} item={mode==="edit"?item:undefined} data={data} userId={workspace.userId} busy={busy} send={write}/> :
       selected ? item ? <section className={ui.panel}><h2>{item.name}</h2><p>{names[item.kind]} · {item.status} · Version {item.version}</p>
         <dl className={styles.facts}><div><dt>Owner</dt><dd>{item.owner}</dd></div><div><dt>Review priority</dt><dd>{item.assessment.priority}</dd></div>
           {item.profile && <><div><dt>Intended use</dt><dd>{item.profile.purpose}</dd></div><div><dt>Data and permissions</dt><dd>{names[item.profile.dataClass]} · {names[item.profile.access]}</dd></div><div><dt>Impact</dt><dd>{names[item.profile.impact]}</dd></div><div><dt>Safeguards</dt><dd>{item.profile.safeguards}</dd></div></>}
           {item.vendorId && <div><dt>Linked supplier</dt><dd>{data.vendors.find(v=>v.id===item.vendorId)?.name ?? "Inactive or unavailable"}</dd></div>}
           {item.controlId && <div><dt>Linked control</dt><dd>{data.controls.find(v=>v.id===item.controlId)?.title ?? "Inactive or unavailable"}</dd></div>}
           {item.source && <div><dt>Source model</dt><dd>{item.source.reference} · Model version {item.source.modelVersion ?? "unspecified"} · BOM revision {item.source.version}<br/>{item.source.serial}</dd></div>}
         </dl><p>{item.assessment.reasons.join(" ")}</p>
         {item.canEdit && <button type="button" className={ui.secondary} onClick={()=>{setNotice("");setMode("edit");}}>Edit use or start a new review</button>}
         {item.canDecide && <DecisionForm key={item.id+item.version} item={item} data={data} send={write} busy={busy}/>}
         {item.history.length>0 && <section><h3>Recent decisions</h3>{item.history.map(h=><article key={h.version} className={styles.history}><strong>Version {h.version} · {names[h.verdict]}</strong><p>{h.rationale}</p><small>{h.reviewer} · {h.at.slice(0,10)} · Review through {h.validUntil} · {h.evidence}</small></article>)}</section>}
       </section> : <p role="alert">This system is unavailable in the selected company.</p> :
       <section className={ui.panel}><h2>Registered systems <small>({data.systems.length})</small></h2>
         <div className={ui.formGrid}><label>Search systems<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, owner or use"/></label><label>Filter<select value={filter} onChange={e=>setFilter(e.target.value)}>{["All","Needs attention","High priority"].map(v=><option key={v}>{v}</option>)}</select></label></div>
         {visible?.length ? <ul className={styles.list}>{visible.map(s=><li key={s.id}><button type="button" onClick={()=>open(s.id)}>{s.name}</button><span>{names[s.kind]} · {s.assessment.priority} priority · {s.status}</span></li>)}</ul> : <p>{data.systems.length ? "No systems match this search." : "Register your first system or import the models declared in a CycloneDX file."}</p>}
       </section>}
    </>}
  </>;
}

function ProfileForm({item,data,userId,busy,send}:{item?:Item;data:Inventory;userId:string;busy:boolean;send:Send}) {
  const requestKey = useRef("");
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f=new FormData(e.currentTarget), val=(k:string)=>String(f.get(k) ?? "");
    requestKey.current ||= crypto.randomUUID();
    void send({...(item ? {action:"UPDATE",id:item.id,version:item.version} : {action:"CREATE",requestKey:requestKey.current}),
      name:item?.source ? item.name : val("name"), kind:item?.source ? "MODEL" : val("kind"), ownerId:val("owner"),
      controlId:val("control") || null, vendorId:val("vendor") || null,
      profile:{purpose:val("purpose"),safeguards:val("safeguards"),dataClass:val("data"),access:val("access"),impact:val("impact")}});
  }
  return <form className={ui.panel} onSubmit={submit}><h2>{item?"Assess this use":"Register an AI system"}</h2><fieldset disabled={busy} className={styles.fields}><legend>System and intended use</legend><div className={ui.formGrid}>
    <label>System name<input name="name" required maxLength={160} defaultValue={item?.name} readOnly={!!item?.source}/></label><label>System type<select required name="kind" defaultValue={item?.kind ?? "TOOL"} disabled={!!item?.source}>{options(systemKinds)}</select></label>
    <label>Accountable owner<select name="owner" required defaultValue={item?.ownerId ?? userId}>{data.members.map(m=><option key={m.id} value={m.id}>{m.email}</option>)}</select></label>
    <label>Supplier<select name="vendor" defaultValue={item?.vendorId ?? ""}><option value="">No linked supplier</option>{data.vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label className={ui.full}>Intended use<textarea name="purpose" required minLength={12} maxLength={1200} defaultValue={item?.profile?.purpose}/></label>
    <label>Highest data sensitivity<select name="data" required defaultValue={item?.profile?.dataClass ?? ""}><option value="">Choose sensitivity</option>{options(dataClasses)}</select></label>
    <label>System permissions<select name="access" required defaultValue={item?.profile?.access ?? ""}><option value="">Choose permissions</option>{options(accessLevels)}</select></label>
    <label>Area of impact<select name="impact" required defaultValue={item?.profile?.impact ?? ""}><option value="">Choose an area</option>{options(impactAreas)}</select></label>
    <label>Linked control<select name="control" defaultValue={item?.controlId ?? ""}><option value="">No linked control</option>{data.controls.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    <label className={ui.full}>Safeguards and human oversight<textarea name="safeguards" required minLength={12} maxLength={1200} defaultValue={item?.profile?.safeguards}/></label>
    </div></fieldset>{item && <p>Saving starts a new version for independent review.</p>}<button disabled={busy}>Save system</button></form>;
}

function DecisionForm({item,data,busy,send}:{item:Item;data:Inventory;busy:boolean;send:Send}) {
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const f=new FormData(e.currentTarget);
    void send({action:"DECIDE",id:item.id,version:item.version,verdict:f.get("verdict"),rationale:f.get("rationale"),evidenceId:f.get("evidence"),validUntil:f.get("date")});
  }
  return <form onSubmit={submit} className={styles.review}><h3>Review this version</h3><div className={ui.formGrid}><label>Decision<select required name="verdict" defaultValue=""><option value="">Choose a decision</option>{options(["APPROVED","RESTRICTED","DECLINED"])}</select></label>
    <label>Review through<input required type="date" name="date" min={new Date().toISOString().slice(0,10)} max={new Date(Date.now()+366*86400000).toISOString().slice(0,10)}/></label>
    <label className={ui.full}>Supporting evidence<select required name="evidence" defaultValue=""><option value="">Choose an approved file</option>{data.evidence.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>
    <label className={ui.full}>Reason and any conditions<textarea required name="rationale" minLength={16} maxLength={1600}/></label></div>
    <button disabled={busy || !data.evidence.length}>Record independent decision</button></form>;
}

function ImportModels({workspace,endpoint,busy,send}:{workspace:Workspace;endpoint:string;busy:boolean;send:Send}) {
  const [bom,setBom]=useState<unknown>(null),[preview,setPreview]=useState<Preview|null>(null),[refs,setRefs]=useState<string[]>([]),[error,setError]=useState(""),[reading,setReading]=useState(false);
  const sequence=useRef(0);
  async function inspect(file?:File) {
    const serial=++sequence.current, valid=workspace.capture();
    const current=()=>valid() && serial===sequence.current;
    setPreview(null);setBom(null);setRefs([]);setError("");setReading(!!file);
    if (!file) return;
    try {
      if (file.size>240*1024) throw new Error("Choose a JSON BOM of up to 240 KB.");
      const value=JSON.parse(await file.text());
      if (!current()) return;
      const response:Preview=await workspace.request(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"PREVIEW",bom:value})});
      if (current()) {setPreview(response);setBom(value);setRefs(response.candidates.filter(c=>c.state==="New" || c.state==="Changed").map(c=>c.reference));}
    } catch(e){if(current())setError(explain(e));} finally{if(current())setReading(false);}
  }
  return <section className={ui.panel}><h2>Discover models from a bill of materials</h2><p>Select a CycloneDX 1.6 or 1.7 JSON file with a serial number and document version. The preview finds declared machine-learning models, including nested components.</p>
    <label className={ui.field}>CycloneDX file<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>void inspect(e.target.files?.[0])}/></label>
    {reading && <p role="status">Reading model definitions…</p>}{error && <p role="alert" className={ui.error}>{error}</p>}
    {preview && <><p>{preview.inspected} components examined · {preview.candidates.length} models · BOM revision {preview.version}</p>
      <fieldset className={styles.fields} disabled={busy}><legend>Models to register or update</legend>{preview.candidates.map(c=><label key={c.reference} className={styles.choice}><input type="checkbox" checked={refs.includes(c.reference)} disabled={["Older export","Conflicting version"].includes(c.state)} onChange={e=>setRefs(old=>e.target.checked?[...old,c.reference]:old.filter(r=>r!==c.reference))}/><span><strong>{c.name}</strong> · {c.componentVersion ?? "Unversioned"} · {c.state}<br/><small>{c.reference}</small></span></label>)}</fieldset>
      <p>You will own new entries until an owner is assigned. A changed model needs a fresh review. Systems omitted from this file keep their existing records.</p>
      <button disabled={busy || !refs.length} onClick={()=>void send({action:"IMPORT",bom,refs})}>Import selected models</button></>}
  </section>;
}
