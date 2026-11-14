import test from "node:test";
import assert from "node:assert/strict";
import {connectorHealth} from "../lib/connectors/health-dashboard.mjs";
const now=Date.parse("2026-11-10T20:00:00Z"),hours=h=>new Date(now-h*3600000).toISOString();
const row=(p={})=>({id:"connector-a",provider:"GITHUB",target:"fictional/test",version:3,observedVersion:3,
 enabled:true,providerAvailable:true,integrityValid:true,lastSuccessAt:hours(2),lastCapturedAt:hours(2),
 intervalHours:24,lastOutcome:"OBSERVED",failureCode:null,checksFailed:0,checksUnknown:0,...p});
test("observed integrations require actual successful recent, matching and intact collection",()=>{
 const r=connectorHealth([row()],now);
 assert.equal(r.observed,1);assert.equal(r.needsAttention,0);
 assert.match(r.notice,/not evidence.*legally sufficient/);
});
test("technical failure, expired observation, disabled provider and mismatched hash cannot count as verified",()=>{
 const inputs=[
  row({id:"failed",failureCode:"UNAVAILABLE"}),
  row({id:"stale",lastSuccessAt:hours(30)}),
  row({id:"disabled",providerAvailable:false}),
  row({id:"tampered",integrityValid:false}),
  row({id:"wrong-version",observedVersion:2}),
  row({id:"unverified",lastSuccessAt:null}),
  row({id:"paused",enabled:false})
 ];
 const r=connectorHealth(inputs,now);
 assert.equal(r.observed,0);
 assert.equal(r.items.find(x=>x.id==="failed").status,"failed");
 assert.equal(r.items.find(x=>x.id==="stale").status,"stale");
 assert.equal(r.items.find(x=>x.id==="disabled").status,"unavailable");
 assert.equal(r.items.find(x=>x.id==="tampered").status,"untrusted");
 assert.equal(r.items.find(x=>x.id==="wrong-version").status,"untrusted");
 assert.equal(r.items.find(x=>x.id==="unverified").status,"never-verified");
 assert.equal(r.items.find(x=>x.id==="paused").status,"paused");
});
test("failed and unknown checks remain actionable, not a passing compliance assessment",()=>{
 const result=connectorHealth([row({lastOutcome:"FOLLOW_UP",checksFailed:2}),row({id:"b",lastOutcome:"INCOMPLETE",checksUnknown:1})],now);
 assert.equal(result.observed,0);assert.equal(result.needsAttention,2);
 assert.deepEqual(result.items.map(x=>x.status),["attention","attention"]);
});
test("empty inventory never indicates verified integration",()=>{
 const result=connectorHealth([],now);
 assert.equal(result.total,0);assert.equal(result.observed,0);assert.equal(result.needsAttention,0);
});
