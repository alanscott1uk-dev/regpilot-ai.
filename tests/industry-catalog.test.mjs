import test from "node:test";
import assert from "node:assert/strict";
import {INDUSTRIES,getIndustry,validateDepartments} from "../lib/industry-catalog.mjs";
test("industry identifiers unique and department templates valid",()=>{
 assert.equal(new Set(INDUSTRIES.map(x=>x.id)).size,INDUSTRIES.length);
 for(const x of INDUSTRIES)assert.equal(validateDepartments(x.departments),true,x.id);
});
test("unknown industry falls back to general business",()=>assert.equal(getIndustry("unknown").id,"general"));
test("rejects duplicate or oversized departments",()=>{
 assert.equal(validateDepartments(["Finance","finance"]),false);
 assert.equal(validateDepartments([""]),false);
 assert.equal(validateDepartments(Array(41).fill("Operations")),false);
});
