"use client";
import {REGULATORY_SOURCES} from "../../../lib/regulatory-sources.mjs";
import ui from "./intelligence.module.css";
export type Watch={id:string;sourceId:string;enabled:boolean;intervalHours:number;version:number;state:string;nextCheckAt:string;lastSuccessAt:string|null;lastOutcome:string|null;failureCode:string|null;attempts:number};
type Props={sources?:readonly {id:string;title:string}[];watches:Watch[];active:boolean;admin:boolean;busy:boolean;save:(value:{sourceId:string;enabled:boolean;intervalHours:number;version:number})=>void};
const timestamp=(v:string)=>new Date(v).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
export default function MonitoringPanel({sources=REGULATORY_SOURCES,watches,active,admin,busy,save}:Props){
  return <section className={ui.monitoring} aria-labelledby="monitoring-title">
    <div className={ui.monitoringHeader}><div><span className={ui.eyebrow}>WATCH YOUR SOURCES</span><h2 id="monitoring-title">Know when something changes</h2><p>Save daily or weekly checks. A changed excerpt is added to your review inbox when your business context is saved.</p></div><span className={active?ui.liveBadge:ui.offBadge}>{active?"Worker enabled":"Awaiting activation"}</span></div>
    {!active&&<p className={ui.scope}>Schedules can be prepared here. Automated checks will start only after the monitoring worker and its external trigger are configured and verified.</p>}
    {sources.map(source=>{const watch=watches.find(w=>w.sourceId===source.id),state=watch?.state||"not-scheduled";return <div className={ui.watchRow} key={source.id}>
      <div><strong>{source.title}</strong><span className={state==="attention"||state==="overdue"?ui.alertText:ui.watchState}>{state.replaceAll("-"," ")}</span><small>{watch?.lastSuccessAt?"Last successful check: "+timestamp(watch.lastSuccessAt):"No successful scheduled check recorded"}{watch?.lastOutcome?" · "+watch.lastOutcome.toLowerCase().replaceAll("_"," "):""}</small>
        {watch?.enabled&&<small>{watch.state==="retry-scheduled"?"Retry due: ":"Next check due: "}{timestamp(watch.nextCheckAt)}</small>}
        {watch?.failureCode&&<p>{watch.failureCode==="PERMISSION_REVOKED"?"The schedule owner no longer has permission. An administrator can save a new schedule.":watch.state==="attention"?"Checks stopped after repeated failures. Recheck the source and save the schedule to resume.":"The last attempt did not complete. Review the last successful check; a retry is scheduled."}</p>}
      </div>
      {admin&&<div className={ui.watchActions}><label>Check frequency<select aria-label={"Check frequency for "+source.title} disabled={busy} value={watch?.enabled?watch.intervalHours:0} onChange={e=>save({sourceId:source.id,enabled:e.target.value!=="0",intervalHours:Number(e.target.value)||watch?.intervalHours||24,version:watch?.version||0})}><option value={0}>{watch?.failureCode?"Paused — choose to resume":"Off"}</option><option value={24}>Every day</option><option value={168}>Every week</option></select></label></div>}
    </div>;})}
    <p className={ui.small}>Checks use your selected and registered GOV.UK publications. They do not scan the whole regulatory landscape, make paid AI calls or approve tasks. Overdue and failed checks remain visible.</p>
  </section>;
}
