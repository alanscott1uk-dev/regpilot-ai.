import test from "node:test";
import assert from "node:assert/strict";
import {RECOGNITION_TRACKS,isRecognitionTrack,buildRecognitionRegister,evaluateRecognitionEvidence,recognitionPublicStatus} from "../lib/recognition/registry.mjs";
const NOW="2026-11-11T12:00:00Z";
const proof={
 issuer:"Independent audit provider",reference:"DEMO-2026-0001",scope:"Fictional UK AIMS only",
 documentHash:"a".repeat(64),issuedAt:"2026-10-01",expiresAt:"2027-10-01",
 reviewedAt:"2026-10-02",reviewerId:"independent-auditor",recordedById:"creator",
 verificationUrl:"https://www.bsigroup.com/en-GB/",verificationSource:"INDEPENDENT_ISSUER",
 assuranceApproved:true,trackId:"iso-42001",kind:"ISO_CERTIFICATE",issuerConfirmed:true,verificationMethod:"ISSUER_PORTAL",
 certificateNumber:"DEMO-ISSUER-REF",standard:"ISO/IEC 42001"
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
 const advice={...proof,trackId:"mhra-advice",kind:"REGULATOR_ADVICE",issuer:"MHRA",adviceReference:"DEMO-MHRA-REF",
  verificationUrl:"https://www.gov.uk/government/groups/mhra-innovation-office"};
 const advisory=recognitionPublicStatus("mhra-advice",advice,NOW);
 assert.equal(advisory.status,"EXTERNALLY_EVIDENCED");assert.equal(advisory.isCertified,false);
 assert.match(advisory.statusLabel,/not approval/i);
 const gov={...proof,trackId:"gcloud",kind:"PROCUREMENT",issuer:"Government Commercial Agency",
  frameworkListingId:"DEMO-ONLY",verificationUrl:"https://digitalmarketplace.service.gov.uk/"};
 const procurement=recognitionPublicStatus("gcloud",gov,NOW);
 assert.equal(procurement.status,"EXTERNALLY_EVIDENCED");
 assert.equal(procurement.isCertified,false);assert.match(procurement.statusLabel,/not endorsement/i);
 const generic=recognitionPublicStatus("iso-42001",proof,NOW);
 assert.equal(generic.isCertified,true);assert.equal(generic.scope,proof.scope);
 assert.equal(recognitionPublicStatus("pharma-validation",proof,NOW).status,"NOT_VERIFIED");
 const customer=recognitionPublicStatus("pharma-validation",{...proof,trackId:"pharma-validation",kind:"GXP_CUSTOMER",
   publicDisclosureAuthorised:true,customerApprovalReference:"DEMO-QA-REF",
   customerIntendedUse:"Fictional site quality records",validationVersion:"1.0"},NOW);
 assert.equal(customer.status,"EXTERNALLY_EVIDENCED");assert.equal(customer.isCertified,false);
});

test("an unrelated certificate or government information page cannot be substituted for MHRA or G-Cloud approval",()=>{
 const mhraFake={...proof,trackId:"mhra-advice",kind:"REGULATOR_ADVICE",adviceReference:"FICT-REF"};
 assert.equal(evaluateRecognitionEvidence("mhra-advice",mhraFake,NOW).valid,false);
 const gcloudFake={...proof,trackId:"gcloud",kind:"PROCUREMENT",frameworkListingId:"FICT-REF"};
 assert.equal(evaluateRecognitionEvidence("gcloud",gcloudFake,NOW).valid,false);
 const wrongIso={...proof,standard:"ISO/IEC 27001"};
 assert.equal(evaluateRecognitionEvidence("iso-42001",wrongIso,NOW).valid,false);
 assert.equal(evaluateRecognitionEvidence("iso-27001",proof,NOW).valid,false);
 const missingIssuerCheck={...proof,issuerConfirmed:false};
 assert.equal(evaluateRecognitionEvidence("iso-42001",missingIssuerCheck,NOW).valid,false);
});
