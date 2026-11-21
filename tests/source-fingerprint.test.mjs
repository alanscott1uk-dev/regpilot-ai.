import test from "node:test";
import assert from "node:assert/strict";
import {canonicalSourceText,sourceTextHash,compareSourceText} from "../lib/regulatory/source-fingerprint.mjs";
const baseline="The organisation should maintain a documented procedure for reviewing supplier records. Staff must understand the current quality system and ensure that supporting files can be located promptly. A reviewer should record the date and outcome of each decision.";
test("source fingerprints ignore whitespace but detect real text changes",()=>{
 assert.equal(sourceTextHash(baseline),sourceTextHash("  "+baseline.replaceAll(" ","   ")+"  "));
 assert.notEqual(sourceTextHash(baseline),sourceTextHash(baseline.replace("supplier records","supplier qualifications")));
});
test("first capture is a baseline, not falsely reported as a regulation change",()=>{
 assert.deepEqual(compareSourceText("",baseline),{state:"BASELINE",added:[],removed:[],changed:false});
});
test("content comparison reports textual changes with snippets and no legal claim",()=>{
 const next=baseline.replace("The organisation should maintain a documented procedure for reviewing supplier records.",
  "The organisation should also document quarterly checks for supplier qualifications and record the reviewer by name.");
 const diff=compareSourceText(baseline,next);
 assert.equal(diff.state,"CONTENT_CHANGED");
 assert.ok(diff.added.some(x=>x.includes("quarterly checks")));
 assert.ok(diff.removed.some(x=>x.includes("supplier records")));
});
test("same body and changed metadata alone yield UNCHANGED state",()=>{
 assert.equal(compareSourceText(baseline,baseline).state,"UNCHANGED");
 assert.throws(()=>sourceTextHash("short"),/too short/);
});
