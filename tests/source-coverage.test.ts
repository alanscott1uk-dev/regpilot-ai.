import test from "node:test";
import assert from "node:assert/strict";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
import {matchingSources,sourceNextStep} from "../lib/regulatory/source-coverage";
import {loadOfficialWeb} from "../lib/server/official-web-source";
test("territory discovery distinguishes GB, Scotland and NI without hiding unclassified references",()=>{
 const ids=(t:string,a="")=>matchingSources(REGULATORY_SOURCES,t,a,"").map(s=>s.id);
 assert.ok(ids("Scotland").includes("fss-starting-business"));assert.ok(!ids("England").includes("fss-starting-business"));assert.ok(!ids("Northern Ireland").includes("acas-disciplinary"));assert.ok(ids("Northern Ireland").includes("hseni-risk-assessment"));
 assert.ok(ids("Scotland","commercial-waste").includes("sepa-waste-duty"));assert.ok(!ids("Scotland","commercial-waste").includes("fss-starting-business"));assert.ok(ids("Scotland","commercial-waste").includes("commercial-waste"),"unclassified references stay available");
 assert.deepEqual(matchingSources(REGULATORY_SOURCES,"Scotland","","flexible").map(s=>s.id),["acas-flexible-working"]);
});
test("coverage stages never claim mapping validation or compliance from a source review",()=>{
 assert.match(sourceNextStep(),/unavailable/);const row={sourceId:"x",snapshotId:null,reviewStatus:null,lastCheckedAt:null,monitoring:"Not scheduled"};assert.match(sourceNextStep(row),/first baseline/);
 assert.match(sourceNextStep({...row,snapshotId:"x",reviewStatus:"NEEDS_REVIEW"}),/Independent/);assert.match(sourceNextStep({...row,snapshotId:"x",reviewStatus:"REVIEWED"}),/assess requirements and mappings/);assert.match(sourceNextStep({...row,snapshotId:"x",reviewStatus:"NOT_APPLICABLE"}),/last source review/);
});
test("all eight additional curated sources use exact allowlisted URLs and existing fail-closed extraction",async()=>{
 const added=REGULATORY_SOURCES.filter(s=>s.jurisdictions);assert.equal(added.length,8);
 for(const s of added){const r=await loadOfficialWeb(s,async(url,options)=>{assert.equal(url,s.url);assert.equal(options?.redirect,"error");return new Response(`<main><h1>${s.heading}</h1><p>${"Fictional publication content only, no real legal claims. ".repeat(12)}</p></main>`,{headers:{"content-type":"text/html"}});});assert.equal(r.id,s.id);assert.equal(r.updatedAt,null);assert.ok(s.scopeNote);}
});
