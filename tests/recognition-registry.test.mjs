import test from "node:test";
import assert from "node:assert/strict";
import {RECOGNITION_TRACKS,isRecognitionTrack,buildRecognitionRegister,evaluateRecognitionEvidence,recognitionPublicStatus} from "../lib/recognition/registry.mjs";
const NOW="2026-11-11T12:00:00Z";
const proof={
 issuer:"Independent audit provider",reference:"DEMO-2026-0001",scope:"Fictional UK AIMS only",
 documentHash:"a".repeat(64),issuedAt:"2026-10-01",expiresAt:"2027-10-01",
 reviewedAt:"2026-10-02",reviewerId:"independent-auditor",recordedById:"creator",
 verificationUrl:"https://www.bsigroup.com/en-GB/",verificationSource:"INDEPENDENT_ISSUER",
 assuranceApproved:true
};
test("every recognition route starts without an awarded badge or MHRA endorsement",()=>{
 const register=buildRecognitionRegister({},NOW);
 assert.equal(register.records.length,7);
 assert.equal(register.verified,0);assert.equal(register.pending,7);
 assert.ok(register.records.every(r=>r.status==="NOT_VERIFIED"&&!r.isCertified&&!r.issuer&&!r.verificationUrl));
 assert.match(register.notice,/does not claim MHRA/);
 assert.equal(new Set(RECOGNITION_TRACKS.map(t=>t.id)).size,RECOGNITION_TRACKS.length);
 assert.equal(isRecognitionTrack("mhra-advice"),true);
 assert.equal(isRecognitionTrack("unknown-service"),false);
});
test("an issuer domain alone never constitutes evidence",()=>{
 assert.equal(evaluateRecognitionEvidence("iso-42001",null,NOW).valid,false);
 assert.equal(evaluateRecognitionEvidence("iso-42001",{verificationUrl:"https://www.bsigroup.com"},NOW).valid,false);
 const self={...proof,verificationSource:"SELF_REPORTED"};
 assert.equal(evaluateRecognitionEvidence("iso-42001",self,NOW).valid,false);
 assert.equal(evaluateRecognitionEvidence("iso-42001",{...proof,reviewerId:proof.recordedById},NOW).valid,false);
 assert.equal(evaluateRecognitionEvidence("iso-42001",{...proof,assuranceApproved:false},NOW).valid,false);
 assert.equal(evaluateRecognitionEvidence("iso-42001",{...proof,verificationUrl:"http://localhost:3000"},NOW).valid,false);
});
test("expired, stale and missing independent certificate evidence cannot produce badges",()=>{
 for(const p of [{...proof,expiresAt:"2026-01-01"},{...proof,expiresAt:undefined},{...proof,reviewedAt:"2026-01-01"},{...proof,issuedAt:"2027-01-01"},{...proof,documentHash:"not-a-digest"}]){
  assert.equal(recognitionPublicStatus("iso-42001",p,NOW).status,"NOT_VERIFIED");
 }
});
test("even accepted external advice and procurement status explicitly disclaim government approval",()=>{
 const advisory=recognitionPublicStatus("mhra-advice",proof,NOW);
 assert.equal(advisory.status,"EXTERNALLY_EVIDENCED");assert.equal(advisory.isCertified,false);
 assert.match(advisory.statusLabel,/not approval/i);
 const procurement=recognitionPublicStatus("gcloud",proof,NOW);
 assert.equal(procurement.isCertified,false);assert.match(procurement.statusLabel,/not endorsement/i);
 const generic=recognitionPublicStatus("iso-42001",proof,NOW);
 assert.equal(generic.isCertified,true);assert.equal(generic.scope,proof.scope);
 assert.equal(recognitionPublicStatus("pharma-validation",proof,NOW).status,"NOT_VERIFIED");
 const customer=recognitionPublicStatus("pharma-validation",{...proof,customerIntendedUse:"Fictional site quality records",validationVersion:"1.0"},NOW);
 assert.equal(customer.status,"EXTERNALLY_EVIDENCED");assert.equal(customer.isCertified,false);
});
