"use client";
import {workspaceHref} from "../../../lib/client/workspace-context";
import {REGULATORY_SOURCES,manualRefreshSource} from "../../../lib/regulatory-sources.mjs";
import ui from "./intelligence.module.css";
export type Watch={id:string;sourceId:string;enabled:boolean;intervalHours:number;version:number;state:string;nextCheckAt:string;lastSuccessAt:string|null;lastOutcome:string|null;failureCode:string|null;attempts:number;recoveryPending?:boolean;lastAttemptAt?:string|null};
export type MonitoringRuntime={configured:boolean;state:string;reason:string;mode?:string;cadenceMinutes?:number|null};
type Props={sources?:readonly {id:string;title:string}[];watches:Watch[];active:boolean;organizationId:string;runtime?:MonitoringRuntime;admin:boolean;busy:boolean;save:(value:{sourceId:string;enabled:boolean;intervalHours:number;version:number})=>void};
const timestamp=(v:string)=>new Date(v).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
export default function MonitoringPanel({sources=REGULATORY_SOURCES,watches,active,organizationId,runtime,admin,busy,save}:Props){
  const observed=runtime?.state==="healthy";
  const runtimeLabel=runtime?({inactive:"Awaiting activation","never-observed":"No run observed",running:"Run in progress",healthy:"Recent run recorded",degraded:"Runtime needs attention",stale:"Worker check-in overdue"} as Record<string,string>)[runtime.state]||"Runtime status unknown":active?"Execution unverified":"Awaiting activation";
  return <section className={ui.monitoring} aria-labelledby="monitoring-title">
    <div className={ui.monitoringHeader}><div><span className={ui.eyebrow}>WATCH YOUR SOURCES</span><h2 id="monitoring-title">Know when something changes</h2><p>Save daily or weekly checks. A changed excerpt is added to your review inbox when your business context is saved.</p></div><span className={observed?ui.liveBadge:ui.offBadge}>{runtimeLabel}</span></div>
    <p className={ui.scope}>{runtime?.reason||(active?"Saved configuration does not confirm recent execution. Inspect monitoring health before relying on scheduled collection.":"Schedules can be prepared here. Automated checks require a configured and verified worker or cron trigger.")} <a href={workspaceHref("/team/coverage",organizationId)}>View monitoring health and recovery →</a></p>
    {runtime?.configured&&<p className={ui.small}>{runtime.mode==="cron"?"Daily trigger scheduled for 06:00 UTC.":"Worker expected every "+(runtime.cadenceMinutes||30)+" minutes."} A recovery request waits for an available run.</p>}
    {sources.map(source=>{
      if(manualRefreshSource(source.id))return <div className={ui.watchRow} key={source.id}>
        <div><strong>{source.title}</strong><span className={ui.watchState}>Manual refresh</span></div>
        <a href={workspaceHref('/team/sources',organizationId,{sourceId:source.id})}>Open manual refresh</a>
      </div>;
      const watch=watches.find(w=>w.sourceId===source.id),state=watch?.state||"not-scheduled";return <div className={ui.watchRow} key={source.id}>
      <div><strong>{source.title}</strong><span className={state==="attention"||state==="overdue"?ui.alertText:ui.watchState}>{state.replaceAll("-"," ")}</span><small>{watch?.lastSuccessAt?"Last successful check: "+timestamp(watch.lastSuccessAt):"No successful scheduled check recorded"}{watch?.lastOutcome?" · "+watch.lastOutcome.toLowerCase().replaceAll("_"," "):""}</small>
        {watch?.enabled&&<small>{watch.state==="retry-scheduled"?"Retry due: ":"Next check due: "}{timestamp(watch.nextCheckAt)}</small>}
        {watch?.recoveryPending&&<p>Recovery was requested. The previous issue remains recorded until a check succeeds.</p>}
        {watch?.failureCode&&<p>{watch.failureCode==="PERMISSION_REVOKED"?"The schedule owner no longer has permission. An administrator can review access and request recovery in monitoring health.":watch.state==="attention"?"Checks stopped after repeated failures. Inspect monitoring health to understand the issue and request recovery.":"The last attempt did not complete. Inspect its recorded issue, retry time and runtime status in monitoring health."} <a href={workspaceHref("/team/sources",organizationId,{sourceId:source.id})}>Inspect this source →</a></p>}
      </div>
      {admin&&<div className={ui.watchActions}><label>Check frequency<select aria-label={"Check frequency for "+source.title} disabled={busy} value={watch?.enabled?watch.intervalHours:0} onChange={e=>save({sourceId:source.id,enabled:e.target.value!=="0",intervalHours:Number(e.target.value)||watch?.intervalHours||24,version:watch?.version||0})}><option value={0}>{watch?.failureCode?"Paused — review recovery":"Off"}</option><option value={24}>Every day</option><option value={168}>Every week</option></select></label></div>}
    </div>;})}
    <p className={ui.small}>Checks use your selected and registered official publications. They do not scan the whole regulatory landscape, make paid AI calls or approve tasks. Overdue and failed checks remain visible.</p>
  </section>;
}
