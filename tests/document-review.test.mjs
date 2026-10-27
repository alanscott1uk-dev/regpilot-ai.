import test from "node:test";
import assert from "node:assert/strict";
import {reviewState,documentReviewSummary} from "../lib/document-review.mjs";
const doc=(date,status="Approved")=>({reviewDate:date,status});
test("classifies overdue, due soon and future reviews",()=>{
 assert.equal(reviewState(doc("2026-10-20"),"2026-10-27"),"overdue");
 assert.equal(reviewState(doc("2026-11-10"),"2026-10-27"),"due-soon");
 assert.equal(reviewState(doc("2027-02-01"),"2026-10-27"),"current");
});
test("does not treat archived or missing dates as overdue",()=>{
 assert.equal(reviewState(doc("2026-01-01","Archived"),"2026-10-27"),"archived");
 assert.equal(reviewState(doc(""),"2026-10-27"),"unscheduled");
});
test("counts document review statuses",()=>{const result=documentReviewSummary([doc("2026-10-01"),doc("2026-11-01")],"2026-10-27");assert.equal(result.overdue,1);assert.equal(result["due-soon"],1)});
