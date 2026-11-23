import test from "node:test";
import assert from "node:assert/strict";
import {guideForModule} from "../lib/workflow-guides.mjs";
test("specialist workflows provide relevant guidance",()=>{
 assert.match(guideForModule("suppliers").title,/supplier/i);
 assert.match(guideForModule("policies").title,/policy|SOP/i);
 assert.match(guideForModule("licences").title,/licence/i);
 assert.match(guideForModule("audits").title,/audit/i);
});
test("unknown modules have a safe, plain-language fallback",()=>{
 const guide=guideForModule("other");
 assert.equal(guide.steps.length,4);
 assert.ok(guide.steps.every(x=>typeof x==="string"&&x.length>20));
});
test("guides do not claim automatic compliance approval",()=>{
 for(const key of ["suppliers","policies","licences","audits","other"]){
  assert.ok(guideForModule(key).steps.some(x=>/review|verify|verification/i.test(x)));
 }
});
