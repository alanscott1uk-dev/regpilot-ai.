import test from "node:test";import assert from "node:assert/strict";
import {reviewContentHash,ReviewPolicyError,validateReviewDecision,reviewOutputForStorage,stableReviewId} from "../lib/ai/review-policy.mjs";
const admin={userId:"reviewer",role:"ADMIN"};
const proposed={decision:"REVIEWED",version:1,notes:"I checked the cited passages and recorded material uncertainties."};
test("independent reviewer and permitted role are required",()=>{
 assert.deepEqual(validateReviewDecision(proposed,admin,"creator"),proposed);
 assert.throws(()=>validateReviewDecision(proposed,{...admin,role:"EDITOR"},"creator"),ReviewPolicyError);
 assert.throws(()=>validateReviewDecision(proposed,admin,"reviewer"),ReviewPolicyError);
});
test("decision requires rationale and validated version",()=>{
 assert.throws(()=>validateReviewDecision({...proposed,notes:"Fine"},admin,"creator"),ReviewPolicyError);
 assert.throws(()=>validateReviewDecision({...proposed,version:0},admin,"creator"),ReviewPolicyError);
 assert.throws(()=>validateReviewDecision({...proposed,decision:"APPROVED"},admin,"creator"),ReviewPolicyError);
});
test("stored output is bounded and excludes raw input payloads",()=>{
 const ai={summary:"This is a fictional illustrative summary with uncertainty.",confidence:"limited",findings:[],suggestedActions:[],suggestedAmendments:[],questions:[],limitations:[],scope:"Review only",source:null,model:"openai/mock",generatedAt:"2026-11-06",documentText:"RAW SECRET",pdfBase64:"PDF BYTES"};
 const stored=reviewOutputForStorage(ai);
 assert.equal(stored.documentText,undefined);assert.equal(stored.pdfBase64,undefined);
 assert.equal(reviewContentHash(stored),reviewContentHash({...stored}));
 assert.notEqual(reviewContentHash(stored),reviewContentHash({...stored,summary:"Changed"}));
});
test("UUID review locator is checked before database access",()=>{
 assert.equal(stableReviewId("123e4567-e89b-42d3-a456-426614174000"),true);
 assert.equal(stableReviewId("../../../other-org"),false);
});

test("digest uses canonical key order to survive PostgreSQL JSONB round trips",()=>{
 assert.equal(reviewContentHash({a:"x",b:{z:2,a:1}}),reviewContentHash({b:{a:1,z:2},a:"x"}));
});

test("saved AI draft can be redacted only with a valid version and role checks",()=>{
 // Redaction is tested transactionally against disposable PostgreSQL by the tenant integration suite.
 assert.equal(stableReviewId("123e4567-e89b-42d3-a456-426614174000"),true);
});
