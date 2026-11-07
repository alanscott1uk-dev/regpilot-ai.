import type {AuthorizedContext} from "./authorization";
import {z} from "zod";
import {db} from "./db";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {hashValue} from "../regulatory/intelligence";
const editSchema=z.object({version:z.number().int().positive(),ownerId:z.uuid(),intervalDays:z.number().int().min(7).max(365),nextReview:z.iso.date(),enabled:z.boolean()});
export async function configureControl(ctx:AuthorizedContext,id:string,input:unknown){
 const parsed=editSchema.safeParse(input);if(!parsed.success)throw new IntelligenceError("Choose an owner, review interval and valid date");const v=parsed.data;
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const control=await tx.managedControl.findFirst({where:{id,organizationId:ctx.organizationId},include:{programmeImport:{select:{status:true}}}});if(!control||control.programmeImport.status!=="ACCEPTED")throw new IntelligenceError("Accepted control not found",404);
 const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:v.ownerId}},include:{user:{select:{email:true}}}});if(!owner||owner.role==="VIEWER")throw new IntelligenceError("Choose a current member who can work on tasks",409);
 const changed=await tx.managedControl.updateMany({where:{id,organizationId:ctx.organizationId,version:v.version},data:{ownerId:v.ownerId,scheduledById:ctx.userId,intervalDays:v.intervalDays,nextReviewAt:new Date(v.nextReview+"T00:00:00Z"),enabled:v.enabled,version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Control changed; refresh first",409);
 // Pause fences in-flight collection before any new work can be stored.
 if(!v.enabled)await tx.evidenceConnector.updateMany({where:{organizationId:ctx.organizationId,controlId:id},data:{enabled:false,leaseToken:null,leaseUntil:null,version:{increment:1}}});
 const reassigned=await tx.obligation.updateMany({where:{organizationId:ctx.organizationId,controlId:id,status:{not:"COMPLETE"}},data:{assigneeId:v.ownerId,ownerName:owner.user.email}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"control.schedule_updated",entityType:"ManagedControl",entityId:id,details:{ownerId:v.ownerId,enabled:v.enabled,intervalDays:v.intervalDays,reassigned:reassigned.count}}});return {id};
 });
}
export async function mapControl(ctx:AuthorizedContext,input:unknown){
 const parsed=z.object({controlId:z.uuid(),taskId:z.uuid(),rationale:z.string().trim().min(40).max(1200)}).safeParse(input);if(!parsed.success)throw new IntelligenceError("Choose a control and task, and explain the exact scope of this mapping");const v=parsed.data;
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);
 const [control,task]=await Promise.all([tx.managedControl.findFirst({where:{id:v.controlId,organizationId:ctx.organizationId,enabled:true}}),tx.obligation.findFirst({where:{id:v.taskId,organizationId:ctx.organizationId}})]);if(!control||!task)throw new IntelligenceError("Control or task not found in this organisation",404);
 const link=await tx.controlLink.upsert({where:{controlId_obligationId:{controlId:control.id,obligationId:task.id}},create:{organizationId:ctx.organizationId,controlId:control.id,obligationId:task.id,mappedById:ctx.userId,rationale:v.rationale},update:{mappedById:ctx.userId,rationale:v.rationale}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"control.scope_mapped",entityType:"ControlLink",entityId:link.id,details:{controlId:control.id,taskId:task.id}}});return {id:link.id};
 });
}
export async function generateDueReviews(ctx:AuthorizedContext,automated=false){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const today=new Date(new Date().toISOString().slice(0,10)+"T00:00:00Z");
 const controls=await tx.managedControl.findMany({where:{organizationId:ctx.organizationId,enabled:true,nextReviewAt:{lte:today},tasks:{none:{connectorId:null,status:{not:"COMPLETE"}}}},orderBy:[{nextReviewAt:"asc"},{id:"asc"}],take:25,include:{owner:{select:{email:true}},programmeImport:{select:{status:true}}}});let created=0,paused=0;const waiting=await tx.managedControl.count({where:{organizationId:ctx.organizationId,enabled:true,nextReviewAt:{lte:today},tasks:{some:{connectorId:null,status:{not:"COMPLETE"}}}}});
 for(const control of controls){
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:control.ownerId}}});
  let schedulerValid=true;
  if(automated)try{await requireMember(tx,{...ctx,userId:control.scheduledById},ADMIN);}catch(e){if(e instanceof IntelligenceError&&e.status===403)schedulerValid=false;else throw e;}
  if(!schedulerValid||!member||member.role==="VIEWER"||control.programmeImport.status!=="ACCEPTED"){
   await tx.managedControl.update({where:{id:control.id},data:{enabled:false,version:{increment:1}}});
   await tx.evidenceConnector.updateMany({where:{organizationId:ctx.organizationId,controlId:control.id},data:{enabled:false,leaseToken:null,leaseUntil:null,version:{increment:1}}});paused++;continue;
  }

  const key=hashValue({controlId:control.id,cycle:control.nextReviewAt.toISOString().slice(0,10)});
  const old=await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey:key}}});
  if(!old){await tx.obligation.create({data:{organizationId:ctx.organizationId,title:("Review: "+control.title).slice(0,160),category:"Recurring control review",ownerName:control.owner.email,assigneeId:control.ownerId,controlId:control.id,automationKey:key,dueDate:control.nextReviewAt,notes:control.testProcedure.slice(0,500)}});created++;}
  // Coalesce missed periods. Do not create a backlog of historical duplicate tasks.
  const periods=Math.floor((today.getTime()-control.nextReviewAt.getTime())/(control.intervalDays*86400000))+1;
  await tx.managedControl.update({where:{id:control.id},data:{nextReviewAt:new Date(control.nextReviewAt.getTime()+periods*control.intervalDays*86400000),version:{increment:1}}});
 }
 if(controls.length)await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"control.reviews_scheduled",entityType:"Organization",entityId:ctx.organizationId,details:{created,waiting,paused,examined:controls.length}}});
 return {created,waiting,paused,limitReached:controls.length===25};
 });
}
export async function runReviewBatch(){
 if(process.env.REGPILOT_AUTOMATION_ENABLED!=="true")throw new IntelligenceError("Recurring automation awaits activation",503);
 const rows=await db.managedControl.findMany({where:{enabled:true,nextReviewAt:{lte:new Date()},tasks:{none:{connectorId:null,status:{not:"COMPLETE"}}}},orderBy:{nextReviewAt:"asc"},distinct:["organizationId"],take:5,select:{organizationId:true,scheduledById:true}});let processed=0,attention=0;
 for(const row of rows){if(!row.scheduledById){attention++;continue;}try{await generateDueReviews({organizationId:row.organizationId,userId:row.scheduledById,role:"ADMIN"},true);processed++;}catch(e){if(e instanceof IntelligenceError&&e.status===403){
    attention++;
    // A revoked scheduler cannot block other organisations on every later batch.
    await transaction({organizationId:row.organizationId,userId:row.scheduledById,role:"ADMIN"},async tx=>{
     try{await requireMember(tx,{organizationId:row.organizationId,userId:row.scheduledById,role:"ADMIN"},ADMIN);return;}catch(error){if(!(error instanceof IntelligenceError&&error.status===403))throw error;}
     const controls=await tx.managedControl.findMany({where:{organizationId:row.organizationId,enabled:true,scheduledById:row.scheduledById},select:{id:true}});
     const ids=controls.map(c=>c.id);
     await tx.managedControl.updateMany({where:{organizationId:row.organizationId,id:{in:ids}},data:{enabled:false,version:{increment:1}}});
     await tx.evidenceConnector.updateMany({where:{organizationId:row.organizationId,controlId:{in:ids}},data:{enabled:false,leaseToken:null,leaseUntil:null,version:{increment:1}}});
     await tx.auditEvent.create({data:{organizationId:row.organizationId,actorId:row.scheduledById!,action:"control.scheduler_permission_revoked",entityType:"Organization",entityId:row.organizationId,details:{paused:ids.length}}});
    });
   }else throw e;}}
 return {processed,attention};
}
