import {Prisma,type ManagedControl} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {manifestSchema,auditPeriodSchema,samplingPlanSchema,samplingSummarySchema,type AuditManifest} from "../auditor-policy";
import {reviewedFiles,reviewedFilesSchema,assertReviewedFiles,verifyReviewedBytes,futureDate} from "./reviewed-files";
import type {EvidenceObjectStore} from "./evidence-storage";
import type {AuthorizedContext} from "./authorization";
const createSchema=z.object({roomId:z.uuid(),roomVersion:z.number().int().positive(),controlId:z.uuid(),ownerId:z.uuid(),title:z.string().trim().min(3).max(160),instructions:z.string().trim().min(20).max(1600),dueDate:z.iso.date()});
export const requestActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("SUBMIT"),version:z.number().int().positive(),evidenceIds:z.array(z.uuid()).min(1).max(10).refine(v=>new Set(v).size===v.length),coverage:auditPeriodSchema,samplingNotes:z.string().trim().min(40).max(1600),confirm:z.literal(true)}),
 z.object({action:z.enum(["ACCEPT","RETURN","CANCEL"]),version:z.number().int().positive(),notes:z.string().trim().min(40).max(1600),confirm:z.literal(true)})
]);
const submissionSchema=z.object({files:reviewedFilesSchema,coverage:auditPeriodSchema,samplingNotes:z.string().max(1600),submittedAt:z.iso.datetime()});
type Tx=Prisma.TransactionClient;
const where=(ctx:AuthorizedContext)=>({organizationId:ctx.organizationId});
const controlSnapshot=(c:ManagedControl)=>({id:c.id,title:c.title,description:c.description,testProcedure:c.testProcedure,version:c.version});
function manifest(room:{manifest:unknown;manifestHash:string}){const m=manifestSchema.parse(room.manifest);if(hashValue(m)!==room.manifestHash)throw new IntelligenceError("Audit package integrity check failed",409);return m;}
function submitted(q:{submission:unknown;submissionHash:string|null}){const s=submissionSchema.parse(q.submission);if(hashValue(s)!==q.submissionHash)throw new IntelligenceError("Submission integrity check failed",409);return s;}
async function event(tx:Tx,ctx:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonValue={}){await tx.auditEvent.create({data:{...where(ctx),actorId:ctx.userId,entityType:"AuditRequest",entityId:id,action:"audit_request."+action,details}});}
async function currentControl(tx:Tx,ctx:AuthorizedContext,q:{controlId:string;controlHash:string;controlSnapshot:unknown}){const c=await tx.managedControl.findFirst({where:{id:q.controlId,...where(ctx),enabled:true}});if(!c||hashValue(controlSnapshot(c))!==q.controlHash||hashValue(q.controlSnapshot)!==q.controlHash)throw new IntelligenceError("Control changed. Cancel this request and prepare one against the current control",409);return c;}
async function request(tx:Tx,ctx:AuthorizedContext,id:string,admin=false){
 const actor=await requireMember(tx,ctx,admin?ADMIN:WRITER),q=await tx.auditRequest.findFirst({where:{id,...where(ctx)},include:{room:true,task:{select:{id:true,title:true,assigneeId:true,ownerName:true,dueDate:true,status:true}}}});
 if(!q||!ADMIN.includes(actor.role)&&q.task.assigneeId!==ctx.userId)throw new IntelligenceError("Audit request not found",404);
 if(q.room.status!=="DRAFT"||q.room.expiresAt<=new Date())throw new IntelligenceError("The audit draft is closed, published or expired",409);
 return q;
}
export async function auditRequestWorkspace(ctx:AuthorizedContext,roomId?:string){return transaction(ctx,async tx=>{
 const actor=await requireMember(tx,ctx),admin=ADMIN.includes(actor.role);
 const rows=await tx.auditRequest.findMany({where:{...where(ctx),...(roomId?{roomId}:{}),...(!admin?{task:{assigneeId:ctx.userId},room:{status:"DRAFT",expiresAt:{gt:new Date()}}}:{})},include:{room:{select:{id:true,title:true,status:true,manifest:true,manifestHash:true}},task:{select:{id:true,assigneeId:true,ownerName:true,dueDate:true,status:true,evidence:{where:{scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true},take:50}}}},orderBy:{createdAt:"desc"},take:50});
 return Promise.all(rows.map(async q=>{let current=true;try{await currentControl(tx,ctx,q);if(q.submission)await assertReviewedFiles(tx,ctx.organizationId,submitted(q).files);}catch(e){if(e instanceof IntelligenceError)current=false;else throw e;}
 const sampling=q.samplingPlan?samplingPlanSchema.parse(q.samplingPlan):null,suggestedFiles=sampling?await tx.evidence.findMany({where:{...where(ctx),id:{in:sampling.sampleIds},scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true}}):[];
 return {id:q.id,suggestedFiles,title:q.title,instructions:q.instructions,status:q.status,version:q.version,room:{id:q.room.id,title:q.room.title,status:q.room.status},period:manifest(q.room).period,task:q.task,submission:q.submission?submitted(q):null,submittedById:q.submittedById,reviewNotes:q.reviewNotes,reviewedAt:q.reviewedAt,samplingPlan:q.samplingPlan?samplingPlanSchema.parse(q.samplingPlan):null,current};}));
});}
export async function createAuditRequest(ctx:AuthorizedContext,input:unknown){return transaction(ctx,tx=>createAuditRequestInTransaction(tx,ctx,input));}
export async function createAuditRequestInTransaction(tx:Tx,ctx:AuthorizedContext,input:unknown){const d=createSchema.parse(input),dueDate=futureDate(d.dueDate);
 await requireMember(tx,ctx,ADMIN);const room=await tx.auditRoom.findFirst({where:{id:d.roomId,...where(ctx)}});
 if(!room||room.status!=="DRAFT"||room.version!==d.roomVersion||room.expiresAt<=new Date())throw new IntelligenceError("Audit draft changed; refresh",409);
 const m=manifest(room);if(!m.period)throw new IntelligenceError("Define an audit period when preparing the room",409);
 if(dueDate>room.expiresAt)throw new IntelligenceError("The evidence due date must be before room access expires");
 if(await tx.auditRequest.count({where:{...where(ctx),roomId:room.id}})>=50)throw new IntelligenceError("This audit supports up to 50 requests",429);
 const control=await tx.managedControl.findFirst({where:{id:d.controlId,...where(ctx),enabled:true}});if(!control)throw new IntelligenceError("Choose an active control in this workspace",404);
 const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:d.ownerId}},include:{user:{select:{email:true}}}});
 if(!member||!WRITER.includes(member.role)||!allowedEmail(member.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Choose a current colleague who can supply evidence",409);
 const id=randomUUID(),task=await tx.obligation.create({data:{...where(ctx),title:("Audit evidence: "+d.title).slice(0,160),category:"Audit evidence request",ownerName:member.user.email,assigneeId:d.ownerId,dueDate,automationKey:hashValue({kind:"audit-request",id}),notes:d.instructions}});
 const snapshot=controlSnapshot(control),q=await tx.auditRequest.create({data:{id,...where(ctx),roomId:room.id,taskId:task.id,controlId:control.id,controlSnapshot:snapshot,controlHash:hashValue(snapshot),title:d.title,instructions:d.instructions}});
 await tx.auditRoom.update({where:{id:room.id},data:{version:{increment:1}}});await event(tx,ctx,id,"created",{roomId:room.id,taskId:task.id,controlId:control.id});return {id:q.id,taskId:task.id};
}
async function canAccept(tx:Tx,ctx:AuthorizedContext,id:string,version:number){const q=await request(tx,ctx,id,true);if(q.status!=="SUBMITTED"||q.version!==version)throw new IntelligenceError("Submission changed; refresh",409);const c=await currentControl(tx,ctx,q),s=submitted(q);
 if(q.submittedById===ctx.userId||s.files.some(f=>f.uploadedById===ctx.userId))throw new IntelligenceError("A different administrator must review the supplied evidence",403);
 await assertReviewedFiles(tx,ctx.organizationId,s.files);return {q,c,s};}
export async function changeAuditRequest(ctx:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){const d=requestActionSchema.parse(input);
 if(d.action==="ACCEPT"){
  const before=await transaction(ctx,tx=>canAccept(tx,ctx,id,d.version));await verifyReviewedBytes(ctx,before.s.files,store);
  return transaction(ctx,async tx=>{const {q,c,s}=await canAccept(tx,ctx,id,d.version);if(q.submissionHash!==before.q.submissionHash)throw new IntelligenceError("Submission changed during retrieval",409);
   const m=manifest(q.room),ids=[...new Set([...m.files.map(f=>f.id),...s.files.map(f=>f.id)])];if(ids.length>50)throw new IntelligenceError("Audit package supports at most 50 selected files",409);
   const rows=await tx.evidence.findMany({where:{...where(ctx),id:{in:s.files.map(f=>f.id)}},include:{obligation:{select:{title:true}}},orderBy:{id:"asc"}});
   const added=rows.map(e=>({id:e.id,obligationId:e.obligationId,taskTitle:e.obligation.title,filename:e.filename,contentType:e.contentType,sizeBytes:e.sizeBytes,sha256:e.sha256,reviewVersion:e.reviewVersion,reviewedAt:e.reviewedAt!.toISOString()}));
   const acceptedAt=new Date(),next:AuditManifest={...m,files:[...m.files.filter(f=>!added.some(a=>a.id===f.id)),...added].sort((a,b)=>a.id.localeCompare(b.id)),requests:[...(m.requests||[]),{id:q.id,title:q.title,controlTitle:c.title,controlVersion:c.version,...(q.samplingPlan?{sampling:samplingSummarySchema.parse(q.samplingPlan)}:{}),coverage:s.coverage,fileIds:s.files.map(f=>f.id),acceptedAt:acceptedAt.toISOString()}]};manifestSchema.parse(next);
   await tx.auditRoom.update({where:{id:q.roomId},data:{manifest:next,manifestHash:hashValue(next),version:{increment:1}}});
   await tx.auditRequest.update({where:{id},data:{status:"ACCEPTED",reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:acceptedAt,version:{increment:1}}});
   await tx.obligation.update({where:{id:q.taskId},data:{status:"COMPLETE",completedAt:acceptedAt,completionException:false,completionRationale:"Evidence request accepted for the audit package. This does not establish control effectiveness."}});
   await event(tx,ctx,id,"accepted",{roomId:q.roomId,submissionHash:q.submissionHash});return {id,status:"ACCEPTED"};
  });
 }
 return transaction(ctx,async tx=>{const q=await request(tx,ctx,id,d.action!=="SUBMIT");if(q.version!==d.version)throw new IntelligenceError("Audit request changed; refresh",409);
  if(d.action==="SUBMIT"){
   if(q.task.assigneeId!==ctx.userId||!["OPEN","RETURNED"].includes(q.status))throw new IntelligenceError("Only the current request owner can submit open work",403);await currentControl(tx,ctx,q);const period=manifest(q.room).period!;
   if(d.coverage.to>new Date().toISOString().slice(0,10))throw new IntelligenceError("Evidence cannot claim coverage of future dates");
   if(d.coverage.from>period.from||d.coverage.to<period.to)throw new IntelligenceError("Explain and supply evidence covering the complete requested audit period");
   const sample=q.samplingPlan?samplingPlanSchema.parse(q.samplingPlan):null;if(sample?.sampleIds.length&&(sample.sampleIds.length!==d.evidenceIds.length||sample.sampleIds.some(id=>!d.evidenceIds.includes(id))))throw new IntelligenceError("Use the exact proposed sample, or cancel and prepare a new sampling plan",409);
   const files=await reviewedFiles(tx,ctx.organizationId,d.evidenceIds),owned=await tx.evidence.count({where:{...where(ctx),id:{in:d.evidenceIds},obligation:{OR:[{id:q.taskId},{controlId:q.controlId},{controlLinks:{some:{controlId:q.controlId}}},{auditRequest:{controlId:q.controlId,status:"ACCEPTED"}}]}}});if(owned!==files.length)throw new IntelligenceError("Use reviewed files attached to this request or its linked control",409);
   const history=z.array(z.object({submission:submissionSchema,reviewNotes:z.string(),reviewedAt:z.string().nullable()})).max(10).parse(q.history);if(history.length>=10)throw new IntelligenceError("Submission history limit reached; prepare a new request",429);
   const submission={files,coverage:d.coverage,samplingNotes:d.samplingNotes,submittedAt:new Date().toISOString()};
   await tx.auditRequest.update({where:{id},data:{submission,submissionHash:hashValue(submission),submittedById:ctx.userId,status:"SUBMITTED",history:q.submission?[...history,{submission:submitted(q),reviewNotes:q.reviewNotes,reviewedAt:q.reviewedAt?.toISOString()||null}]:history,version:{increment:1}}});
   await tx.obligation.update({where:{id:q.taskId},data:{status:"IN_PROGRESS",completedAt:null,completionException:false,completionRationale:""}});await event(tx,ctx,id,"submitted",{files:files.length});return {id,status:"SUBMITTED"};
  }
  if(d.action==="RETURN"&&(q.status!=="SUBMITTED"||q.submittedById===ctx.userId))throw new IntelligenceError("A different administrator must return a submitted request",409);
  if(d.action==="CANCEL"&&q.status==="CANCELLED")throw new IntelligenceError("Request already cancelled",409);
  if(d.action==="CANCEL"&&q.status==="ACCEPTED"){
   const m=manifest(q.room),receipt=m.requests?.find(r=>r.id===q.id);if(!receipt)throw new IntelligenceError("Package request receipt missing",409);
   const requests=(m.requests||[]).filter(r=>r.id!==q.id),kept=new Set(requests.flatMap(r=>r.fileIds)),next={...m,requests,files:m.files.filter(f=>!receipt.fileIds.includes(f.id)||kept.has(f.id))};
   await tx.auditRoom.update({where:{id:q.roomId},data:{manifest:next,manifestHash:hashValue(next)}});
   const previous=z.array(z.object({submission:submissionSchema,reviewNotes:z.string(),reviewedAt:z.string().nullable()})).max(10).parse(q.history);
   if(previous.length>=10)throw new IntelligenceError("Request history limit reached; prepare a new room",429);
   await tx.auditRequest.update({where:{id},data:{history:[...previous,{submission:submitted(q),reviewNotes:q.reviewNotes,reviewedAt:q.reviewedAt?.toISOString()||null}]}});
  }
  const status=d.action==="RETURN"?"RETURNED":"CANCELLED";await tx.auditRequest.update({where:{id},data:{status,reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});
  if(status==="CANCELLED")await tx.obligation.update({where:{id:q.taskId},data:{status:"COMPLETE",completionException:true,completionRationale:d.notes,completedAt:new Date()}});
  await tx.auditRoom.update({where:{id:q.roomId},data:{version:{increment:1}}});await event(tx,ctx,id,status.toLowerCase());return {id,status};
 });
}
export async function assertAuditRequestsReady(tx:Tx,ctx:AuthorizedContext,roomId:string){
 const requests=await tx.auditRequest.findMany({where:{...where(ctx),roomId}});
 if(requests.some(q=>!["ACCEPTED","CANCELLED"].includes(q.status)))throw new IntelligenceError("Resolve every audit evidence request before publishing",409);
 for(const q of requests.filter(q=>q.status==="ACCEPTED")){await currentControl(tx,ctx,q);await assertReviewedFiles(tx,ctx.organizationId,submitted(q).files);}
}
