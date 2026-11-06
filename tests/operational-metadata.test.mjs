import test from "node:test";
import assert from "node:assert/strict";
import {validateObligation} from "../lib/obligations.mjs";
import {exportRegisterBackup,parseRegisterBackup} from "../lib/register-backup.mjs";
const action={id:"demo-1",title:"Review",owner:"Quality",regulator:"Internal",due:"2026-11-09",status:"Open",notes:"demo",sourceUrl:"https://www.gov.uk/",sourceCheckedAt:"2026-11-06",completionRationale:"This is an illustrative exception note."};
test("preserves optional source and completion metadata across JSON backup",()=>{
 const restored=parseRegisterBackup(exportRegisterBackup([action]));assert.deepEqual(restored[0],action);
});
test("refuses non-HTTPS or script source URLs",()=>{
 assert.equal(validateObligation({...action,sourceUrl:"javascript:alert(1)"}),false);
 assert.equal(validateObligation({...action,sourceUrl:"http://example.com"}),false);
 assert.equal(validateObligation({...action,sourceUrl:"https://valid.example"}),true);
});
test("rejects invalid source review dates",()=>{
 assert.equal(validateObligation({...action,sourceCheckedAt:"2026-02-30"}),false);
});
