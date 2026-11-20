import test from "node:test";
import assert from "node:assert/strict";
import {newSopDraft} from "../lib/sop-draft";
import {buildSopDocument} from "../lib/server/sop-document";
import {createEvidence,reviewEvidence,downloadEvidence} from "../lib/server/evidence-service";
import {createPolicy,policyDetail} from "../lib/server/policy-service";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";

test("an exported SOP reaches independent policy review only through its own organisation's scanned and reviewed bytes",async()=>{
  const x=await assuranceFixture();
  try{
    const draft={...newSopDraft("Staff offboarding"),reference:"HR-01",owner:"Fixture HR team"};
    const doc=await buildSopDocument(draft);
    const options={storage:x.store,scan:async()=>({status:"CLEAN" as const,engine:"test scanner"}),reuseExactUpload:true};
    const uploads=await Promise.all([createEvidence(x.ed,x.task.id,doc.filename,doc.bytes,options),createEvidence(x.ed,x.task.id,doc.filename,doc.bytes,options)]);
    const [evidence,replayed]=uploads;
    assert.equal(evidence.id,replayed.id);
    const input={title:draft.title,summary:"Staff access removal procedure prepared in the SOP builder.",evidenceId:evidence.id};
    assert.equal(evidence.reviewStatus,"PENDING_REVIEW");
    await assert.rejects(createPolicy(x.o,input),rejects(409));
    await reviewEvidence(x.ad,evidence.id,{decision:"APPROVED",version:evidence.reviewVersion,notes:"Independently reviewed the fictional Word draft and recorded its scope."},x.store);
    await assert.rejects(createPolicy(x.out,input),rejects(409));
    const saved=await createPolicy(x.o,input),detail=await policyDetail(x.o,saved.id);
    assert.equal(detail.revisions[0].status,"DRAFT");
    assert.equal(detail.revisions[0].file.sha256,evidence.sha256);
    const same=await createEvidence(x.ed,x.task.id,doc.filename,doc.bytes,options);
    assert.equal(same.id,evidence.id);assert.equal(same.reviewStatus,"APPROVED");
    const retained=await downloadEvidence(x.o,evidence.id,x.store);
    assert.deepEqual(Buffer.from(retained.bytes),doc.bytes);
  }finally{await x.cleanup();}
});
