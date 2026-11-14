import test from "node:test";
import assert from "node:assert/strict";
import {prepareComplianceBrief,exportBriefCsv} from "../lib/operational-brief.mjs";
const now="2026-11-10T20:00:00Z";
const fixture=()=>({
 changes:[{id:"change-a",sourceId:"a",title:"Fictional revised source",sourceUrl:"https://www.gov.uk/example",
  detectedAt:"2026-11-09T10:00:00Z",reviewStatus:"NEEDS_REVIEW"},
  {id:"old",sourceId:"b",title:"Old source",detectedAt:"2026-10-01T10:00:00Z",reviewStatus:"REVIEWED"}],
 snapshots:[{id:"new",sourceId:"a",title:"New recorded version",reviewStatus:"NEEDS_REVIEW",
   capturedAt:"2026-11-09T10:00:00Z",checkedAt:"2026-11-09T10:00:00Z"},
   {id:"old",sourceId:"a",title:"Older version",reviewStatus:"REVIEWED",
   capturedAt:"2026-11-01T10:00:00Z",checkedAt:"2026-11-01T10:00:00Z"}],
 watches:[{sourceId:"a",title:"A source",enabled:true,active:true, failureCode:"FETCH_UNAVAILABLE",
   nextCheckAt:"2026-11-11T20:00:00Z",lastSuccessAt:null},
   {sourceId:"b",title:"B source",enabled:true,active:true,
   nextCheckAt:"2026-11-08T10:00:00Z",lastSuccessAt:"2026-11-01T10:00:00Z"}],
 connectors:[{id:"one",provider:"GITHUB",target:"fictional/example",enabled:true,failureCode:"TOKEN_REVOKED",lastSuccessAt:null}],
 tasks:[{id:"due",title:"Review current evidence",status:"OPEN",dueDate:"2026-11-12T00:00:00Z",ownerName:"Reviewer"},
  {id:"future",title:"Long-term improvement",status:"OPEN",dueDate:"2027-01-01T00:00:00Z",ownerName:"Owner"},
  {id:"closed",title:"Closed task",status:"COMPLETE",dueDate:"2026-11-09T00:00:00Z",ownerName:"Owner"}]
});
test("briefing separates actual source text changes from baseline and mere catalogue entries",()=>{
 const r=prepareComplianceBrief(fixture(),now);
 assert.equal(r.summary.changedPublications,1);assert.equal(r.summary.awaitingReview,1);
 assert.equal(r.changes[0].sourceId,"a");assert.match(r.changes[0].summary,/legal significance unassessed/);
 assert.equal(r.pending[0].id,"new");
 assert.equal(r.windowEnd,now);
});
test("failed source or connection is distinct from a genuine successful check",()=>{
 const r=prepareComplianceBrief(fixture(),now);
 assert.equal(r.summary.sourceCheckIssues,2);
 assert.equal(r.collections.find(x=>x.sourceId==="a").status,"failed");
 assert.equal(r.collections.find(x=>x.sourceId==="b").status,"overdue");
 assert.equal(r.summary.connectorIssues,1);
 assert.equal(r.connectors[0].status,"failed");
});
test("due workload excludes completed and distant tasks",()=>{
 const r=prepareComplianceBrief(fixture(),now);
 assert.equal(r.summary.dueWork,1);assert.equal(r.tasks[0].id,"due");
 assert.match(r.tasks[0].href,/taskId=due/);
});
test("tenant records cannot leak data absent from the input and CSV neutralizes spreadsheet formulas",()=>{
 const f=fixture();f.changes[0].title="=HYPERLINK(\"https://bad.invalid\",\"click\")";
 const r=prepareComplianceBrief(f,now),csv=exportBriefCsv(r);
 assert.match(csv,/"'=HYPERLINK/);
 assert.doesNotMatch(csv,/unrelated company|secret key/);
});
test("invalid timestamps cannot fabricate new changes or overdue cases",()=>{
 const f=fixture();f.changes[0].detectedAt="invalid";f.tasks[0].dueDate="invalid";
 const r=prepareComplianceBrief(f,now);
 assert.equal(r.summary.changedPublications,0);assert.equal(r.summary.dueWork,0);
 assert.throws(()=>prepareComplianceBrief(f,"not a date"));
});
