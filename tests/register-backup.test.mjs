import test from "node:test";
import assert from "node:assert/strict";
import {exportRegisterBackup,parseRegisterBackup} from "../lib/register-backup.mjs";
const action={id:"demo-1",title:"Review training SOP",regulator:"GDP",owner:"Quality lead",due:"2026-11-10",status:"Open",notes:"Synthetic example"};
test("register backup round-trip",()=>assert.deepEqual(parseRegisterBackup(exportRegisterBackup([action])),[action]));
test("rejects arbitrary JSON",()=>assert.throws(()=>parseRegisterBackup(JSON.stringify([action])),/Unsupported/));
test("rejects duplicate actions",()=>assert.throws(()=>parseRegisterBackup(JSON.stringify({format:"regpilot-register",version:1,items:[action,action]})),/duplicate/));
test("rejects malformed records",()=>assert.throws(()=>parseRegisterBackup(JSON.stringify({format:"regpilot-register",version:1,items:[{...action,due:"2026-02-30"}]})),/Invalid/));
test("rejects oversized input",()=>assert.throws(()=>parseRegisterBackup(" ".repeat(2000001)),/large/));
