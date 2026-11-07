import test from "node:test";
import assert from "node:assert/strict";
import {TRACEABILITY_EXAMPLE} from "../lib/traceability-fixture.mjs";
import {buildTraceabilityGraph} from "../lib/traceability-graph.mjs";
test("fictional walk-through illustrates reuse, evidence limits and completion exceptions",()=>{
 const x=buildTraceabilityGraph(TRACEABILITY_EXAMPLE,"2026-11-06");
 assert.equal(x.rows.length,3);
 assert.equal(x.summary.withCurrentFileMetadata,2);
 assert.ok(x.rows[0].gaps.some(g=>g.code==="overdue-action"));
 assert.ok(x.rows[2].gaps.some(g=>g.code==="unsupported-completion"));
 assert.equal(x.rows[1].controls.length,2);
 assert.equal(x.rows[1].evidence.length,1); // Designed control cannot add evidence
});
test("example does not contain file bytes or claims of real regulatory obligations",()=>{
 assert.equal(TRACEABILITY_EXAMPLE.sources.length,0);
 assert.equal(JSON.stringify(TRACEABILITY_EXAMPLE).includes("data:application/pdf"),false);
});
