import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const script=new URL("../scripts/check-release.mjs",import.meta.url).pathname;
function run(controls) {
 const dir=mkdtempSync(join(tmpdir(),"regpilot-assurance-"));
 try {
  const input=join(dir,"input.json"),output=join(dir,"report.json");
  writeFileSync(input,JSON.stringify({controls}));
  const result=spawnSync(process.execPath,[script,input,output],{encoding:"utf8"});
  return {code:result.status,report:JSON.parse(readFileSync(output,"utf8"))};
 } finally {rmSync(dir,{recursive:true,force:true});}
}
test("unverified release produces machine-readable BLOCKED report",()=>{
 const result=run([]);
 assert.equal(result.code,1);assert.equal(result.report.approved,false);
 assert.equal(result.report.status,"BLOCKED");assert.equal(result.report.blockers.length,12);
});
test("a single claimed pass cannot approve release",()=>{
 const result=run([{controlId:"SEC-01",status:"PASS",reviewer:"Test reviewer",evidenceRef:"synthetic-test",reviewedAt:"2026-10-27T12:00:00Z"}]);
 assert.equal(result.code,1);assert.equal(result.report.passed,1);
});
