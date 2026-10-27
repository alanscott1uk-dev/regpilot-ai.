import test from "node:test";
import assert from "node:assert/strict";
import {fieldsForModule,validateModuleDetails} from "../lib/module-fields.mjs";
test("licences have authority and expiry fields",()=>{
 const keys=fieldsForModule("licences").map(x=>x.key);
 assert.ok(keys.includes("issuer"));assert.ok(keys.includes("expiry"));
});
test("suppliers and imports have distinct fields",()=>{
 assert.ok(fieldsForModule("suppliers").some(x=>x.key==="approval"));
 assert.ok(fieldsForModule("imports").some(x=>x.key==="origin"));
});
test("unknown fields and invalid select values are rejected",()=>{
 assert.equal(validateModuleDetails("suppliers",{approval:"Approved"}),true);
 assert.equal(validateModuleDetails("suppliers",{approval:"Certified"}),false);
 assert.equal(validateModuleDetails("suppliers",{password:"secret"}),false);
});
