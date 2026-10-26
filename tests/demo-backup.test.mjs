import test from "node:test";
import assert from "node:assert/strict";
import { parseDemoBackup } from "../lib/demo-backup.mjs";
const valid = {id:"sample-1",title:"Check procedure",owner:"QA",due:"2026-11-01",done:false};
test("round-trips valid action backups",()=>assert.deepEqual(parseDemoBackup(JSON.stringify([valid])),[valid]));
test("rejects malformed JSON",()=>assert.throws(()=>parseDemoBackup("{"),/Invalid JSON/));
test("rejects invalid dates and duplicate identifiers",()=>{
 assert.throws(()=>parseDemoBackup(JSON.stringify([{...valid,due:"2026-02-30"}])),/invalid/);
 assert.throws(()=>parseDemoBackup(JSON.stringify([valid,valid])),/duplicate/);
});
test("rejects excessive or malformed backups",()=>{
 assert.throws(()=>parseDemoBackup(JSON.stringify({items:[valid]})),/Expected/);
 assert.throws(()=>parseDemoBackup(" ".repeat(2_000_001)),/size/);
});
