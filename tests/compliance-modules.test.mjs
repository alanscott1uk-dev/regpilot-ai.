import test from "node:test";
import assert from "node:assert/strict";
import {COMPLIANCE_MODULES,recommendedModules,validModules} from "../lib/compliance-modules.mjs";
test("all module identifiers are unique",()=>assert.equal(new Set(COMPLIANCE_MODULES.map(x=>x.id)).size,COMPLIANCE_MODULES.length));
test("sector recommendations include shared core modules",()=>{
 for(const sector of ["healthcare","construction","financial","technology","general"]){
  const ids=recommendedModules(sector);assert.ok(ids.includes("obligations"));assert.ok(ids.includes("audits"));assert.ok(validModules(ids));
 }
});
test("industry modules are suggested selectively",()=>{
 assert.ok(recommendedModules("healthcare").includes("imports"));
 assert.ok(!recommendedModules("financial").includes("imports"));
});
test("invalid and duplicate selections are rejected",()=>{
 assert.equal(validModules(["obligations","obligations"]),false);
 assert.equal(validModules(["unrecognised"]),false);
});
