import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionEvidence, renewalCandidates } from "../lib/evidence-workflow.mjs";
test("editor cannot approve evidence",()=>{
 const result=canTransitionEvidence({from:"PENDING_REVIEW",to:"APPROVED",actorRole:"EDITOR",reviewerId:"reviewer"});
 assert.equal(result.allowed,false);
});
test("reviewer cannot approve own upload",()=>{
 const result=canTransitionEvidence({from:"PENDING_REVIEW",to:"APPROVED",actorRole:"ADMIN",reviewerId:"same",uploaderId:"same"});
 assert.equal(result.allowed,false);
});
test("authorised independent reviewer can approve",()=>{
 const result=canTransitionEvidence({from:"PENDING_REVIEW",to:"APPROVED",actorRole:"ADMIN",reviewerId:"reviewer",uploaderId:"uploader"});
 assert.equal(result.allowed,true);
});
test("system cannot approve evidence",()=>{
 assert.equal(canTransitionEvidence({from:"PENDING_REVIEW",to:"APPROVED",actorRole:"SYSTEM",reviewerId:"system"}).allowed,false);
});
test("renewal candidates are limited to expiry window",()=>{
 const docs=[{id:"soon",expiresOn:"2026-11-10",reviewStatus:"APPROVED"},{id:"later",expiresOn:"2027-01-01",reviewStatus:"APPROVED"}];
 assert.deepEqual(renewalCandidates(docs,"2026-10-27",30).map(x=>x.id),["soon"]);
});
