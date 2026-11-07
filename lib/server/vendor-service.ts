import {vendorAttention,compareVendorSignals} from "../vendor-attention";
import {vendorSignal,vendorSignalSchema,sameVendorSignal} from "./vendor-signals";
import {Prisma,type Vendor,type VendorReview} from "@prisma/client";
import {z} from "zod";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {vendorSchema,vendorReviewSchema,vendorActionSchema,assessmentSchema,vendorAssessmentIssues,WORKFLOW_LIMITS,VENDOR_CRITERIA} from "../assurance-workflows";
import {reviewedFilesSchema,reviewedFiles,assertReviewedFiles,verifyReviewedBytes,futureDate} from "./reviewed-files";
import type {EvidenceObjectStore} from "./evidence-storage";
const org=(ctx:AuthorizedContext)=>({organizationId:ctx.organizationId});
async function event(tx:Prisma.TransactionClient,ctx:AuthorizedContext,action:string,id:string,details:Prisma.InputJsonValue={}){
 await tx.auditEvent.create({data:{...org(ctx),actorId:ctx.userId,action:"vendor."+action,entityType:"Vendor",entityId:id,details}});
}
async function owner(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 const m=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:id}},include:{user:{select:{email:true}}}});
 if(!m||m.role==="VIEWER"||!allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Choose a current colleague who can own follow-up work",409);
 return m.user.email;
}
function snapshot(v:Vendor){return {id:v.id,name:v.name,service:v.service,ownerId:v.ownerId,criticality:v.criticality,dataAccess:v.dataAccess,systemAccess:v.systemAccess,version:v.version,...(v.signalConnectorId?{signalConnectorId:v.signalConnectorId}:{})};}
function reviewHash(r:Pick<VendorReview,"signalSnapshot"|"baselineReviewId"|"vendorSnapshot"|"evidenceManifest"|"assessment"|"recommendation"|"rationale"|"followUpDue"|"validUntil">){
 return hashValue({...(r.signalSnapshot?{signalSnapshot:r.signalSnapshot}:{}),baselineReviewId:r.baselineReviewId,vendorSnapshot:r.vendorSnapshot,evidenceManifest:r.evidenceManifest,assessment:r.assessment,recommendation:r.recommendation,rationale:r.rationale,followUpDue:r.followUpDue.toISOString().slice(0,10),validUntil:r.validUntil.toISOString().slice(0,10)});
}
function content(r:VendorReview){
 if(reviewHash(r)!==r.inputHash)throw new IntelligenceError("Supplier review record needs administrator review",409);
 return {files:reviewedFilesSchema.parse(r.evidenceManifest),assessment:assessmentSchema.parse(r.assessment),signal:r.signalSnapshot?vendorSignalSchema.parse(r.signalSnapshot):null};
}
const expired=(date:Date)=>date.toISOString().slice(0,10)<new Date().toISOString().slice(0,10);
async function reviewState(tx:Prisma.TransactionClient,ctx:AuthorizedContext,v:Vendor,r?:VendorReview|null){
 if(!v.active)return "ARCHIVED";
 if(!r)return "NOT_REVIEWED";
 const parsed=content(r);
 if(r.vendorVersion!==v.version||hashValue(r.vendorSnapshot)!==hashValue(snapshot(v)))return "STALE";
 if(expired(r.validUntil))return "EXPIRED";
 if(v.signalConnectorId){const current=await vendorSignal(tx,ctx.organizationId,v.signalConnectorId);if(!current.current||!current.snapshot||!parsed.signal||!sameVendorSignal(current.snapshot,parsed.signal))return "STALE";}
 if(r.status==="DRAFT"){
  const current=await tx.vendorReview.findFirst({where:{...org(ctx),vendorId:v.id,status:"ACCEPTED"},select:{id:true}});
  if((current?.id||null)!==r.baselineReviewId)return "STALE";
 }
 try{await assertReviewedFiles(tx,ctx.organizationId,parsed.files);}catch(e){if(e instanceof IntelligenceError)return "STALE";throw e;}return "CURRENT";
}
export async function vendorWorkspace(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);
 const [rows,members,evidence,signalConnections]=await Promise.all([
  tx.vendor.findMany({where:org(ctx),include:{owner:{select:{email:true}},reviews:{where:{status:"ACCEPTED"},orderBy:{createdAt:"desc"},take:1}},orderBy:{nextReviewAt:"asc"},take:WORKFLOW_LIMITS.vendors}),
  tx.membership.findMany({where:{...org(ctx),role:{not:"VIEWER"}},select:{role:true,user:{select:{id:true,email:true}}},orderBy:{userId:"asc"},take:100}),
  tx.evidence.findMany({where:{...org(ctx),scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true},orderBy:{createdAt:"desc"},take:200}),
  tx.evidenceConnector.findMany({where:{...org(ctx),provider:"COMPANIES_HOUSE"},select:{id:true,repository:true,enabled:true},take:20})
 ]);
 const vendors=await Promise.all(rows.map(async v=>({id:v.id,name:v.name,service:v.service,active:v.active,version:v.version,criticality:v.criticality,owner:v.owner,nextReviewAt:v.nextReviewAt,recommendation:v.reviews[0]?.recommendation||null,reviewState:await reviewState(tx,ctx,v,v.reviews[0])})));
 return {vendors:vendors.map(v=>({...v,attention:vendorAttention(v)})),members,evidence,signalConnections};
});}
export async function createVendor(ctx:AuthorizedContext,input:unknown){
 const d=vendorSchema.parse(input),nextReviewAt=futureDate(d.nextReview);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);await owner(tx,ctx,d.ownerId);
  if(await tx.vendor.count({where:org(ctx)})>=WORKFLOW_LIMITS.vendors)throw new IntelligenceError("Supplier limit reached",409);
  const {nextReview,...fields}=d;const v=await tx.vendor.create({data:{...org(ctx),...fields,nextReviewAt}});
  await event(tx,ctx,"created",v.id);return v;
 });
}
export async function vendorDetail(ctx:AuthorizedContext,id:string){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);
 const v=await tx.vendor.findFirst({where:{id,...org(ctx)},include:{owner:{select:{email:true}}}});
 if(!v)throw new IntelligenceError("Supplier not found",404);
 const rows=await tx.vendorReview.findMany({where:{...org(ctx),vendorId:id},orderBy:{createdAt:"desc"},take:WORKFLOW_LIMITS.reviews});
 const reviews=await Promise.all(rows.map(async r=>{
  const parsed=content(r),ids=z.array(z.uuid()).max(7).parse(r.followUpTasks);
  const tasks=await tx.obligation.findMany({where:{...org(ctx),id:{in:ids}},select:{id:true,title:true,status:true,assigneeId:true,ownerName:true,dueDate:true,completionException:true}});
  return {id:r.id,version:r.version,status:r.status,createdById:r.createdById,reviewerId:r.reviewerId,createdAt:r.createdAt,reviewedAt:r.reviewedAt,reviewNotes:r.reviewNotes,recommendation:r.recommendation,rationale:r.rationale,followUpDue:r.followUpDue,validUntil:r.validUntil,vendorSnapshot:r.vendorSnapshot,...parsed,tasks,contextCurrent:(await reviewState(tx,ctx,v,r))==="CURRENT"};
 }));
 const signal=v.signalConnectorId?await vendorSignal(tx,ctx.organizationId,v.signalConnectorId):null;const signalTasks=await tx.obligation.findMany({where:{...org(ctx),vendorSignalId:id},select:{id:true,title:true,status:true,ownerName:true,dueDate:true},orderBy:{createdAt:"desc"},take:20});const accepted=rows.find(r=>r.status==="ACCEPTED"),state=await reviewState(tx,ctx,v,accepted);
 return {vendor:v,reviews,signal,signalTasks,reviewState:state,attention:vendorAttention({...v,reviewState:state,recommendation:accepted?.recommendation||null}),signalChanges:compareVendorSignals(signal?.snapshot?.observation||null,accepted?content(accepted).signal?.observation||null:null)};
});}
export async function prepareVendorReview(ctx:AuthorizedContext,id:string,input:unknown){
 const d=vendorReviewSchema.parse(input),followUpDue=futureDate(d.followUpDue),validUntil=futureDate(d.validUntil);
 if(followUpDue>validUntil)throw new IntelligenceError("Follow-up must be due before the review expires");
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const v=await tx.vendor.findFirst({where:{id,...org(ctx)}});
  if(!v||!v.active||v.version!==d.version)throw new IntelligenceError("Supplier changed; refresh before reviewing",409);
  await owner(tx,ctx,v.ownerId);
  const issues=vendorAssessmentIssues(v,d);if(issues.length)throw new IntelligenceError(issues.join("; "));
  if(await tx.vendorReview.count({where:{...org(ctx),vendorId:id}})>=WORKFLOW_LIMITS.reviews)throw new IntelligenceError("Supplier review limit reached",409);
  const files=await reviewedFiles(tx,ctx.organizationId,d.evidenceIds);
  const previous=await tx.vendorReview.findFirst({where:{...org(ctx),vendorId:id,status:"ACCEPTED"},select:{id:true}});
  const signal=v.signalConnectorId?await vendorSignal(tx,ctx.organizationId,v.signalConnectorId):null;
  if(signal&&(!signal.current||!signal.snapshot||d.signalRunId!==signal.snapshot.runId||d.signalReviewed!==true))throw new IntelligenceError("Refresh and explicitly review the current company-register observation",409);
  if(signal?.snapshot?.observation.checks.some(c=>c.status!=="PASS")&&d.recommendation==="APPROVE")throw new IntelligenceError("Address the register warnings or unknowns in a conditional/reject recommendation",409);
  const record={signalSnapshot:signal?.snapshot||null,baselineReviewId:previous?.id||null,vendorSnapshot:snapshot(v),evidenceManifest:files,assessment:d.assessment,recommendation:d.recommendation,rationale:d.rationale,followUpDue,validUntil};
  const saved=await tx.vendorReview.create({data:{...org(ctx),vendorId:id,vendorVersion:v.version,createdById:ctx.userId,...record,signalSnapshot:record.signalSnapshot||Prisma.DbNull,inputHash:reviewHash(record)}});
  await event(tx,ctx,"review_prepared",id,{reviewId:saved.id,recommendation:d.recommendation});return {id:saved.id,vendorId:id};
 });
}
type Accept=Extract<z.infer<typeof vendorActionSchema>,{action:"ACCEPT"}>;
async function canAccept(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string,d:Accept){
 await requireMember(tx,ctx,ADMIN);
 const v=await tx.vendor.findFirst({where:{id,...org(ctx)}});
 const r=await tx.vendorReview.findFirst({where:{id:d.reviewId,...org(ctx),vendorId:id}});
 if(!v||!v.active||!r||r.status!=="DRAFT"||r.version!==d.version||await reviewState(tx,ctx,v,r)!=="CURRENT"||expired(r.followUpDue))throw new IntelligenceError("Review or supplier context changed; prepare a new review",409);
 const parsed=content(r);
 if(r.createdById===ctx.userId||parsed.files.some(f=>f.uploadedById===ctx.userId))throw new IntelligenceError("A different administrator must sign off this supplier review",403);
 const email=await owner(tx,ctx,v.ownerId);return {v,r,...parsed,email};
}
export async function changeVendor(ctx:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){
 const d=vendorActionSchema.parse(input);
 if(d.action==="ACCEPT"){
  const before=await transaction(ctx,tx=>canAccept(tx,ctx,id,d));await verifyReviewedBytes(ctx,before.files,store);
  return transaction(ctx,async tx=>{
   const {v,r,assessment,email,signal}=await canAccept(tx,ctx,id,d);
   if(r.inputHash!==before.r.inputHash)throw new IntelligenceError("Review changed during verification",409);
   const work:Array<{key:string;title:string;notes:string}>=assessment.filter(c=>c.outcome==="GAP").map(c=>({key:c.id,title:VENDOR_CRITERIA.find(x=>x.id===c.id)!.label,notes:c.rationale}));
   if(r.recommendation==="CONDITIONAL"&&signal?.observation.checks.some(c=>c.status!=="PASS"))work.push({key:"register-conditions",title:"Resolve company-register review conditions",notes:r.rationale});
   if(r.recommendation==="REJECT")work.push({key:"decision",title:"Decide next steps after rejected supplier review",notes:r.rationale});
   const tasks:string[]=[];
   for(const item of work){
    const automationKey=hashValue({kind:"vendor-review-gap",reviewId:r.id,criterion:item.key});
    const existing=await tx.obligation.findFirst({where:{...org(ctx),automationKey},select:{id:true}});
    const task=existing||await tx.obligation.create({data:{...org(ctx),automationKey,title:(v.name+": "+item.title).slice(0,160),notes:item.notes.slice(0,500),category:"Vendor assurance",ownerName:email,assigneeId:v.ownerId,dueDate:r.followUpDue}});
    tasks.push(task.id);
   }
   await tx.vendorReview.updateMany({where:{...org(ctx),vendorId:id,status:"ACCEPTED"},data:{status:"SUPERSEDED",version:{increment:1}}});
   await tx.vendorReview.update({where:{id:r.id},data:{status:"ACCEPTED",reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),followUpTasks:tasks,version:{increment:1}}});
   await tx.vendor.update({where:{id},data:{nextReviewAt:r.validUntil}});
   if(v.signalConnectorId)await tx.obligation.updateMany({where:{...org(ctx),vendorSignalId:id,status:{not:"COMPLETE"}},data:{status:"COMPLETE",completedAt:new Date(),completionException:false,completionRationale:"Public register observation independently considered in supplier review "+r.id+"; the accepted recommendation and any follow-up remain recorded."}});
   await event(tx,ctx,"review_accepted",id,{reviewId:r.id,recommendation:r.recommendation,tasks});return {id,reviewId:r.id,tasks};
  });
 }
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const v=await tx.vendor.findFirst({where:{id,...org(ctx)}});
  if(!v||!v.active)throw new IntelligenceError("Supplier no longer available",404);
  if(d.action==="RETURN"){
   const r=await tx.vendorReview.findFirst({where:{id:d.reviewId,...org(ctx),vendorId:id}});
   if(!r||r.version!==d.version||r.status!=="DRAFT")throw new IntelligenceError("Review changed; refresh before continuing",409);
   if(r.createdById===ctx.userId)throw new IntelligenceError("A different administrator must review this draft",403);
   await tx.vendorReview.update({where:{id:r.id},data:{status:"RETURNED",reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});
   await event(tx,ctx,"review_returned",id,{reviewId:r.id});return {id};
  }
  if(v.version!==d.version)throw new IntelligenceError("Supplier changed; refresh before continuing",409);
  if(d.action==="FOLLOW_UP"){
   if(!v.signalConnectorId)throw new IntelligenceError("Link a register connection before requesting connected follow-up",409);
   const previous=await tx.vendorReview.findFirst({where:{...org(ctx),vendorId:id,status:"ACCEPTED"}});
   if(await reviewState(tx,ctx,v,previous)==="CURRENT")throw new IntelligenceError("The review is current; use its existing condition tasks or prepare a new review",409);
   const email=await owner(tx,ctx,v.ownerId);
   const existing=await tx.obligation.findFirst({where:{...org(ctx),vendorSignalId:id,status:{not:"COMPLETE"}},orderBy:{createdAt:"asc"}});
   if(existing)return {id,taskId:existing.id};
   const automationKey=hashValue({kind:"vendor-requested-review",vendorId:id,vendorVersion:v.version,baseline:previous?.id||null});
   const old=await tx.obligation.findUnique({where:{organizationId_automationKey:{...org(ctx),automationKey}}});
   const task=old?await tx.obligation.update({where:{id:old.id},data:{status:"OPEN",completedAt:null,completionException:false,completionRationale:"",assigneeId:v.ownerId,ownerName:email,dueDate:new Date()}}):await tx.obligation.create({data:{...org(ctx),vendorSignalId:id,automationKey,title:("Restore current supplier review: "+v.name).slice(0,160),category:"Supplier register monitoring",assigneeId:v.ownerId,ownerName:email,dueDate:new Date(),notes:"Refresh the register observation and supporting evidence, assess changes and obtain independent supplier sign-off. Closing this task alone does not restore review currentness."}});
   await event(tx,ctx,old?"follow_up_reopened":"follow_up_requested",id,{taskId:task.id,previousCompletion:old?{completedAt:old.completedAt?.toISOString()||null,exception:old.completionException,rationale:old.completionRationale}:null});
   return {id,taskId:task.id};
  }
  if(d.action==="LINK_SIGNAL"){
   if(d.connectorId&&!await tx.evidenceConnector.findFirst({where:{id:d.connectorId,...org(ctx),provider:"COMPANIES_HOUSE"}}))throw new IntelligenceError("Choose this organisation's Companies House connection",404);
   await tx.vendor.update({where:{id},data:{signalConnectorId:d.connectorId,version:{increment:1}}});
   await event(tx,ctx,"signal_link_changed",id,{connectorId:d.connectorId,notes:d.notes});return {id};
  }
  if(d.action==="ARCHIVE"){
   await tx.vendor.update({where:{id},data:{active:false,version:{increment:1}}});await event(tx,ctx,"archived",id);return {id,active:false};
  }
  const email=await owner(tx,ctx,d.vendor.ownerId),nextReviewAt=futureDate(d.vendor.nextReview),{nextReview,...fields}=d.vendor;
  if(v.ownerId!==fields.ownerId){
   const reviews=await tx.vendorReview.findMany({where:{...org(ctx),vendorId:id},select:{followUpTasks:true}});
   const ids=reviews.flatMap(r=>z.array(z.uuid()).max(7).parse(r.followUpTasks));
   await tx.obligation.updateMany({where:{...org(ctx),OR:[{id:{in:ids}},{vendorSignalId:id}],status:{not:"COMPLETE"}},data:{assigneeId:fields.ownerId,ownerName:email}});
  }
  await tx.vendor.update({where:{id},data:{...fields,nextReviewAt,version:{increment:1}}});await event(tx,ctx,"updated",id);return {id};
 });
}
