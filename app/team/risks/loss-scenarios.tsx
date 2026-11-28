"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {quantifyLoss,casesSchema,type LossInputs,type LossCase,type LossResult} from "../../../lib/risk-loss";
import type {lossScenarios} from "../../../lib/server/risk-loss-service";
import type {useWorkspaceContext} from "../../../lib/client/workspace-context";
import ui from "../programmes/programmes.module.css";
import css from "./loss-scenarios.module.css";

type W = ReturnType<typeof useWorkspaceContext>;
type Scenario = Awaited<ReturnType<typeof lossScenarios>>["scenarios"][number];
const gbp = (n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:0}).format(n);
const percent = (n:number)=>(n*100).toLocaleString("en-GB",{maximumFractionDigits:1})+"%";
const errorText = (e:unknown)=>e instanceof Error?e.message:"Could not read this scenario.";

function Results({value}:{value:LossResult}) {
  const rows = [
    ["Expected annual loss",gbp(value.before.expected),value.after && gbp(value.after.expected)],
    ["Median annual loss",gbp(value.before.median),value.after && gbp(value.after.median)],
    ["90th percentile annual loss",gbp(value.before.p90),value.after && gbp(value.after.p90)],
    ["Chance of at least one event",percent(value.before.eventProbability),value.after && percent(value.after.eventProbability)],
  ];
  return <><table className={css.table}><caption>One-year loss estimates</caption><thead><tr><th scope="col">Measure</th><th scope="col">Before treatment</th>{value.after && <th scope="col">After treatment</th>}</tr></thead>
    <tbody>{rows.map(([label,a,b])=><tr key={label}><th scope="row">{label}</th><td>{a}</td>{value.after && <td>{b}</td>}</tr>)}</tbody></table>
    {value.expectedReduction!==null && <p>Modelled change in expected annual loss: <strong>{gbp(Math.abs(value.expectedReduction))} {value.expectedReduction<0?"increase":value.expectedReduction>0?"reduction":"change"}</strong>.</p>}</>;
}
const fields = [["eventsPerYear","Expected events per year"],["low","Low loss per event (£)"],["likely","Most likely loss per event (£)"],["high","High loss per event (£)"]] as const;
function InputGroup({stage}:{stage:"Before"|"After"}) {
  return <fieldset className={css.inputs}><legend>{stage} treatment</legend>{fields.map(([key,label])=><label key={key}>{label}<input
    aria-label={stage+" treatment "+label} name={stage+key} type="number" min="0" max={key==="eventsPerYear"?50:1e9} step={key==="eventsPerYear"?"any":"1"} required/></label>)}</fieldset>;
}
function readCase(values:FormData,prefix:string):LossCase {
  const get=(key:string)=>{const raw=values.get(prefix+key);return typeof raw==="string" && raw.trim()!==""?Number(raw):NaN;};
  return {eventsPerYear:get("eventsPerYear"),low:get("low"),likely:get("likely"),high:get("high")};
}
function assumptionText(c:LossCase) {
  return c.eventsPerYear+" expected events/year. Low "+gbp(c.low)+", most likely "+gbp(c.likely)+", high "+gbp(c.high)+" per event.";
}

export default function LossScenarios({workspace,riskId,version,canSave,evidence}:{workspace:W;riskId:string;version:number;canSave:boolean;evidence:{id:string;filename:string}[]}) {
  const {request,capture,organizationId}=workspace;
  const endpoint="/api/workspace/risks/"+riskId+"/exposure?organizationId="+encodeURIComponent(organizationId);
  const [open,setOpen]=useState(false),[compare,setCompare]=useState(false),[stored,setStored]=useState<Scenario[]|null>(null),[refresh,setRefresh]=useState(0);
  const [result,setResult]=useState<LossResult|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const key=useRef(""),lock=useRef(false);
  useEffect(()=>{
    if (!open) return;
    const valid=capture(),controller=new AbortController();
    request(endpoint,{signal:controller.signal}).then(body=>{
      if (valid() && !controller.signal.aborted && body.organizationId===organizationId && body.riskId===riskId) setStored(body.scenarios);
    }).catch(e=>{if(valid() && !controller.signal.aborted)setError(errorText(e));});
    return ()=>controller.abort();
  },[open,endpoint,request,capture,riskId,organizationId,refresh]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(lock.current)return;
    const f=new FormData(event.currentTarget),save=(event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")==="save";
    const evaluated=casesSchema.safeParse({before:readCase(f,"Before"),after:compare?readCase(f,"After"):null});
    setError("");setNotice("");
    if (!evaluated.success) {setError("Enter 0–50 expected events per year. Give three ordered whole-pound losses between £0 and £1 billion for each case.");return;}
    const inputs:LossInputs=evaluated.data;
    setResult(quantifyLoss(inputs));
    if(!save)return;
    if (!canSave || !String(f.get("title")??"").trim() || String(f.get("assumptions")??"").trim().length<16) {setError("Add a scenario name and explain the basis for the figures.");return;}
    const valid=capture();lock.current=true;setBusy(true);key.current ||= crypto.randomUUID();
    try {
      await request(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({riskVersion:version,requestKey:key.current,title:f.get("title"),assumptions:f.get("assumptions"),inputs,evidenceId:f.get("evidence")||null})});
      if(valid()){setNotice("Scenario saved against this risk version.");setRefresh(x=>x+1);}
    } catch(e) {if(valid())setError(errorText(e));} finally {lock.current=false;if(valid())setBusy(false);}
  }
  function download(s:Scenario) {
    const record={format:"regpilot-gbp-risk-scenario",formatVersion:1,organizationId,riskId,...s};
    const objectUrl=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=objectUrl;link.download="risk-scenario-"+s.id+".json";link.click();
    window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
  return <details className={css.panel} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Financial exposure in pounds</summary>
    {open && <><p>Estimate annual loss from event frequency and loss per event. Compare a proposed treatment by changing either assumption.</p>
    <form onSubmit={submit} onChange={()=>{key.current="";setResult(null);setNotice("");}}>
      <fieldset className={css.wrapper} disabled={busy}><InputGroup stage="Before"/>
        <label className={css.toggle}><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/> Compare after treatment</label>
        {compare && <InputGroup stage="After"/>}
        {canSave && <div className={ui.fields}><label>Scenario name<input name="title" minLength={3} maxLength={160}/></label>
          <label>Supporting evidence<select name="evidence"><option value="">Assumptions only</option>{evidence.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>
          <label className={ui.full}>Sources and assumptions<textarea name="assumptions" minLength={16} maxLength={1600} rows={2}/></label></div>}
        <div className={css.actions}><button type="submit" value="preview" formNoValidate>Calculate exposure</button>{canSave && <button type="submit" value="save">Save scenario</button>}</div>
      </fieldset></form>
      {error && <p role="alert" className={ui.alert}>{error}</p>}{notice && <p role="status">{notice}</p>}{result && <Results value={result}/>}
      <details><summary>How the estimate is calculated</summary><p>The expected loss uses the annual event rate and the mean of the three loss estimates. For the median and 90th percentile we simulate 10,000 years with Poisson event counts and independent triangular losses. Both cases use the same reproducible draws. The 90th percentile is the amount at or below which nine in ten simulated years fall. The figures depend on your assumptions and exclude treatment costs.</p></details>
      <h4>Saved scenarios</h4>{stored===null?<p role="status">Loading saved scenarios…</p>:stored.length===0?<p>No saved scenarios for this risk.</p>:stored.map(s=><details key={s.id} className={css.saved}>
        <summary>{s.title} · {gbp(s.result.before.expected)} expected annual loss</summary><p>{s.author} · {s.createdAt.slice(0,10)} · {s.currentRevision?"Current":"Historical"} risk revision {s.riskVersion}. {s.evidenceStatus}{s.evidenceName?" · "+s.evidenceName:""}.</p>
        <p>{s.assumptions}</p><p>Before treatment: {assumptionText(s.inputs.before)}</p>{s.inputs.after && <p>After treatment: {assumptionText(s.inputs.after)}</p>}<Results value={s.result}/><button type="button" onClick={()=>download(s)}>Download scenario</button></details>)}
    </>}
  </details>;
}
