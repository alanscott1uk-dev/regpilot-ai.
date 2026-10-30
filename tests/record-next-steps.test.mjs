import test from "node:test";
import assert from "node:assert/strict";
import {suggestRecordNextSteps} from "../lib/record-next-steps.mjs";
const base={status:"OPEN",due_date:null,evidence_status:"NOT_SUBMITTED"};
test("missing deadline and evidence produce clear prompts",()=>{
 const r=suggestRecordNextSteps(base,"2026-10-30");
 assert.ok(r.some(x=>x.id==="no-date"));assert.ok(r.some(x=>x.id==="evidence"));
});
test("overdue record receives urgency prompt",()=>{
 assert.ok(suggestRecordNextSteps({...base,due_date:"2026-10-01"},"2026-10-30").some(x=>x.id==="overdue"));
});
test("completed task still prompts independent evidence review",()=>{
 const r=suggestRecordNextSteps({...base,status:"COMPLETE"},"2026-10-30");
 assert.ok(r.some(x=>x.id==="completion"));assert.ok(r.some(x=>x.id==="evidence"));
});
