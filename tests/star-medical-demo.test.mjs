import test from "node:test";
import assert from "node:assert/strict";
import {pilot,toPrototypeActions} from "../fixtures/star-medical-demo.mjs";
import {parseDemoBackup} from "../lib/demo-backup.mjs";
import {isValidDate} from "../lib/obligations.mjs";

test("pilot records can be restored by prototype backup parser",()=>{
  const restored=parseDemoBackup(JSON.stringify(toPrototypeActions()));
  assert.equal(restored.length,8);
  assert.equal(restored[0].title,toPrototypeActions()[0].title);
});
test("all pilot records have unique identifiers, valid dates, and owners",()=>{
  const ids=new Set(pilot.actions.map(x=>x.id));
  assert.equal(ids.size,pilot.actions.length);
  for(const x of pilot.actions){assert.ok(isValidDate(x.due));assert.ok(x.owner.trim());assert.ok(x.category.trim());}
});
test("pilot covers regulated distribution workflow categories",()=>{
  const categories=new Set(pilot.actions.map(x=>x.category));
  for(const category of ["MHRA WDA(H)","Home Office","GDP","Site security","Temperature control","Audit readiness"]){
    assert.ok(categories.has(category),category);
  }
});
