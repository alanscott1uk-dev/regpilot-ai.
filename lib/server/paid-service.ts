import {Prisma,type ServiceJob} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {hashValue} from "../regulatory/intelligence";
import {serviceCatalogue,serviceReady,positiveInt,type ServiceKey} from "../services/config";
import {reservePaid,monthStart} from "./paid-budget";
import {downloadEvidence} from "./evidence-service";
import {extractDocument} from "./document-extraction";
import type {EvidenceObjectStore} from "./evidence-storage";
import {evidenceConfigured} from "./evidence-storage";
import {startOcr,pollOcr} from "../services/azure-ocr";
import {sendReminder} from "../services/resend";
import {createCheckout} from "../services/stripe";
import {ProviderError} from "../services/http";
import {allowedEmail} from "../ai/security.mjs";
const j=(v:unknown)=>v as Prisma.InputJsonValue;
const prepareSchema=z.object({kind:z.enum(["OCR","EMAIL","STRIPE"]),targetId:z.uuid().optional()});
async function targetCheck(tx:Prisma.TransactionClient,ctx:AuthorizedContext,kind:string,targetId:string|null,recipientId?:string|null){
 if(kind==="OCR"){const e=await tx.evidence.findFirst({where:{id:targetId||"",organizationId:ctx.organizationId,scanStatus:"CLEAN",reviewStatus:"APPROVED"}});if(!e||e.contentType!=="application/pdf")throw new IntelligenceError("Choose an independently approved PDF",409);return {hash:e.sha256,recipient:null};}
 if(kind==="EMAIL"){
  const task=await tx.obligation.findFirst({where:{id:targetId||"",organizationId:ctx.organizationId,status:{not:"COMPLETE"}}});if(!task?.assigneeId||recipientId&&recipientId!==task.assigneeId)throw new IntelligenceError("Assign an open task to a current team member",409);
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:task.assigneeId}},include:{user:{select:{email:true}}}});if(!member||!allowedEmail(member.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Recipient is no longer an approved team member",409);return {hash:null,recipient:member.user.email,recipientId:task.assigneeId};
 }
 await requireMember(tx,ctx,["OWNER"]);const account=await tx.billingAccount.findUnique({where:{organizationId:ctx.organizationId}});if(account)throw new IntelligenceError("An existing subscription is already recorded; manage it in Stripe",409);return {hash:null,recipient:null};
}
export async function prepareServiceJob(ctx:AuthorizedContext,input:unknown,store?:EvidenceObjectStore){
 const value=prepareSchema.parse(input);if(value.kind!=="STRIPE"&&!value.targetId)throw new IntelligenceError("Choose a target");let units=1;
 const scope=await transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);return targetCheck(tx,ctx,value.kind,value.targetId||null);});
 if(value.kind==="OCR"){
  if(!evidenceConfigured())throw new IntelligenceError("Evidence service awaits activation",503);
  const file=await downloadEvidence(ctx,value.targetId!,store),parsed=await extractDocument(file.bytes,file.filename,{allowEmpty:true});units=parsed.totalPages;if(units<1||units>40||parsed.truncated)throw new IntelligenceError("OCR supports complete PDFs up to 40 pages",422);
 }
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const current=await targetCheck(tx,ctx,value.kind,value.targetId||null);if(scope.hash!==current.hash)throw new IntelligenceError("Evidence changed",409);
  const dedupeKey=value.kind+":"+(value.targetId||ctx.organizationId)+":"+(scope.hash||new Date().toISOString().slice(0,10));
  const existing=await tx.serviceJob.findUnique({where:{organizationId_dedupeKey:{organizationId:ctx.organizationId,dedupeKey}}});if(existing)return {id:existing.id,status:existing.status};
  if(await tx.serviceJob.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=50)throw new IntelligenceError("Daily service preparation limit reached",429);
  const job=await tx.serviceJob.create({data:{organizationId:ctx.organizationId,createdById:ctx.userId,kind:value.kind,targetId:value.targetId||null,sourceHash:scope.hash,dedupeKey,units,recipientId:"recipientId" in scope?scope.recipientId:null}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"services.draft_prepared",entityType:"ServiceJob",entityId:job.id,details:{kind:job.kind,units}}});return {id:job.id,status:job.status};
 });
}
export async function queueServiceJob(ctx:AuthorizedContext,id:string,version:number,consent:boolean){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);if(consent!==true)throw new IntelligenceError("Explicit processing or delivery approval required");if(!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid version");const job=await tx.serviceJob.findFirst({where:{id,organizationId:ctx.organizationId,status:"DRAFT",version}});if(!job)throw new IntelligenceError("Draft changed or unavailable",409);
 if(!serviceReady(job.kind as ServiceKey))throw new IntelligenceError("This service is prepared but not activated",503);const target=await targetCheck(tx,ctx,job.kind,job.targetId,job.recipientId);if(target.hash!==job.sourceHash)throw new IntelligenceError("Evidence changed",409);
 await reservePaid(tx,ctx,job.kind,"service:"+id,job.units);
 const saved=await tx.serviceJob.update({where:{id},data:{status:"QUEUED",createdById:ctx.userId,version:{increment:1}}});await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"services.processing_approved",entityType:"ServiceJob",entityId:id,details:{kind:job.kind,version:saved.version}}});return {id,status:saved.status};
});}
export async function redactServiceJob(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);if(!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid version");const current=await tx.serviceJob.findFirst({where:{id,organizationId:ctx.organizationId,version}});if(!current)throw new IntelligenceError("Service request changed",409);if(current.kind==="STRIPE")await requireMember(tx,ctx,["OWNER"]);const n=await tx.serviceJob.updateMany({where:{id,organizationId:ctx.organizationId,version},data:{status:"REDACTED",result:Prisma.DbNull,resultHash:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});if(!n.count)throw new IntelligenceError("Service request changed",409);await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"services.request_redacted",entityType:"ServiceJob",entityId:id,details:{}}});return {id};});}
export async function servicesWorkspace(ctx:AuthorizedContext){return transaction(ctx,async tx=>{const member=await requireMember(tx,ctx,ADMIN);const [budget,usage,jobs,evidence,tasks,billing]=await Promise.all([
 tx.paidBudget.findUnique({where:{organizationId:ctx.organizationId}}),tx.paidReservation.aggregate({where:{organizationId:ctx.organizationId,month:monthStart()},_sum:{reservedMicros:true}}),
 tx.serviceJob.findMany({where:{organizationId:ctx.organizationId,...(member.role!=="OWNER"?{kind:{not:"STRIPE"}}:{})},orderBy:{createdAt:"desc"},take:50,select:{id:true,kind:true,status:true,version:true,units:true,createdAt:true,updatedAt:true,failureCode:true,leaseUntil:true,result:true,resultHash:true}}),
 tx.evidence.findMany({where:{organizationId:ctx.organizationId,scanStatus:"CLEAN",reviewStatus:"APPROVED",contentType:"application/pdf"},take:100,select:{id:true,filename:true}}),tx.obligation.findMany({where:{organizationId:ctx.organizationId,status:{not:"COMPLETE"},assigneeId:{not:null}},take:100,select:{id:true,title:true}}),member.role==="OWNER"?tx.billingAccount.findUnique({where:{organizationId:ctx.organizationId},select:{status:true,updatedAt:true}}):null]);
 return {catalogue:serviceCatalogue(),budget:{limitMicros:budget?.monthlyLimitMicros??positiveInt(process.env.REGPILOT_PAID_ORG_MONTHLY_MICROS),version:budget?.version||0,remindersEnabled:budget?.remindersEnabled||false,reservedMicros:usage._sum.reservedMicros||0,currency:"USD",limitation:"Reserved spending allocation, not a provider invoice or guaranteed bill cap. Provider budgets must also be configured."},jobs:jobs.map(({leaseUntil,...r})=>({...r,status:r.status==="PROCESSING"&&leaseUntil&&leaseUntil<new Date()?"ATTENTION":r.status,failureCode:r.status==="PROCESSING"&&leaseUntil&&leaseUntil<new Date()?"INTERRUPTED_OUTCOME_UNCERTAIN":r.failureCode,result:r.result&&hashValue(r.result)===r.resultHash?r.result:null})),evidence,tasks,billing,role:member.role};
});}
class Superseded extends Error{}
async function assertJob(tx:Prisma.TransactionClient,job:ServiceJob){
 if(!serviceReady(job.kind as ServiceKey))throw new Superseded();const row=await tx.serviceJob.findFirst({where:{id:job.id,organizationId:job.organizationId,version:job.version,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()},status:{in:["PROCESSING","POLLING"]}}});if(!row)throw new Superseded();
 const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.createdById,role:"ADMIN"};await requireMember(tx,ctx,job.kind==="STRIPE"?["OWNER"]:ADMIN);const scope=await targetCheck(tx,ctx,job.kind,job.targetId,job.recipientId);if(scope.hash!==job.sourceHash)throw new IntelligenceError("Source changed",409);return scope;
}
export async function claimServiceJob(){
 const kinds=["OCR","EMAIL","STRIPE"].filter(k=>serviceReady(k as ServiceKey));if(!kinds.length)return null;
 const token=randomUUID();const rows=await db.$queryRaw<ServiceJob[]>`WITH due AS (SELECT id FROM "ServiceJob" WHERE kind IN (${Prisma.join(kinds)}) AND status IN ('QUEUED','POLLING') AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW()) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "ServiceJob" j SET status=CASE WHEN j.status='QUEUED' THEN 'PROCESSING' ELSE j.status END,"leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',"updatedAt"=NOW() FROM due WHERE j.id=due.id RETURNING j.*`;return rows[0]||null;
}
export type ServiceDependencies={storage?:EvidenceObjectStore;start?:typeof startOcr;poll?:typeof pollOcr;email?:typeof sendReminder;checkout?:typeof createCheckout};
export async function executeServiceJob(job:ServiceJob,deps:ServiceDependencies={}){
 const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.createdById,role:"ADMIN"};
 try{
  const scope=await transaction(ctx,tx=>assertJob(tx,job));let result:unknown;
  if(job.kind==="OCR"){
   if(!evidenceConfigured())throw new ProviderError("EVIDENCE_DISABLED");
   if(job.status==="PROCESSING"){
    const file=await downloadEvidence(ctx,job.targetId!,deps.storage);if(file.sha256!==job.sourceHash)throw new ProviderError("SOURCE_CHANGED");await transaction(ctx,tx=>assertJob(tx,job));const operation=await (deps.start||startOcr)(file.bytes,job.units);
    return transaction(ctx,async tx=>{await assertJob(tx,job);await tx.serviceJob.update({where:{id:job.id},data:{status:"POLLING",result:j({operation}),resultHash:hashValue({operation}),leaseToken:null,leaseUntil:new Date(Date.now()+15000)}});return "POLLING";});
   }
   if(Date.now()-job.createdAt.getTime()>20*3600000)throw new ProviderError("OCR_OPERATION_EXPIRED");
   if(!job.result||hashValue(job.result)!==job.resultHash)throw new ProviderError("INTEGRITY_FAILED");const operation=(job.result as {operation:string}).operation;result=await (deps.poll||pollOcr)(operation,job.units);
   if(!result)return transaction(ctx,async tx=>{await assertJob(tx,job);await tx.serviceJob.update({where:{id:job.id},data:{leaseToken:null,leaseUntil:new Date(Date.now()+15000)}});return "POLLING";});
  }else if(job.kind==="EMAIL")result=await (deps.email||sendReminder)({jobId:job.id,taskId:job.targetId!,recipient:scope.recipient!});
  else result=await (deps.checkout||createCheckout)({jobId:job.id,organizationId:job.organizationId});
  return transaction(ctx,async tx=>{await assertJob(tx,job);const providerId=(result as {providerId?:string}).providerId;await tx.serviceJob.update({where:{id:job.id},data:{status:"SUCCEEDED",result:j(result),resultHash:hashValue(result),providerId:providerId||null,leaseToken:null,leaseUntil:null}});await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.createdById,action:"services.result_recorded",entityType:"ServiceJob",entityId:job.id,details:{kind:job.kind,resultHash:hashValue(result)}}});return "SUCCEEDED";});
 }catch(e){
  if(e instanceof Superseded)return "SUPERSEDED";
  const code=e instanceof ProviderError?e.code:e instanceof IntelligenceError&&[403,409].includes(e.status)?"AUTHORITY_OR_SOURCE_CHANGED":"OUTCOME_UNCERTAIN";
  await db.serviceJob.updateMany({where:{id:job.id,organizationId:job.organizationId,version:job.version,leaseToken:job.leaseToken},data:{status:"ATTENTION",failureCode:code,leaseToken:null,leaseUntil:null}});return "ATTENTION";
 }
}
export async function runServiceBatch(){const reminders=await generateReminderJobs();const outcomes:string[]=[];for(let i=0;i<3;i++){const job=await claimServiceJob();if(!job)break;outcomes.push(await executeServiceJob(job));}return {processed:outcomes.length,outcomes,reminders};}

/** Daily overdue reminders only after a saved owner policy AND runtime activation. */
export async function generateReminderJobs(){
 if(!serviceReady("EMAIL"))return {created:0,paused:0};let created=0,paused=0;
 const policies=await db.paidBudget.findMany({where:{remindersEnabled:true,configuredById:{not:null}},take:5,orderBy:{updatedAt:"asc"}});
 for(const policy of policies){const ctx:AuthorizedContext={organizationId:policy.organizationId,userId:policy.configuredById!,role:"OWNER"};
  try{created+=await transaction(ctx,async tx=>{await requireMember(tx,ctx,["OWNER"]);const current=await tx.paidBudget.findUniqueOrThrow({where:{organizationId:ctx.organizationId}});if(!current.remindersEnabled||current.version!==policy.version||!serviceReady("EMAIL"))return 0;
   const today=new Date(new Date().toISOString().slice(0,10)+"T00:00:00Z"),day=today.toISOString().slice(0,10),existing=await tx.serviceJob.findMany({where:{organizationId:ctx.organizationId,kind:"EMAIL",createdAt:{gte:today}},select:{targetId:true}});
   const tasks=await tx.obligation.findMany({where:{organizationId:ctx.organizationId,status:{not:"COMPLETE"},assigneeId:{not:null},dueDate:{lt:today},id:{notIn:existing.flatMap(j=>j.targetId?[j.targetId]:[])}},orderBy:[{dueDate:"asc"},{id:"asc"}],take:20});let count=0;
   for(const task of tasks){const recipient=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:task.assigneeId!}},include:{user:{select:{email:true}}}});if(!recipient||!allowedEmail(recipient.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))continue;
    const id=randomUUID();await reservePaid(tx,ctx,"EMAIL","service:"+id);await tx.serviceJob.create({data:{id,organizationId:ctx.organizationId,createdById:ctx.userId,kind:"EMAIL",targetId:task.id,recipientId:task.assigneeId,dedupeKey:"EMAIL:"+task.id+":"+day,status:"QUEUED"}});count++;
   }
   await tx.paidBudget.update({where:{organizationId:ctx.organizationId},data:{updatedAt:new Date()}});
   if(count)await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"services.reminders_queued",entityType:"PaidBudget",entityId:ctx.organizationId,details:{count,day}}});return count;
  });}catch(e){if(e instanceof IntelligenceError&&e.status===403){await db.paidBudget.updateMany({where:{organizationId:ctx.organizationId,version:policy.version},data:{remindersEnabled:false,version:{increment:1}}});paused++;}else if(!(e instanceof IntelligenceError&&[429,503,409].includes(e.status)))throw e;}
 }
 return {created,paused};
}
