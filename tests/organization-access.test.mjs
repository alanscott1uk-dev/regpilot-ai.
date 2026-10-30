import test from "node:test";
import assert from "node:assert/strict";
import {authorizeModuleOperation} from "../lib/organization-access.mjs";
const members=[{userId:"alice",organizationId:"org-a",role:"ADMIN"},{userId:"bob",organizationId:"org-b",role:"VIEWER"}];
test("administrator can edit own organisation",()=>assert.equal(authorizeModuleOperation(members,"alice","org-a","update").allowed,true));
test("membership cannot cross organisation boundary",()=>assert.equal(authorizeModuleOperation(members,"alice","org-b","read").allowed,false));
test("viewer cannot create or delete",()=>{
 assert.equal(authorizeModuleOperation(members,"bob","org-b","read").allowed,true);
 assert.equal(authorizeModuleOperation(members,"bob","org-b","create").allowed,false);
 assert.equal(authorizeModuleOperation(members,"bob","org-b","delete").allowed,false);
});
test("unknown operation denied",()=>assert.equal(authorizeModuleOperation(members,"alice","org-a","export-all").allowed,false));
