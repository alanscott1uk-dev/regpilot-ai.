import test from "node:test";import assert from "node:assert/strict";
import {validControl,parseControls,controlCoverage,controlSummary} from "../lib/controls.mjs";
const c=(over={})=>({id:"c1",title:"Review supplier files",purpose:"Fictional control",owner:"Quality",status:"In operation",frequency:"Annual",reviewDate:"2027-02-01",actionIds:["a1","a2"],documentIds:["d1"],...over});
const actions=[{id:"a1"},{id:"a2"}];
const documents=[{id:"d1",status:"Approved",hasAttachment:true,reviewDate:"2027-05-01"}];
test("multiple actions share one document control without duplicating evidence",()=>{
 const row=controlCoverage([c()],actions,documents,"2026-11-06")[0];
 assert.equal(row.linkedActions,2);assert.equal(row.linkedDocuments,1);assert.equal(row.approvedFileMetadata,1);assert.equal(row.state,"metadata-linked");
});
test("missing links do not masquerade as confirmed",()=>{
 const row=controlCoverage([c()],actions,[],"2026-11-06")[0];
 assert.equal(row.state,"broken-links");assert.equal(row.missingDocumentLinks,1);
});
test("expired evidence is not counted current",()=>{
 const row=controlCoverage([c()],actions,[{...documents[0],reviewDate:"2026-10-01"}],"2026-11-06")[0];
 assert.equal(row.state,"evidence-unconfirmed");assert.equal(row.approvedFileMetadata,0);
});
test("control review date, not regulatory risk, determines overdue marker",()=>{
 const row=controlCoverage([c({reviewDate:"2026-11-01"})],actions,documents,"2026-11-06")[0];assert.equal(row.state,"review-overdue");assert.equal(controlSummary([row]).reviewOverdue,1);
});
test("retired controls are not flagged as new active work",()=>{
 assert.equal(controlCoverage([c({status:"Retired",reviewDate:"2020-01-01"})],actions,[],"2026-11-06")[0].state,"retired");
});
test("duplicate document links, bad dates and oversized values rejected",()=>{
 assert.equal(validControl(c({documentIds:["d1","d1"]})),false);
 assert.equal(validControl(c({reviewDate:"2026-02-30"})),false);
 assert.equal(validControl(c({title:"x".repeat(161)})),false);
 assert.equal(parseControls(JSON.stringify([c(),c()])).length,1);
});

test("control without an action or scheduled review is not marked fully mapped",()=>{
 const row=controlCoverage([c({actionIds:[],reviewDate:""})],actions,documents,"2026-11-06")[0];
 assert.equal(row.state,"needs-review");assert.ok(row.notes.some(s=>s.includes("Next control review")));
});
