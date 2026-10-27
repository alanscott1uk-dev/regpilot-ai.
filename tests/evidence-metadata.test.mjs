import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidenceMetadata, linkedEvidence, evidenceCounts, evidenceNeedsAttention } from "../lib/evidence-metadata.mjs";
const record = {
 id:"doc-1",organizationId:"org-a",filename:"insurance.pdf",category:"Certificate",
 reviewStatus:"PENDING_REVIEW",version:1,actionIds:["act-1","act-2"],
 expiresOn:"2026-11-30",reviewOn:"2026-11-01"
};
test("evidence supports more than one action in its own organisation",()=>{
 assert.equal(linkedEvidence([record],"org-a","act-2").length,1);
 assert.equal(linkedEvidence([record],"org-b","act-2").length,0);
 assert.equal(linkedEvidence([record],"org-a","act-3").length,0);
});
test("invalid review status, date and version rejected",()=>{
 assert.equal(validateEvidenceMetadata(record),true);
 assert.equal(validateEvidenceMetadata({...record,reviewStatus:"COMPLETE"}),false);
 assert.equal(validateEvidenceMetadata({...record,expiresOn:"2026-02-30"}),false);
 assert.equal(validateEvidenceMetadata({...record,version:0}),false);
});
test("pending evidence never counts as approved",()=>{
 const count=evidenceCounts([record],"org-a","2026-11-02");
 assert.equal(count.pending,1);assert.equal(count.approved,0);
 assert.equal(count.attention,1);
});
test("approved evidence still needs attention after expiry",()=>{
 assert.equal(evidenceNeedsAttention({...record,reviewStatus:"APPROVED"},"2026-12-01"),true);
});
