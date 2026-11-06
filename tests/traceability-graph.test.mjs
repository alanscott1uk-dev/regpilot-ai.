import test from "node:test";
import assert from "node:assert/strict";
import {buildTraceabilityGraph,exportTraceabilityCsv} from "../lib/traceability-graph.mjs";
const action=(id="a1",extra={})=>({id,title:"Sample action",owner:"QA",due:"2026-12-01",status:"In progress",regulator:"Internal",...extra});
const doc=(extra={})=>({id:"d1",title:"Policy",status:"Approved",reviewDate:"2027-01-01",hasAttachment:true,...extra});
const ctrl=(extra={})=>({id:"c1",title:"Quality review",status:"In operation",reviewDate:"2027-01-01",actionIds:["a1","a2"],documentIds:["d1"],...extra});
test("one shared operating control reuses one document across multiple tasks without duplicating the document",()=>{
 const g=buildTraceabilityGraph({actions:[action(),action("a2")],documents:[doc()],controls:[ctrl()]},"2026-11-06");
 assert.equal(g.summary.withCurrentFileMetadata,2);assert.equal(g.rows[0].evidence.length,1);
 assert.equal(g.rows[1].evidence[0].linkMethod,"Shared control");
});
test("only in-operation controls contribute evidence but non-operating ones remain visible",()=>{
 const g=buildTraceabilityGraph({actions:[action()],documents:[doc()],controls:[ctrl({status:"Designed"})]},"2026-11-06");
 assert.equal(g.rows[0].controls.length,1);assert.equal(g.rows[0].evidence.length,0);
 assert.ok(g.rows[0].gaps.some(x=>x.code==="no-operating-control"));
});
test("direct and control links to the same file appear once",()=>{
 const g=buildTraceabilityGraph({actions:[action()],documents:[doc({obligationId:"a1"})],controls:[ctrl()]},"2026-11-06");
 assert.equal(g.rows[0].evidence.length,1);assert.equal(g.rows[0].evidence[0].linkMethod,"Direct + shared control");
});
test("completed task without current evidence is not falsely marked as compliant",()=>{
 const g=buildTraceabilityGraph({actions:[action("a1",{status:"Complete"})]},"2026-11-06");
 assert.equal(g.summary.critical,1);assert.ok(g.rows[0].gaps.some(x=>x.code==="unsupported-completion"));
});
test("source reviewed 91 days ago is flagged only as an age check not a legal change",()=>{
 const g=buildTraceabilityGraph({actions:[action("a1",{sourceUrl:"https://www.gov.uk/example",sourceCheckedAt:"2026-08-01"})]},"2026-11-06");
 assert.equal(g.rows[0].source.state,"check-over-90-days");assert.equal(g.rows[0].gaps.some(x=>x.code==="changed-source-metadata"),false);
});
test("newer version is flagged only when the official source was actually returned",()=>{
 const source={id:"s1",title:"Official source",url:"https://www.gov.uk/government/example",status:"available",revisionAt:"2026-11-06T00:00:00Z"};
 const review={key:"s1::2026-11-01T00:00:00Z",actionId:"a1",status:"action-required",updatedAt:"2026-11-01T10:00:00Z"};
 const a=action("a1",{sourceUrl:source.url,sourceCheckedAt:"2026-11-06"});
 const withSource=buildTraceabilityGraph({actions:[a],reviews:[review],sources:[source]},"2026-11-06");
 const without=buildTraceabilityGraph({actions:[a],reviews:[review],sources:[]},"2026-11-06");
 assert.ok(withSource.rows[0].gaps.some(x=>x.code==="changed-source-metadata"));
 assert.ok(!without.rows[0].gaps.some(x=>x.code==="changed-source-metadata"));
});
test("broken control and document links are detected without deleting records",()=>{
 const g=buildTraceabilityGraph({actions:[action()],documents:[doc({obligationId:"deleted-action"})],controls:[ctrl({actionIds:["a1","deleted-action"],documentIds:["d1","missing"]})]},"2026-11-06");
 assert.ok(g.integrity.some(x=>x.code==="broken-control"));assert.ok(g.integrity.some(x=>x.code==="orphan-document"));
});
test("CSV export neutralises spreadsheet formulas",()=>{
 const g=buildTraceabilityGraph({actions:[action("a1",{title:"=HYPERLINK(1)"})]},"2026-11-06");
 assert.match(exportTraceabilityCsv(g),/'=HYPERLINK/);assert.match(exportTraceabilityCsv(g),/Recorded source/);
});
test("empty graph and invalid date are handled without fake positive completion",()=>{
 const g=buildTraceabilityGraph({},"2026-11-06");assert.equal(g.summary.actions,0);assert.equal(g.summary.withCurrentFileMetadata,0);
 assert.throws(()=>buildTraceabilityGraph({},"2026-02-30"),/Invalid review date/);
});
