import test from "node:test";
import assert from "node:assert/strict";
import {REGULATORY_CONTROLS,candidateControls,controlReadyForAutomaticComplianceVerdict} from "../lib/regulatory-assurance.mjs";
test("every seeded control has an official source and expert-review gate",()=>{
 for(const c of REGULATORY_CONTROLS){assert.match(c.sourceUrl,/^https:\/\/www\.gov\.uk\//);assert.equal(c.reviewStatus,"PENDING_EXPERT_REVIEW");assert.ok(c.caveat.length>15);}
});
test("activities determine candidate controls, not business label",()=>{
 assert.equal(candidateControls([]).length,0);
 assert.ok(candidateControls(["controlled-drug-possession"]).some(c=>c.regulator==="Home Office"));
 assert.ok(candidateControls(["medicines-wholesale"]).some(c=>c.regulator==="MHRA"));
});
test("candidate control never implies automatic compliance",()=>{
 for(const c of candidateControls(["medicines-wholesale","controlled-drug-possession"])){
  assert.equal(c.automatedVerdict,null);
  assert.equal(controlReadyForAutomaticComplianceVerdict(c),false);
 }
});
