import test from "node:test";
import assert from "node:assert/strict";
import {validateEvidenceCandidate,evidenceObjectKey,evidenceCanBeApproved} from "../lib/evidence-preflight.mjs";
test("accepts a small PDF candidate but does not certify file content",()=>{
 assert.equal(validateEvidenceCandidate({name:"certificate.pdf",size:1200,type:"application/pdf"}).ok,true);
});
test("rejects traversal, oversized and unsupported candidates",()=>{
 for(const item of [
  {name:"../secret.pdf",size:100,type:"application/pdf"},
  {name:"certificate.exe",size:100,type:"application/octet-stream"},
  {name:"certificate.pdf",size:11*1024*1024,type:"application/pdf"},
  {name:"certificate.pdf",size:100,type:"image/png"},
 ]) assert.equal(validateEvidenceCandidate(item).ok,false);
});
test("storage object key uses validated tenant and document identifiers",()=>{
 const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
 assert.equal(evidenceObjectKey({organizationId:a,documentId:b,version:2}),a+"/"+b+"/v2");
 assert.throws(()=>evidenceObjectKey({organizationId:"../../bad",documentId:b,version:1}));
});
test("evidence cannot be approved without independent reviewer, scanning and integrity",()=>{
 const base={uploaded:true,scanned:true,integrityVerified:true,uploadedBy:"alice",reviewedBy:"bob"};
 assert.equal(evidenceCanBeApproved(base),true);
 assert.equal(evidenceCanBeApproved({...base,reviewedBy:"alice"}),false);
 assert.equal(evidenceCanBeApproved({...base,scanned:false}),false);
 assert.equal(evidenceCanBeApproved({...base,integrityVerified:false}),false);
});
