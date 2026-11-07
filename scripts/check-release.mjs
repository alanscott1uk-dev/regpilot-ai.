import { readFileSync, writeFileSync } from "node:fs";
import { evaluateRelease, RELEASE_CONTROLS } from "../lib/release-assurance.mjs";

const input = process.argv[2] || "assurance/release-evidence.json";
const output = process.argv[3] || "assurance/release-report.json";
let evidence = [];
try {
 const payload = JSON.parse(readFileSync(input, "utf8"));
 if (!payload || !Array.isArray(payload.controls)) throw new Error("Expected controls array");
 evidence = payload.controls;
} catch (error) {
 console.error("Release evidence unavailable or invalid:", error.message);
}
const result = evaluateRelease(evidence);
const report = {
 schemaVersion: 1,
 status: result.approved ? "APPROVED_FOR_INTERNAL_RELEASE_REVIEW" : "BLOCKED",
 approved: result.approved,
 passed: result.passed,
 total: result.total,
 blockers: result.blockers,
 controls: result.controls,
 notice: "Internal evidence gate only; not a regulatory approval or certification."
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log("Release assurance:", report.status, result.passed + "/" + result.total);
for (const control of result.controls.filter(c => !c.verified)) console.log("BLOCKED", control.id, control.label);
if (!result.approved) process.exitCode = 1;
