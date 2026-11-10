// Source coverage is operational freshness, never an assertion of regulatory completeness.
const list=v=>Array.isArray(v)?v:[];
const iso=value=>typeof value==="string"&&!Number.isNaN(Date.parse(value))?Date.parse(value):null;
const escapeCsv=value=>{const s=String(value??"");const safe=/^[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';};
const modes={failed:0,overdue:1,"review-needed":2,"awaiting-activation":3,"never-checked":4,paused:5,unmonitored:6,stale:7,current:8};
export function classifySource(source,coverage,now=Date.now()){
 const row=coverage||{},watch=row.schedule||null,checked=iso(row.lastCheckedAt),success=iso(watch?.lastSuccessAt);
 const review=row.reviewStatus==="NEEDS_REVIEW";
 const interval=watch?.intervalHours===24?24:watch?.intervalHours===168?168:null;
 let state="unmonitored",detail="No source-watch schedule configured";
 if(watch){
  if(watch.failureCode) {state="failed";detail="Last collection failed: "+String(watch.failureCode).replaceAll("_"," ").toLowerCase();}
  else if(!watch.enabled){state="paused";detail="A watch was configured but is paused";}
  else if(watch.active===false){state="awaiting-activation";detail="Scheduler or monitoring service is not active";}
  else if(!success){state="never-checked";detail="No confirmed successful scheduled check";}
  else if(iso(watch.nextCheckAt)!==null&&iso(watch.nextCheckAt)<now-3600000){state="overdue";detail="Scheduled collection has missed its due time";}
  else if(interval&&now-success>(interval+2)*3600000){state="stale";detail="Most recent successful scheduled check is outside the configured interval";}
  else{state="current";detail="Scheduled collection is running within the recorded interval";}
 }
 // A checked publication may still require new independent human review.
 return {id:source.id,title:source.title,agency:source.agency,topic:source.topic||"Unclassified",kind:source.kind||"Publication",
   jurisdictions:list(source.jurisdictions),activities:list(source.activities),
   sourceUrl:source.url||("https://www.gov.uk"+source.path),
   status:state,detail,reviewNeeded:review,reviewStatus:row.reviewStatus||"No baseline",
   baseline:!!row.snapshotId,lastCheckedAt:row.lastCheckedAt||null,lastSuccessAt:watch?.lastSuccessAt||null,
   intervalHours:interval,failureCode:watch?.failureCode||null,
   attention:review||["failed","overdue","stale"].includes(state),
   sort:modes[state]+(review?-.5:0),observedAt:checked?new Date(checked).toISOString():null};
}
export function coverageDashboard(catalogue,coverage,now=Date.now()){
 const map=new Map(list(coverage).filter(x=>typeof x?.sourceId==="string").map(x=>[x.sourceId,x]));
 const rows=list(catalogue).filter(x=>typeof x?.id==="string"&&typeof x?.title==="string").map(s=>classifySource(s,map.get(s.id),now));
 rows.sort((a,b)=>a.sort-b.sort||a.agency.localeCompare(b.agency)||a.title.localeCompare(b.title));
 const count=key=>rows.filter(key).length;
 const states={};for(const k of Object.keys(modes))states[k]=count(x=>x.status===k);
 const agencies=[...new Set(rows.map(x=>x.agency))].sort().map(agency=>{
  const group=rows.filter(r=>r.agency===agency);
  return {agency,total:group.length,baseline:group.filter(r=>r.baseline).length,
   monitored:group.filter(r=>r.status!=="unmonitored").length,
   attention:group.filter(r=>r.attention).length};
 });
 return {generatedAt:new Date(now).toISOString(),rows,agencies,summary:{
  listed:rows.length,baselined:count(r=>r.baseline),scheduled:count(r=>!["unmonitored","paused","awaiting-activation"].includes(r.status)),
  current:states.current||0,reviewNeeded:count(r=>r.reviewNeeded),
  failed:states.failed||0,overdue:states.overdue||0,stale:states.stale||0,
  awaiting:count(r=>["unmonitored","never-checked","awaiting-activation","paused"].includes(r.status)),
  attention:count(r=>r.attention)
 },states,
 caveat:"A curated catalogue is not complete legal coverage. A successful fetch is not a legal or compliance verdict. All material changes need independent qualified review."};
}
export function exportCoverageCsv(rows){
 const columns=["Agency","Publication","Operational status","Independent review","Last text check UTC","Last successful scheduled check UTC","Interval hours","Territories (discovery tags)","Official URL"];
 return [columns,...list(rows).map(r=>[r.agency,r.title,r.status,r.reviewStatus,r.lastCheckedAt,r.lastSuccessAt,r.intervalHours,r.jurisdictions?.join("; "),r.sourceUrl])].map(row=>row.map(escapeCsv).join(",")).join("\r\n");
}
