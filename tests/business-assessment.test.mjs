import test from "node:test";
import assert from "node:assert/strict";
import { assessBusiness, assessmentSummary } from "../lib/business-assessment.mjs";

const find = (facts, id) => assessBusiness({ companyNumber: "SC123456", ...facts }).find(x => x.id === id);

test("unknown employee count remains information required", () => {
  assert.equal(find({}, "HS-002").status, "information-required");
});
test("five employees triggers written H&S policy evidence review", () => {
  assert.equal(find({ employeeCount: 5 }, "HS-002").status, "review-required");
  assert.equal(find({ employeeCount: 4 }, "HS-002").status, "not-triggered");
});
test("ICO fee is assessment, not automatic liability", () => {
  const result = find({ processesPersonalData: true }, "DP-002");
  assert.equal(result.kind, "assessment");
  assert.equal(result.status, "review-required");
});
test("AI register is explicitly a RegPilot control", () => {
  assert.equal(find({ usesAI: true }, "AI-001").kind, "regpilot-control");
});
test("VAT threshold prompts review without declaring liability", () => {
  assert.equal(find({ vatRegistered: false, taxableTurnover12m: 90000 }, "VAT-001").status, "review-required");
  assert.equal(find({ vatRegistered: false }, "VAT-001").status, "information-required");
});
test("assessment summary counts all categories", () => {
  const findings = assessBusiness({ companyNumber: "SC123456" });
  const summary = assessmentSummary(findings);
  assert.equal(summary.reviewed + summary.unanswered + summary.notTriggered, findings.length);
});
