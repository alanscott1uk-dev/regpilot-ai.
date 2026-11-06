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
 return records.map(r=>displayReview(r,false));
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
   select:{id:true,createdById:true,status:true,version:true,resultSha256:true}});
  if(!found)throw new ReviewStoreError("Review not found",404);
  const decision=validateReviewDecision(raw,ctx,found.createdById);
  if(found.status!=="PENDING_REVIEW")throw new ReviewStoreError("This AI review has already been checked",409);
  const changed=await tx.aiReview.updateMany({
   where:{id,organizationId:ctx.organizationId,status:"PENDING_REVIEW",version:decision.version},
   data:{status:decision.decision,reviewerId:ctx.userId,reviewerNotes:decision.notes,reviewedAt:new Date(),version:{increment:1}}
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
