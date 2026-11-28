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
test('device discovery separates NI surveillance scope and exposes sector-specific primary references',()=>{
 const ids=(territory:string,activity:string)=>matchingSources(REGULATORY_SOURCES,territory,activity,'').map(s=>s.id);
 assert.ok(ids('Northern Ireland','medical-devices').includes('mhra-device-ni'));
 assert.ok(!ids('England','medical-devices').includes('mhra-device-ni'));
 assert.ok(!ids('Northern Ireland','medical-devices').includes('mhra-device-surveillance'));
 assert.ok(ids('England','medical-devices').includes('mhra-device-surveillance'));
 assert.ok(ids('Wales','clinical-trials').includes('mhra-clinical-approval'));
 assert.ok(ids('Scotland','aml-regulated').includes('hmrc-aml-risk'));
 assert.ok(ids('Scotland','packaging').includes('packaging-epr-scope'));
 assert.equal(new Set(REGULATORY_SOURCES.map(s=>s.id)).size,REGULATORY_SOURCES.length);
});
test("curated territorial publications use their exact allowlisted URL and publisher-specific content scope",async()=>{
 const added=REGULATORY_SOURCES.filter(s=>s.provider==="OFFICIAL_WEB"&&s.jurisdictions);assert.ok(added.length>=11);
 for(const s of added){
  if(s.refreshMode==="manual"){await assert.rejects(loadOfficialWeb(s,async()=>assert.fail("Manual publication triggered an automatic read")),{reasonCode:"MANUAL_REFRESH"});continue;}
  const body="<p>"+("Fictional publication content only, no real legal claims. ").repeat(12)+"</p>";
  const title="<h1>"+s.heading+"</h1>";
  const html=s.articleBody?`<article>${title}<div class="${s.articleBody==="sps"?"text-layout-block__text":"entry-content"}">${body}</div></article>`:title+body;
  const r=await loadOfficialWeb(s,async(url,options)=>{assert.equal(url,s.url);assert.equal(options?.redirect,"error");return new Response("<main>"+html+"</main>",{headers:{"content-type":"text/html"}});});
  assert.equal(r.id,s.id);assert.equal(r.updatedAt,null);assert.ok(s.scopeNote);
 }
});
test("source portfolio search understands SOPs and mistyped temperature mapping under the chosen territorial filter",()=>{
 const ids=(q:string,t:string)=>matchingSources(REGULATORY_SOURCES,t,"medicines",q).map(s=>s.id);
 for(const q of ["SOP","S.O.P.s","standard operating procedures"]) assert.deepEqual(ids(q,"Scotland"),["home-office-controlled-drug-sops"]);
 assert.deepEqual(ids("temperature mappping","Scotland"),["mhra-temperature-mapping"]);
 assert.ok(!ids("standard operating procedures","Northern Ireland").includes("home-office-controlled-drug-sops"));
});
