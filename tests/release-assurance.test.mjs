import test from "node:test";
import assert from "node:assert/strict";
import {RELEASE_CONTROLS,evaluateRelease} from "../lib/release-assurance.mjs";
test("release without evidence fails closed",()=>{
 const result=evaluateRelease([]);
 assert.equal(result.approved,false);
 assert.equal(result.blockers.length,RELEASE_CONTROLS.length);
});
test("checkbox-like PASS without reviewer and evidence is not approval",()=>{
 const result=evaluateRelease(RELEASE_CONTROLS.map(c=>({controlId:c.id,status:"PASS"})));
 assert.equal(result.approved,false);assert.equal(result.passed,0);
});
test("fully documented passes are accepted as inputs, not regulator certification",()=>{
 const result=evaluateRelease(RELEASE_CONTROLS.map(c=>({controlId:c.id,status:"PASS",reviewer:"Independent reviewer",evidenceRef:"test-evidence-"+c.id,reviewedAt:"2026-10-27T12:00:00Z"})));
 assert.equal(result.approved,true);assert.equal(result.passed,RELEASE_CONTROLS.length);
});
test("one failed control blocks release",()=>{
 const records=RELEASE_CONTROLS.map(c=>({controlId:c.id,status:"PASS",reviewer:"Reviewer",evidenceRef:"evidence",reviewedAt:"2026-10-27T12:00:00Z"}));
 records[0].status="FAIL";
 assert.equal(evaluateRelease(records).approved,false);
});
