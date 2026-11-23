import test from "node:test";
import assert from "node:assert/strict";
import {assessRegulatoryImpact} from "../lib/regulatory-impact.mjs";
const rule={id:"TEST-001",activities:["medicines-wholesale"],jurisdictions:["UK"],sourceUrl:"https://www.gov.uk/example",reviewedBy:"Expert",reviewedAt:"2026-10-30T10:00:00Z"};
test("unreviewed rules never generate actionable candidates",()=>{
 const r=assessRegulatoryImpact({activities:["medicines-wholesale"],jurisdiction:"Scotland",controls:[{...rule,reviewStatus:"PENDING_EXPERT_REVIEW"}]});
 assert.equal(r.actionable,0);assert.equal(r.findings[0].status,"EXPERT_REVIEW_REQUIRED");
});
test("verified candidate remains explicitly non-conclusive",()=>{
 const r=assessRegulatoryImpact({activities:["medicines-wholesale"],jurisdiction:"Scotland",controls:[{...rule,reviewStatus:"APPROVED"}]});
 assert.equal(r.actionable,1);assert.match(r.notice,/not proof/);
});
test("unknown jurisdiction cannot silently trigger an action",()=>{
 const r=assessRegulatoryImpact({activities:["medicines-wholesale"],jurisdiction:"Scotland",controls:[{...rule,jurisdictions:["England"],reviewStatus:"APPROVED"}]});
 assert.equal(r.actionable,0);assert.equal(r.findings[0].status,"JURISDICTION_REVIEW");
});
test("irrelevant activities produce no findings",()=>{
 assert.equal(assessRegulatoryImpact({activities:["retail"],jurisdiction:"Scotland",controls:[rule]}).findings.length,0);
});
