import test from "node:test";
import assert from "node:assert/strict";
import {validateModuleRecordInput,canEditModuleRecord,canDeleteModuleRecord} from "../lib/module-record-validation.mjs";
const sample={moduleId:"suppliers",title:"Supplier approval",ownerName:"Quality",dueDate:"2026-11-15",status:"OPEN",notes:"Synthetic",details:{approval:"Pending"}};
test("valid supplier record accepted",()=>assert.equal(validateModuleRecordInput(sample).ok,true));
test("unknown modules rejected",()=>assert.equal(validateModuleRecordInput({...sample,moduleId:"untrusted"}).ok,false));
test("invalid module details rejected",()=>assert.equal(validateModuleRecordInput({...sample,details:{approval:"Unverified"}}).ok,false));
test("viewer cannot edit or delete",()=>{assert.equal(canEditModuleRecord("VIEWER"),false);assert.equal(canDeleteModuleRecord("VIEWER"),false);});
test("editor may edit but not delete",()=>{assert.equal(canEditModuleRecord("EDITOR"),true);assert.equal(canDeleteModuleRecord("EDITOR"),false);});
