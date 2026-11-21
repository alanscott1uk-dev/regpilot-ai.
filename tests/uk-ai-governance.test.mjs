import test from "node:test";
import assert from "node:assert/strict";
import {AI_PURPOSE,AI_DATA_CLASSES,aiBoundarySummary,assessAiUseDeclaration,aiGovernanceAttested,RegulatedUseError} from "../lib/ai/regulated-use.mjs";

const base={purpose:"business-compliance-assistance",dataCategory:"synthetic",recordPurpose:"working-draft",
 humanReviewAcknowledged:true,solelyAutomatedDecision:false,externalProcessingAcknowledged:true};

test("UK pilot AI has explicitly nonclinical intended purpose, no patient or authoritative GxP use",()=>{
 const b=aiBoundarySummary();
 assert.equal(b.purpose,AI_PURPOSE);
 assert.equal(b.regulatedGxpUseValidated,false);
 assert.equal(b.medicalDeviceAuthorised,false);
 assert.ok(b.disallowed.some(x=>/Patient|health records/i.test(x)));
 assert.ok(b.disallowed.some(x=>/GxP/i.test(x)));
 assert.equal(AI_DATA_CLASSES.includes("patient-record"),false);
});

test("working draft with independently reviewed non-sensitive inputs alone is allowed",()=>{
 const result=assessAiUseDeclaration(base);
 assert.equal(result.humanReviewRequired,true);
 assert.equal(result.solelyAutomatedDecision,false);
 assert.equal(assessAiUseDeclaration({...base,dataCategory:"non-sensitive-business"}).dataCategory,"non-sensitive-business");
});

test("reject clinical functionality, patient records, regulated original records and solely automated significant outcomes",()=>{
 for(const changes of [
  {purpose:"clinical-dosing"},{purpose:"employment-decision"},{purpose:"gxp-batch-release"},
  {dataCategory:"special-category"},{dataCategory:"personal-data"},{dataCategory:"patient-health-data"},
  {recordPurpose:"controlled-gxp-original"},{recordPurpose:"pharma-batch-record"},
  {humanReviewAcknowledged:false},{solelyAutomatedDecision:true},{externalProcessingAcknowledged:false}
 ])assert.throws(()=>assessAiUseDeclaration({...base,...changes}),RegulatedUseError);
 for(const missing of ["purpose","dataCategory","recordPurpose","humanReviewAcknowledged","solelyAutomatedDecision","externalProcessingAcknowledged"]){
  const input={...base};delete input[missing];
  assert.throws(()=>assessAiUseDeclaration(input),RegulatedUseError);
 }
});

test("paid AI governance requires three independent explicit approval flags",()=>{
 const all={REGPILOT_AI_PROCESSOR_REVIEWED:"true",REGPILOT_AI_TRANSFER_REVIEWED:"true",REGPILOT_AI_INTENDED_USE_REVIEWED:"true"};
 assert.equal(aiGovernanceAttested({}),false);
 assert.equal(aiGovernanceAttested(all),true);
 for(const flag of Object.keys(all)){
  assert.equal(aiGovernanceAttested({...all,[flag]:"false"}),false);
  assert.equal(aiGovernanceAttested({...all,[flag]:"TRUE"}),false);
  assert.equal(aiGovernanceAttested({...all,[flag]:undefined}),false);
 }
});
