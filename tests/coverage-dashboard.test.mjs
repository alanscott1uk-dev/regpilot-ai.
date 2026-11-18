import test from "node:test";
import assert from "node:assert/strict";
import {classifySource,coverageDashboard,exportCoverageCsv} from "../lib/regulatory/coverage-dashboard.mjs";
const NOW=Date.parse("2026-11-10T16:00:00Z");
const source={id:"official-a",title:"Example official article",agency:"GOV.UK",path:"/guidance/example",topic:"Training",jurisdictions:["Scotland"],activities:["employing-staff"]};
const time=n=>new Date(NOW-n*3600000).toISOString();
const watch=(override={})=>({enabled:true,active:true,intervalHours:24,attempts:0,nextCheckAt:time(-1),lastSuccessAt:time(6),failureCode:null,...override});
const coverage=(override={})=>({sourceId:source.id,snapshotId:"snapshot-1",reviewStatus:"REVIEWED",lastCheckedAt:time(6),schedule:watch(),...override});
test("a scheduled source is not called current until it has a successful timely check",()=>{
 assert.equal(classifySource(source,coverage(),NOW).status,"current");
 assert.equal(classifySource(source,coverage({schedule:watch({lastSuccessAt:null})}),NOW).status,"never-checked");
 assert.equal(classifySource(source,coverage({schedule:watch({active:false})}),NOW).status,"awaiting-activation");
 assert.equal(classifySource(source,coverage({schedule:watch({failureCode:"FETCH_FAILED"})}),NOW).status,"failed");
 assert.equal(classifySource(source,coverage({schedule:watch({nextCheckAt:time(3)})}),NOW).status,"overdue");
 assert.equal(classifySource(source,coverage({schedule:watch({lastSuccessAt:time(29)})}),NOW).status,"stale");
});
test("review status is independent from currentness and still needs human judgement",()=>{
 const state=classifySource(source,coverage({reviewStatus:"NEEDS_REVIEW"}),NOW);
 assert.equal(state.status,"current");assert.equal(state.attention,true);assert.equal(state.reviewNeeded,true);
});
test("dashboard includes unscheduled references and honest agency coverage gaps",()=>{
 const second={...source,id:"b",title:"Supplier reference",agency:"Acas"};
 const dashboard=coverageDashboard([source,second],[coverage()],NOW);
 assert.equal(dashboard.summary.listed,2);assert.equal(dashboard.summary.baselined,1);
 assert.equal(dashboard.summary.current,1);assert.equal(dashboard.summary.awaiting,1);
 assert.equal(dashboard.agencies.find(a=>a.agency==="Acas").baseline,0);
 assert.equal(dashboard.rows.find(x=>x.id==="b").status,"unmonitored");
 assert.match(dashboard.caveat,/not complete legal coverage/);
});
test("absence and paused/failed states are never presented as successful regulatory checks",()=>{
 const d=coverageDashboard([source],[coverage({schedule:watch({enabled:false,lastSuccessAt:time(3)})})],NOW);
 assert.equal(d.summary.current,0);
 assert.equal(d.rows[0].status,"paused");
});
test("source CSV export prevents spreadsheet formula injection and includes user-visible statuses",()=>{
 const dangerous={...source,title:"=HYPERLINK(\"https://bad.invalid\",\"open\")"};
 const dashboard=coverageDashboard([dangerous],[coverage()],NOW);
 const output=exportCoverageCsv(dashboard.rows);
 assert.match(output,/Publication/);assert.match(output,/current/);
 assert.match(output,/"'=HYPERLINK/);
});

test("recovery requests preserve the failed status until collection actually succeeds",()=>{
 const pending=coverage({schedule:watch({failureCode:"PROVIDER_UNAVAILABLE",recoveryPending:true,attempts:0})});
 const state=classifySource(source,pending,NOW);
 assert.equal(state.status,"failed");assert.equal(state.attention,true);assert.match(state.detail,/successful collection is still unconfirmed/);
 assert.equal(coverageDashboard([source],[pending],NOW).summary.current,0);
});
test("in-progress checks and overdue first checks are not called current or harmless waiting",()=>{
 assert.equal(classifySource(source,coverage({schedule:watch({checking:true})}),NOW).status,"checking");
 const overdue=classifySource(source,coverage({schedule:watch({lastSuccessAt:null,nextCheckAt:time(3)})}),NOW);
 assert.equal(overdue.status,"overdue");assert.equal(overdue.attention,true);
 const pending=classifySource(source,coverage({schedule:watch({recoveryPending:true})}),NOW);
 assert.equal(pending.status,"recovery-pending");assert.equal(pending.attention,true);
});
