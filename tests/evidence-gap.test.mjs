import test from "node:test";
import assert from "node:assert/strict";
import {assessEvidenceGap} from "../lib/evidence-gap.mjs";
const today="2026-10-30";
test("supplier missing required categories produces review finding",()=>{
 const r=assessEvidenceGap({moduleId:"suppliers",documents:[],today});
 assert.equal(r.overall,"REVIEW_REQUIRED");assert.equal(r.findings.length,2);
});
test("unapproved metadata never counts as accepted evidence",()=>{
 const r=assessEvidenceGap({moduleId:"licences",documents:[{category:"Licence",review_status:"DRAFT"}],today});
 assert.equal(r.findings[0].status,"REVIEW_REQUIRED");
});
test("expired approved document is not current evidence",()=>{
 const r=assessEvidenceGap({moduleId:"licences",documents:[{category:"Licence",review_status:"APPROVED",expires_on:"2026-10-01"}],today});
 assert.equal(r.findings[0].status,"EXPIRED_OR_REVIEW_REQUIRED");
});
test("unconfigured module never claims compliance",()=>{
 const r=assessEvidenceGap({moduleId:"unknown",documents:[],today});
 assert.equal(r.overall,"NOT_CONFIGURED");
});
