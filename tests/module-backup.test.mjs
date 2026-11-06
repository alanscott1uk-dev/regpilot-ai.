import test from "node:test";
import assert from "node:assert/strict";
import {createModuleBackup,parseModuleBackup} from "../lib/module-backup.mjs";
const records=[{id:"r1",name:"Demo licence review",owner:"Quality",due:"2026-12-01",status:"Open",notes:"Fictional"}];
test("demo module backups round trip",()=>{
 const raw=createModuleBackup("licences",records);
 assert.deepEqual(parseModuleBackup(raw,"licences"),records);
});
test("cross-module restores are rejected",()=>{
 assert.throws(()=>parseModuleBackup(createModuleBackup("licences",records),"suppliers"));
});
test("malformed backup never accepted",()=>{
 assert.throws(()=>parseModuleBackup("{broken","licences"));
 assert.throws(()=>parseModuleBackup(JSON.stringify({version:1,moduleId:"licences",records:[{...records[0],name:""}]}),"licences"));
});
test("duplicate IDs are rejected",()=>{
 assert.throws(()=>parseModuleBackup(JSON.stringify({version:1,moduleId:"licences",records:[records[0],records[0]]}),"licences"));
});
