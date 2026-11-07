import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {authorizeOrganization} from "../lib/server/authorization";
import {saveGeneratedReview,listAiReviewRecords,readAiReviewRecord,updateAiReviewDecision,redactAiReviewContent} from "../lib/server/ai-reviews";
import {reserveAiRequest,DailyLimitError} from "../lib/server/ai-meter";
import {listObligations,createObligation,changeObligationStatus} from "../lib/server/obligation-service";

const draft={
 summary:"This is an illustrative generated summary requiring independent human review.",
 confidence:"limited",findings:[],suggestedActions:[],suggestedAmendments:[],questions:[],
 limitations:["No determination of legal compliance."],scope:"Draft review only",source:null,
 model:"openai/test-model",generatedAt:"2026-11-06T20:00:00.000Z"
};

test("isolated PostgreSQL checks: tenant membership, distinct human review, integrity and quotas",async()=>{
 const suffix=randomUUID().slice(0,10);
 const users=await Promise.all(["creator","checker","outsider","viewer"].map(n=>db.user.create({
  data:{externalId:"demo-"+n+"-"+suffix,email:n+"-"+suffix+"@example.invalid"}
 })));
 const [creator,checker,outsider,viewer]=users;
 const orgA=await db.organization.create({data:{name:"Test organisation A "+suffix}});
 const orgB=await db.organization.create({data:{name:"Test organisation B "+suffix}});
 const orgIds=[orgA.id,orgB.id],userIds=users.map(u=>u.id);
 try{
  await db.membership.createMany({data:[
   {organizationId:orgA.id,userId:creator.id,role:"EDITOR"},
   {organizationId:orgA.id,userId:checker.id,role:"ADMIN"},
   {organizationId:orgA.id,userId:viewer.id,role:"VIEWER"},
   {organizationId:orgB.id,userId:outsider.id,role:"OWNER"}
  ]});
  const creatorCtx=await authorizeOrganization({externalId:creator.externalId},orgA.id,["OWNER","ADMIN","EDITOR"]);
  const reviewerCtx=await authorizeOrganization({externalId:checker.externalId},orgA.id,["OWNER","ADMIN","EDITOR"]);
  const outsiderCtx=await authorizeOrganization({externalId:outsider.externalId},orgB.id,["OWNER","ADMIN","EDITOR"]);
  assert.ok(creatorCtx);assert.ok(reviewerCtx);assert.ok(outsiderCtx);
  assert.equal(await authorizeOrganization({externalId:outsider.externalId},orgA.id,["OWNER","ADMIN","EDITOR"]),null);
  assert.equal(await authorizeOrganization({externalId:viewer.externalId},orgA.id,["OWNER","ADMIN","EDITOR"]),null);
  if(!creatorCtx||!reviewerCtx||!outsiderCtx)throw new Error("Missing test membership");
  const task=await createObligation(creatorCtx,{
   title:"Inspect a fictional supplier record",category:"Internal quality",ownerName:"Operations",
   dueDate:"2026-12-01",notes:"Non-sensitive test record",sourceUrl:"https://www.gov.uk/example"
  });
  assert.equal((await listObligations(creatorCtx)).length,1);
  assert.equal((await listObligations(outsiderCtx)).length,0);
  assert.equal(await changeObligationStatus(outsiderCtx,task.id,"IN_PROGRESS"),null);
  const changedTask=await changeObligationStatus(creatorCtx,task.id,"IN_PROGRESS");
  assert.equal(changedTask?.status,"IN_PROGRESS");
  const concurrentStatuses=await Promise.all([
   changeObligationStatus(creatorCtx,task.id,"OPEN"),
   changeObligationStatus(reviewerCtx,task.id,"IN_PROGRESS")
  ]);
  assert.ok(concurrentStatuses.every(Boolean),"concurrent status writes use bounded serialization retries");
  await assert.rejects(()=>changeObligationStatus(creatorCtx,task.id,"COMPLETE"),/Completion requires independently reviewed evidence/);
  const withException=await changeObligationStatus(creatorCtx,task.id,"COMPLETE",{
   completionRationale:"A reviewer must confirm why the supporting evidence was not available."
  });
  assert.equal(withException?.completionException,true);
  await changeObligationStatus(creatorCtx,task.id,"IN_PROGRESS");
  const review=await saveGeneratedReview(creatorCtx,{requestId:randomUUID(),mode:"document",ai:draft});
  const inboxA=await listAiReviewRecords(creatorCtx),inboxB=await listAiReviewRecords(outsiderCtx);
  assert.equal(inboxA.length,1);assert.equal(inboxA[0].integrityOk,true);assert.equal(inboxB.length,0);
  await assert.rejects(()=>readAiReviewRecord(outsiderCtx,review.id),(e:any)=>e.status===404);
  const read=await readAiReviewRecord(reviewerCtx,review.id);
  assert.equal(read.ai?.summary,draft.summary);assert.equal(read.status,"PENDING_REVIEW");
  await assert.rejects(()=>updateAiReviewDecision(creatorCtx,review.id,{decision:"REVIEWED",version:1,notes:"Creator cannot review their own model-generated draft."}),(e:any)=>e.status===403);
  const changed=await updateAiReviewDecision(reviewerCtx,review.id,{decision:"NEEDS_CHANGES",version:1,notes:"Further investigation of the source quotation is required."});
  assert.equal(changed.status,"NEEDS_CHANGES");assert.equal(changed.version,2);
  await assert.rejects(()=>updateAiReviewDecision(reviewerCtx,review.id,{decision:"REVIEWED",version:1,notes:"Replaying an old review decision must fail safely."}),(e:any)=>e.status===409);
  const audit=await db.auditEvent.findMany({where:{organizationId:orgA.id,entityType:"AiReview"}});
  assert.equal(audit.length,2);
  assert.ok(audit.every(e=>!JSON.stringify(e.details).includes(draft.summary)));
  await reserveAiRequest(creatorCtx,"document");
  await reserveAiRequest(creatorCtx,"change");
  await assert.rejects(()=>reserveAiRequest(creatorCtx,"assistant"),DailyLimitError);
  await reserveAiRequest(reviewerCtx,"assistant");
  await assert.rejects(()=>reserveAiRequest(reviewerCtx,"document"),DailyLimitError);
  const independent=await reserveAiRequest(outsiderCtx,"assistant");
  assert.equal(typeof independent,"string");
  // Simulate unauthorized DB content modification and verify read-side detection.
  await db.aiReview.update({where:{id:review.id},data:{result:{summary:"Tampered"}}});
  await assert.rejects(()=>readAiReviewRecord(reviewerCtx,review.id),(e:any)=>e.status===409);
  await assert.rejects(()=>redactAiReviewContent(creatorCtx,review.id,2),(e:any)=>e.status===409);
  // Repair the deliberately tampered test record to exercise the redaction path.
  await db.aiReview.update({where:{id:review.id},data:{result:draft}});
  await assert.rejects(()=>redactAiReviewContent(outsiderCtx,review.id,2),(e:any)=>e.status===404);
  await assert.rejects(()=>redactAiReviewContent(creatorCtx,review.id,1),(e:any)=>e.status===409);
  const redaction=await redactAiReviewContent(creatorCtx,review.id,2);
  assert.equal(redaction.status,"REDACTED");
  const after=await readAiReviewRecord(creatorCtx,review.id);
  assert.equal(after.status,"REDACTED");
  assert.equal(after.ai?.redacted,true);
  assert.equal(after.ai?.summary,undefined);
  assert.equal(after.reviewerNotes,"");
  await assert.rejects(()=>redactAiReviewContent(creatorCtx,review.id,3),(e:any)=>e.status===409);
  await assert.rejects(()=>updateAiReviewDecision(reviewerCtx,review.id,{decision:"REVIEWED",version:3,notes:"This was redacted so it cannot be reviewed."}),(e:any)=>e.status===409);
 }finally{
  await db.aiDailyUsage.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.obligation.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.auditEvent.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.aiReview.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.membership.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.organization.deleteMany({where:{id:{in:orgIds}}});
  await db.user.deleteMany({where:{id:{in:userIds}}});
 }
});
