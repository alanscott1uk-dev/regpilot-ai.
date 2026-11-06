import test from "node:test";
import assert from "node:assert/strict";
import {assembleAssurance,serializeAssurance,printableAssurance} from "../lib/assurance-pack.mjs";
import {buildReview} from "../lib/change-triage.mjs";
const action=(overrides={})=>({id:"a1",title:"Review staff records",owner:"Quality",regulator:"Internal",status:"Open",due:"2026-11-01",notes:"Demo record",...overrides});
const doc=(overrides={})=>({id:"d1",title:"Training overview",category:"Training records",owner:"Quality",status:"Approved",version:"1.0",reviewDate:"2026-10-01",obligationId:"a1",hasAttachment:false,...overrides});
const source={id:"mhra",title:"Official update",agency:"MHRA",url:"https://www.gov.uk/government/publications/example",status:"available",updatedAt:"2026-11-01",revisionAt:"2026-11-02"};
const review=buildReview(source,{status:"action-required",impact:"moderate",owner:"Quality",due:"2026-11-30",notes:"Check relevance."},"2026-11-06T09:00:00Z");
test("groups overdue tasks, expired documents and unsupported evidence without compliance verdicts",()=>{
 const pack=assembleAssurance({actions:[action()],documents:[doc()]}, "2026-11-06");
 assert.equal(pack.summary.overdueActions,1);assert.equal(pack.summary.confirmedAttachmentMetadata,0);
 assert.ok(pack.findings.some(x=>x.kind==="Document review overdue"));assert.ok(pack.findings.some(x=>x.kind==="Evidence not confirmed"));
 assert.equal(pack.summary.coveragePercent,0);assert.match(printableAssurance(pack),/Not a compliance verdict/);
});
test("tracks a completed task with an unsupported evidence exception",()=>{
 const p=assembleAssurance({actions:[action({status:"Complete",completionRationale:"Documented special exception."})],documents:[]},"2026-11-06");
 assert.equal(p.summary.completionExceptions,1);assert.equal(p.summary.followUp,1);
});
test("does not count archived documents among unlinked active records",()=>{
 const p=assembleAssurance({actions:[action()],documents:[doc({status:"Archived",obligationId:""})]},"2026-11-06");
 assert.equal(p.summary.unlinkedDocuments,0);
});
test("recognises superseded source version and pending action",()=>{
 const newer={...source,revisionAt:"2026-11-05"};
 const p=assembleAssurance({actions:[],reviews:[review],sources:[newer]},"2026-11-06");
 assert.equal(p.sourceDecisions[0].versionState,"superseded");
 assert.ok(p.findings.some(x=>x.kind==="Previous source version"));
 assert.ok(p.findings.some(x=>x.kind==="Action not created"));
});
test("not-checked source versions are not wrongly called superseded",()=>{
 const p=assembleAssurance({reviews:[review],sources:[]},"2026-11-06");
 assert.equal(p.sourceDecisions[0].versionState,"not-checked");
 assert.ok(!p.findings.some(x=>x.kind==="Previous source version"));
});
test("html printable pack escapes user content and never executes injection",()=>{
 const p=assembleAssurance({company:'Acme <script>alert("x")</script>',actions:[action({title:'<img src=x onerror=alert(1)>'})]},"2026-11-06");
 const html=printableAssurance(p);
 assert.ok(html.includes("&lt;script&gt;"));
 assert.ok(html.includes("&lt;img"));
 assert.ok(!html.includes("<script>"));assert.ok(!html.includes("<img"));
});
test("serialised pack retains schema version, timestamp and does not include actual file bytes",()=>{
 const pack=assembleAssurance({actions:[action()],documents:[doc()],events:[{actionId:"a1",action:"Saved",details:"Demo",timestamp:"2026-11-06T10:00:00Z"}]},"2026-11-06");
 const data=JSON.parse(serializeAssurance(pack));assert.equal(data.version,1);assert.equal(data.activity.length,1);
 assert.equal(data.documents[0].hasAttachment,false);assert.equal("blob" in data.documents[0],false);
});
test("empty workspace does not invent a positive readiness percentage",()=>{
 const p=assembleAssurance({},"2026-11-06");assert.equal(p.summary.coveragePercent,null);assert.equal(p.summary.actions,0);
});
