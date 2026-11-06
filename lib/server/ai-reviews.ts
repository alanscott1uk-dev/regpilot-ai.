import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {Prisma} from "@prisma/client";
import {reviewContentHash,reviewOutputForStorage,stableReviewId,validateReviewDecision,ReviewPolicyError} from "../ai/review-policy.mjs";

export class ReviewStoreError extends Error {
 status:number;
 constructor(message:string,status:number){super(message);this.name="ReviewStoreError";this.status=status;}
}

export async function saveGeneratedReview(ctx:AuthorizedContext,input:{requestId:string;mode:string;ai:unknown}){
 if(!["OWNER","ADMIN","EDITOR"].includes(ctx.role))throw new ReviewStoreError("Cannot submit a review",403);
 if(!stableReviewId(input.requestId))throw new ReviewStoreError("Invalid request ID",400);
 const value=reviewOutputForStorage(input.ai);
 const digest=reviewContentHash(value);
 const source=value.source;
 const sourceUrl=source&&typeof source==="object"&&typeof source.url==="string"?source.url:null;
 return db.$transaction(async tx=>{
  const record=await tx.aiReview.create({data:{
   organizationId:ctx.organizationId,createdById:ctx.userId,
   requestId:input.requestId,mode:input.mode,modelId:String(value.model||"unknown").slice(0,90),
   sourceUrl,result:value as Prisma.InputJsonValue,resultSha256:digest
  },select:{id:true,status:true,version:true,createdAt:true}});
  await tx.auditEvent.create({data:{
   organizationId:ctx.organizationId,actorId:ctx.userId,action:"ai.review_draft_saved",entityType:"AiReview",entityId:record.id,
   details:{requestId:input.requestId,mode:input.mode,sha256:digest}
  }});
  return record;
 },{isolationLevel:"Serializable"});
}

function displayReview(record:any,includeResult:boolean){
 const source=record.result&&typeof record.result==="object"&&!Array.isArray(record.result)?record.result:null;
 return {
  id:record.id,organizationId:record.organizationId,createdById:record.createdById,createdAt:record.createdAt,
  requestId:record.requestId,mode:record.mode,modelId:record.modelId,sourceUrl:record.sourceUrl,
  status:record.status,version:record.version,reviewerId:record.reviewerId,reviewerNotes:record.reviewerNotes,
  reviewedAt:record.reviewedAt,
  summary:typeof source?.summary==="string"?source.summary.slice(0,1300):"",
  ...(includeResult?{ai:source,sha256:record.resultSha256}:{})
 };
}
export async function listAiReviewRecords(ctx:AuthorizedContext){
 const records=await db.aiReview.findMany({
  where:{organizationId:ctx.organizationId},
  orderBy:{createdAt:"desc"},take:50
 });
 return records.map(r=>({...displayReview(r,false),integrityOk:reviewContentHash(r.result)===r.resultSha256}));
}
export async function readAiReviewRecord(ctx:AuthorizedContext,id:string){
 if(!stableReviewId(id))throw new ReviewStoreError("Invalid review ID",400);
 const record=await db.aiReview.findFirst({where:{id,organizationId:ctx.organizationId}});
 if(!record)throw new ReviewStoreError("Review not found",404);
 if(reviewContentHash(record.result)!==record.resultSha256)throw new ReviewStoreError("Stored AI output integrity check failed",409);
 return displayReview(record,true);
}
export async function updateAiReviewDecision(ctx:AuthorizedContext,id:string,raw:unknown){
 if(!stableReviewId(id))throw new ReviewStoreError("Invalid review ID",400);
 return db.$transaction(async tx=>{
  const found=await tx.aiReview.findFirst({where:{id,organizationId:ctx.organizationId},
   select:{id:true,createdById:true,status:true,version:true,resultSha256:true,result:true}});
  if(!found)throw new ReviewStoreError("Review not found",404);
  if(reviewContentHash(found.result)!==found.resultSha256)throw new ReviewStoreError("Stored AI output integrity check failed",409);
  const decision=validateReviewDecision(raw,ctx,found.createdById);
  if(found.status!=="PENDING_REVIEW")throw new ReviewStoreError("This AI review has already been checked",409);
  const changed=await tx.aiReview.updateMany({
   where:{id,organizationId:ctx.organizationId,status:"PENDING_REVIEW",version:decision.version},
   data:{status:decision.decision as "REVIEWED"|"NEEDS_CHANGES",reviewerId:ctx.userId,reviewerNotes:decision.notes,reviewedAt:new Date(),version:{increment:1}}
  });
  if(changed.count!==1)throw new ReviewStoreError("Review updated by someone else; refresh the record",409);
  await tx.auditEvent.create({data:{
   organizationId:ctx.organizationId,actorId:ctx.userId,action:"ai.review_human_decision",entityType:"AiReview",entityId:id,
   details:{decision:decision.decision,previousStatus:"PENDING_REVIEW",version:decision.version+1,resultSha256:found.resultSha256}
  }});
  const record=await tx.aiReview.findFirstOrThrow({where:{id,organizationId:ctx.organizationId}});
  return displayReview(record,true);
 },{isolationLevel:"Serializable"});
}

/** Removes generated content from the active review record without deleting audit provenance.
 * Not a GDPR end-to-end erasure procedure: backups, external model data and audit metadata
 * have separate retention controls, which are not implemented yet.
 */
export async function redactAiReviewContent(ctx:AuthorizedContext,id:string,version:number){
 if(!stableReviewId(id))throw new ReviewStoreError("Invalid review ID",400);
 if(!Number.isInteger(version)||version<1)throw new ReviewStoreError("Invalid review version",400);
 return db.$transaction(async tx=>{
  const existing=await tx.aiReview.findFirst({
   where:{id,organizationId:ctx.organizationId},
   select:{id:true,createdById:true,status:true,version:true,result:true,resultSha256:true}
  });
  if(!existing)throw new ReviewStoreError("Review not found",404);
  if(ctx.userId!==existing.createdById&&!["OWNER","ADMIN"].includes(ctx.role))
   throw new ReviewStoreError("Only the creator or an administrator can redact this draft",403);
  if(existing.status==="REDACTED")throw new ReviewStoreError("Review content was already redacted",409);
  if(existing.version!==version)throw new ReviewStoreError("Review was updated; refresh the record",409);
  if(reviewContentHash(existing.result)!==existing.resultSha256)
   throw new ReviewStoreError("Review content integrity check failed",409);
  const marker={redacted:true,message:"Generated AI content removed from active storage"};
  const nextHash=reviewContentHash(marker);
  const changed=await tx.aiReview.updateMany({
   where:{id,organizationId:ctx.organizationId,version,status:{not:"REDACTED"}},
   data:{result:marker,resultSha256:nextHash,status:"REDACTED",version:{increment:1},
     sourceUrl:null,reviewerNotes:"",reviewerId:null,reviewedAt:null}
  });
  if(changed.count!==1)throw new ReviewStoreError("Review was changed; refresh it",409);
  await tx.auditEvent.create({
   data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"ai.review_content_redacted",
    entityType:"AiReview",entityId:id,
    details:{previousContentSha256:existing.resultSha256,redactedContentSha256:nextHash,
      reviewVersion:version+1,reason:"user_requested_data_minimisation"}}
  });
  return {id,status:"REDACTED",version:version+1,contentRedacted:true};
 },{isolationLevel:"Serializable"});
}
