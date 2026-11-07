import {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {policyDraftSchema,policyActionSchema,acknowledgementSchema,WORKFLOW_LIMITS} from "../assurance-workflows";
import {reviewedFileSchema,reviewedFiles,assertReviewedFiles,verifyReviewedBytes,futureDate,type ReviewedFile} from "./reviewed-files";
import {downloadEvidence} from "./evidence-service";
import type {EvidenceObjectStore} from "./evidence-storage";
import type {z} from "zod";
const org=(ctx:AuthorizedContext)=>({organizationId:ctx.organizationId});
async function event(tx:Prisma.TransactionClient,ctx:AuthorizedContext,action:string,id:string,details:Prisma.InputJsonValue={}){
 await tx.auditEvent.create({data:{...org(ctx),actorId:ctx.userId,action:"policy."+action,entityType:"Policy",entityId:id,details}});
}
function fileOf(r:{file:Prisma.JsonValue;fileHash:string}){
 const file=reviewedFileSchema.parse(r.file);
 if(hashValue(file)!==r.fileHash)throw new IntelligenceError("Policy file record needs administrator review",409);return file;
}
async function available(tx:Prisma.TransactionClient,ctx:AuthorizedContext,file:ReviewedFile){
 try{await assertReviewedFiles(tx,ctx.organizationId,[file]);return true;}catch(e){if(e instanceof IntelligenceError)return false;throw e;}
}
async function audience(tx:Prisma.TransactionClient,ctx:AuthorizedContext,ids:string[]){
 const members=await tx.membership.findMany({where:{...org(ctx),userId:{in:ids}},select:{userId:true,user:{select:{email:true}}}});
 if(members.length!==ids.length||members.some(m=>!allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)))throw new IntelligenceError("Choose current approved team members",409);
}
export async function policyWorkspace(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);
 const [policies,members,evidence]=await Promise.all([
  tx.policy.findMany({where:org(ctx),orderBy:{createdAt:"desc"},take:WORKFLOW_LIMITS.policies,include:{revisions:{orderBy:{number:"desc"},take:1,select:{id:true,number:true,status:true}}}}),
  tx.membership.findMany({where:org(ctx),select:{role:true,user:{select:{id:true,email:true}}},orderBy:{userId:"asc"},take:100}),
  tx.evidence.findMany({where:{...org(ctx),scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true},orderBy:{createdAt:"desc"},take:200})
 ]);return {policies,members,evidence};
});}
export async function createPolicy(ctx:AuthorizedContext,input:unknown){
 const d=policyDraftSchema.parse(input);return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  if(await tx.policy.count({where:org(ctx)})>=WORKFLOW_LIMITS.policies)throw new IntelligenceError("Policy limit reached",409);
  const [file]=await reviewedFiles(tx,ctx.organizationId,[d.evidenceId]);
  const p=await tx.policy.create({data:{...org(ctx),title:d.title}});
  await tx.policyRevision.create({data:{...org(ctx),policyId:p.id,number:1,summary:d.summary,file,fileHash:hashValue(file),createdById:ctx.userId}});
  await event(tx,ctx,"draft_created",p.id);return p;
 });
}
export async function policyDetail(ctx:AuthorizedContext,id:string,revisionId?:string){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);
 const p=await tx.policy.findFirst({where:{id,...org(ctx)}});
 if(!p)throw new IntelligenceError("Policy not found",404);
 const rows=await tx.policyRevision.findMany({where:{policyId:id,...org(ctx)},orderBy:{number:"desc"},take:WORKFLOW_LIMITS.revisions});
 const selected=revisionId?rows.find(r=>r.id===revisionId):rows.find(r=>r.number===p.currentRevision)||rows[0];
 if(!selected)throw new IntelligenceError("Policy version not found",404);
 const revisions=await Promise.all(rows.map(async r=>({id:r.id,number:r.number,summary:r.summary,status:r.status,version:r.version,createdById:r.createdById,reviewerId:r.reviewerId,reviewNotes:r.reviewNotes,publishedAt:r.publishedAt,file:fileOf(r),available:await available(tx,ctx,fileOf(r))})));
 const assignments=await tx.policyAssignment.findMany({where:{...org(ctx),revisionId:selected.id},orderBy:{createdAt:"asc"},take:WORKFLOW_LIMITS.audience,select:{id:true,userId:true,dueDate:true,status:true,openedAt:true,acknowledgedAt:true,acknowledgedHash:true,user:{select:{email:true}}}});
 return {policy:p,revisions,displayRevision:selected.id,assignments};
});}
type Publish=Extract<z.infer<typeof policyActionSchema>,{action:"PUBLISH"}>;
async function canPublish(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string,d:Publish){
 await requireMember(tx,ctx,ADMIN);
 const p=await tx.policy.findFirst({where:{id,...org(ctx)}});
 const r=await tx.policyRevision.findFirst({where:{policyId:id,...org(ctx)},orderBy:{number:"desc"}});
 if(!p||!p.active||p.version!==d.version||!r||r.id!==d.revisionId||r.version!==d.revisionVersion||r.status!=="DRAFT")throw new IntelligenceError("Policy changed; refresh before publishing",409);
 const file=fileOf(r);
 if(r.createdById===ctx.userId||file.uploadedById===ctx.userId)throw new IntelligenceError("A different administrator must approve this policy",403);
 await assertReviewedFiles(tx,ctx.organizationId,[file]);await audience(tx,ctx,d.userIds);futureDate(d.dueDate);
 return {p,r,file};
}
export async function changePolicy(ctx:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){
 const d=policyActionSchema.parse(input);
 if(d.action==="PUBLISH"){
  const before=await transaction(ctx,tx=>canPublish(tx,ctx,id,d));await verifyReviewedBytes(ctx,[before.file],store);
  return transaction(ctx,async tx=>{
   const {p,r,file}=await canPublish(tx,ctx,id,d);if(hashValue(file)!==hashValue(before.file))throw new IntelligenceError("Policy evidence changed",409);
   await tx.policyRevision.updateMany({where:{...org(ctx),policyId:id,status:"PUBLISHED"},data:{status:"SUPERSEDED",version:{increment:1}}});
   await tx.policyAssignment.updateMany({where:{...org(ctx),status:"PENDING",revision:{policyId:id}},data:{status:"SUPERSEDED",version:{increment:1}}});
   await tx.policyRevision.update({where:{id:r.id},data:{status:"PUBLISHED",reviewerId:ctx.userId,reviewNotes:d.notes,publishedAt:new Date(),version:{increment:1}}});
   await tx.policy.update({where:{id:p.id},data:{currentRevision:r.number,version:{increment:1}}});
   await tx.policyAssignment.createMany({data:d.userIds.map(userId=>({...org(ctx),revisionId:r.id,userId,dueDate:futureDate(d.dueDate)}))});
   await event(tx,ctx,"published",id,{revisionId:r.id,number:r.number,assigned:d.userIds.length,fileHash:r.fileHash});
   return {id,number:r.number,assigned:d.userIds.length};
  });
 }
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);const p=await tx.policy.findFirst({where:{id,...org(ctx)}});
  if(!p||!p.active||p.version!==d.version)throw new IntelligenceError("Policy changed; refresh before continuing",409);
  if(d.action==="WITHDRAW"){
   await tx.policy.update({where:{id},data:{active:false,version:{increment:1}}});
   await tx.policyAssignment.updateMany({where:{...org(ctx),status:"PENDING",revision:{policyId:id}},data:{status:"REVOKED",version:{increment:1}}});
   await event(tx,ctx,"withdrawn",id);return {id,active:false};
  }
  if(d.action==="REVISE"){
   const latest=await tx.policyRevision.findFirst({where:{...org(ctx),policyId:id},orderBy:{number:"desc"}});
   if(!latest||latest.number>=WORKFLOW_LIMITS.revisions)throw new IntelligenceError("Policy version limit reached",409);
   const [file]=await reviewedFiles(tx,ctx.organizationId,[d.evidenceId]);
   await tx.policyRevision.updateMany({where:{...org(ctx),policyId:id,status:"DRAFT"},data:{status:"SUPERSEDED",version:{increment:1}}});
   const revision=await tx.policyRevision.create({data:{...org(ctx),policyId:id,number:latest.number+1,summary:d.summary,file,fileHash:hashValue(file),createdById:ctx.userId}});
   await tx.policy.update({where:{id},data:{version:{increment:1}}});await event(tx,ctx,"revised",id,{revisionId:revision.id});return {id,revisionId:revision.id};
  }
  const r=await tx.policyRevision.findFirst({where:{...org(ctx),policyId:id,number:p.currentRevision,status:"PUBLISHED"}});
  if(!r)throw new IntelligenceError("Publish a policy before assigning it",409);
  await assertReviewedFiles(tx,ctx.organizationId,[fileOf(r)]);await audience(tx,ctx,d.userIds);const dueDate=futureDate(d.dueDate);
  const existing=await tx.policyAssignment.findMany({where:{...org(ctx),revisionId:r.id},select:{userId:true,status:true}});
  if(existing.some(a=>a.status==="REVOKED"&&d.userIds.includes(a.userId)))throw new IntelligenceError("A revoked reader needs a new policy version before reassignment",409);
  const missing=d.userIds.filter(userId=>!existing.some(a=>a.userId===userId));
  if(existing.length+missing.length>WORKFLOW_LIMITS.audience)throw new IntelligenceError("This policy version has reached its reader limit",409);
  await tx.policyAssignment.createMany({data:missing.map(userId=>({...org(ctx),revisionId:r.id,userId,dueDate})),skipDuplicates:true});
  await event(tx,ctx,"assigned",id,{revisionId:r.id,added:missing.length});return {id,added:missing.length};
 });
}
export async function policyInbox(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx);
 const rows=await tx.policyAssignment.findMany({where:{...org(ctx),userId:ctx.userId,status:{in:["PENDING","ACKNOWLEDGED"]},revision:{status:"PUBLISHED",policy:{active:true}}},include:{revision:{include:{policy:true}}},orderBy:{dueDate:"asc"},take:100});
 return Promise.all(rows.filter(a=>a.revision.number===a.revision.policy.currentRevision).map(async a=>{
  const file=fileOf(a.revision);return {id:a.id,version:a.version,title:a.revision.policy.title,number:a.revision.number,summary:a.revision.summary,dueDate:a.dueDate,status:a.status,openedAt:a.openedAt,acknowledgedAt:a.acknowledgedAt,fileHash:a.revision.fileHash,sha256:file.sha256,filename:file.filename,available:await available(tx,ctx,file)};
 }));
});}
async function assigned(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 await requireMember(tx,ctx);
 const a=await tx.policyAssignment.findFirst({where:{id,...org(ctx),userId:ctx.userId,status:{in:["PENDING","ACKNOWLEDGED"]}},include:{revision:{include:{policy:true}}});
 if(!a||!a.revision.policy.active||a.revision.status!=="PUBLISHED"||a.revision.number!==a.revision.policy.currentRevision)throw new IntelligenceError("Policy assignment no longer available",404);
 const file=fileOf(a.revision);await assertReviewedFiles(tx,ctx.organizationId,[file]);return {a,file};
}
export async function openAssignedPolicy(ctx:AuthorizedContext,id:string,store?:EvidenceObjectStore){
 const before=await transaction(ctx,tx=>assigned(tx,ctx,id));
 const result=await downloadEvidence(ctx,before.file.id,store);
 if(result.sha256!==before.file.sha256)throw new IntelligenceError("Policy file changed",409);
 await transaction(ctx,async tx=>{
  const after=await assigned(tx,ctx,id);
  if(after.a.version!==before.a.version||after.a.revision.fileHash!==before.a.revision.fileHash)throw new IntelligenceError("Policy assignment changed during download",409);
  if(!after.a.openedAt)await tx.policyAssignment.update({where:{id},data:{openedAt:new Date()}});
  await event(tx,ctx,"opened",after.a.revision.policyId,{assignmentId:id,revisionId:after.a.revisionId});
 });return result;
}
export async function acknowledgePolicy(ctx:AuthorizedContext,id:string,input:unknown){
 const d=acknowledgementSchema.parse(input);return transaction(ctx,async tx=>{
  const {a}=await assigned(tx,ctx,id);
  if(a.status!=="PENDING"||a.version!==d.version||a.revision.fileHash!==d.fileHash||!a.openedAt)throw new IntelligenceError("Open the current policy and refresh before acknowledging",409);
  const saved=await tx.policyAssignment.update({where:{id},data:{status:"ACKNOWLEDGED",acknowledgedAt:new Date(),acknowledgedHash:d.fileHash,version:{increment:1}}});
  await event(tx,ctx,"acknowledged",a.revision.policyId,{assignmentId:id,revisionId:a.revisionId,fileHash:d.fileHash});return {id,status:saved.status,acknowledgedAt:saved.acknowledgedAt};
 });
}
