import test from "node:test";
import assert from "node:assert/strict";
import {evidenceCoverage,evidenceCoverageSummary} from "../lib/evidence-coverage.mjs";
const action={id:"a1",title:"Review procedure",status:"Open",owner:"Quality",due:"2026-12-01"};
const doc=(status,reviewDate,hasAttachment=true)=>({obligationId:"a1",status,reviewDate,hasAttachment});
test("reports missing evidence for an action without documents",()=>assert.equal(evidenceCoverage([action],[],"2026-11-06")[0].state,"missing"));
test("does not count draft documents as approved evidence",()=>assert.equal(evidenceCoverage([action],[doc("Draft","2027-01-01")],"2026-11-06")[0].state,"pending-review"));
test("does not treat an approved record without a file as verified evidence",()=>assert.equal(evidenceCoverage([action],[doc("Approved","2027-01-01",false)],"2026-11-06")[0].state,"attachment-unverified"));
test("identifies review-expired evidence",()=>assert.equal(evidenceCoverage([action],[doc("Approved","2026-10-01")],"2026-11-06")[0].state,"review-expired"));
test("counts approved current linked files",()=>{const result=evidenceCoverage([action],[doc("Approved","2027-01-01")],"2026-11-06");assert.equal(result[0].state,"evidence-linked");assert.equal(evidenceCoverageSummary(result)["evidence-linked"],1);});
test("excludes archived evidence and does not confuse unrelated documents",()=>assert.equal(evidenceCoverage([action],[{...doc("Approved","2027-01-01"),obligationId:"a2"},{...doc("Archived","2027-01-01")}],"2026-11-06")[0].state,"missing"));

test("reuses a document across two obligations via a shared active control",()=>{
 const acts=[{id:"a1",title:"One"},{id:"a2",title:"Two"}];
 const docs=[{id:"doc1",status:"Approved",hasAttachment:true,reviewDate:"2027-06-01",obligationId:undefined}];
 const controls=[{status:"In operation",actionIds:["a1","a2"],documentIds:["doc1"]}];
 const rows=evidenceCoverage(acts,docs,"2026-11-06",controls);
 assert.deepEqual(rows.map(x=>x.state),["evidence-linked","evidence-linked"]);
 assert.deepEqual(rows.map(x=>x.linked),[1,1]);
});
test("retired control evidence does not count towards active coverage",()=>{
 const a={id:"a1",title:"One"},d={id:"d1",status:"Approved",hasAttachment:true,reviewDate:"2027-06-01"};
 const rows=evidenceCoverage([a],[d],"2026-11-06",[{status:"Retired",actionIds:["a1"],documentIds:["d1"]}]);
 assert.equal(rows[0].state,"missing");
});
