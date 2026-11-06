import test from "node:test";
import assert from "node:assert/strict";
import {buildReview,buildTaskFromSource,parseChangeReviews,sourceVersion,reviewKey,reviewSummary,safeOfficialSource} from "../lib/change-triage.mjs";
const official={id:"mhra",agency:"MHRA",title:"Sample official guidance",url:"https://www.gov.uk/government/publications/sample",updatedAt:"2026-11-01T00:00:00Z",revisionAt:"2026-11-03T00:00:00Z",status:"available"};
const values={status:"action-required",impact:"moderate",owner:"Quality",due:"2026-11-20",notes:"Investigate relevance and record the outcome."};
test("only accepts supported official source URLs",()=>{
 assert.equal(safeOfficialSource(official),true);
 assert.equal(safeOfficialSource({...official,url:"https://www.gov.uk.evil.example/"}),false);
 assert.equal(safeOfficialSource({...official,url:"javascript:alert(1)"}),false);
});
test("review is version-bound and cannot carry forward automatically",()=>{
 const r=buildReview(official,values,"2026-11-06T12:00:00Z");
 assert.equal(r.key,reviewKey(official));
 const changed={...official,revisionAt:"2026-11-05T00:00:00Z"};
 assert.notEqual(r.key,reviewKey(changed));
 assert.throws(()=>buildTaskFromSource(changed,r,"action1"),/impact review/);
});
test("requires a real impact explanation for not-applicable decision",()=>{
 assert.throws(()=>buildReview(official,{...values,status:"not-applicable",notes:"N/A"}),/Explain why/);
});
test("creates a traceable draft work item, never auto-closes it",()=>{
 const r=buildReview(official,values,"2026-11-06T12:00:00Z");
 const task=buildTaskFromSource(official,r,"generated-1");
 assert.equal(task.status,"Open");assert.equal(task.sourceUrl,official.url);assert.equal(task.owner,"Quality");
});
test("rejects malformed and oversized local review data",()=>{
 const r=buildReview(official,values,"2026-11-06T12:00:00Z");
 assert.equal(parseChangeReviews(JSON.stringify([r])).length,1);
 assert.equal(parseChangeReviews("not-json").length,0);
});
test("reports review needed separately from tracked action",()=>{
 const r=buildReview(official,values,"2026-11-06T12:00:00Z");
 assert.equal(reviewSummary([official],[]).awaiting,1);
 assert.equal(reviewSummary([official],[r]).awaiting,1);
 assert.equal(reviewSummary([official],[{...r,actionId:"generated-1"}]).tracked,1);
});
