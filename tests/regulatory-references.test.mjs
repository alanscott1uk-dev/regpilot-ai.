import test from "node:test";
import assert from "node:assert/strict";
import {regulatoryReferencesForModule} from "../lib/regulatory-references.mjs";
test("specialist modules show official-source review references",()=>{
 const refs=regulatoryReferencesForModule("licences");
 assert.ok(refs.some(x=>x.regulator==="Home Office"));
 assert.ok(refs.some(x=>x.regulator==="MHRA"));
 assert.ok(refs.every(x=>x.status==="PENDING_EXPERT_REVIEW"&&x.url.startsWith("https://")));
});
test("unconfigured modules cannot invent regulatory requirements",()=>{
 assert.deepEqual(regulatoryReferencesForModule("general"),[]);
});
