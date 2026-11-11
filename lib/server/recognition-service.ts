import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {RECOGNITION_TRACKS,buildRecognitionRegister,isRecognitionTrack} from "../recognition/registry.mjs";

const taskKey=(id:string)=>"recognition:"+id;
const safeUser=(user:string)=>user.length<=80?user:user.slice(0,80);
export async function recognitionWorkspace(ctx:AuthorizedContext){
 const {existing,files}=await db.$transaction(async tx=>{
  await requireMember(tx,ctx);
  const existing=await tx.obligation.findMany({where:{organizationId:ctx.organizationId,automationKey:{in:RECOGNITION_TRACKS.map(x=>taskKey(x.id))}},
    orderBy:{dueDate:"asc"},take:20,select:{id:true,title:true,automationKey:true,ownerName:true,status:true,dueDate:true,completionException:true}});
  const files=existing.length?await tx.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId:{in:existing.map(t=>t.id)}},
    select:{id:true,obligationId:true,scanStatus:true,reviewStatus:true,reviewerId:true,uploadedById:true,reviewedAt:true},take:100}):[];
  return {existing,files};
 });
 const tasks=new Map(existing.map(t=>[t.automationKey,t]));
 const approved=new Map(existing.map(t=>[t.id,files.filter(f=>f.obligationId===t.id&&f.scanStatus==="CLEAN"&&f.reviewStatus==="APPROVED"&&!!f.reviewerId&&!!f.uploadedById&&f.reviewerId!==f.uploadedById&&!!f.reviewedAt).length]));
 const publicRegister=buildRecognitionRegister();
 return {tracks:RECOGNITION_TRACKS.map(t=>{
   const existingTask=tasks.get(taskKey(t.id));
   return {...t,publicStatus:publicRegister.records.find(x=>x.id===t.id)?.status||"NOT_VERIFIED",
    task:existingTask?{id:existingTask.id,title:existingTask.title,ownerName:existingTask.ownerName,status:existingTask.status,dueDate:existingTask.dueDate.toISOString().slice(0,10),completionException:existingTask.completionException,independentlyReviewedFiles:approved.get(existingTask.id)||0}:null};
 }),notice:"File counts reflect internal scan/review metadata only; not issuer confirmation, verified file bytes, MHRA approvals, external certification or customer GxP validation."};
}
export async function createRecognitionAction(ctx:AuthorizedContext,trackId:string){
 if(!["OWNER","ADMIN"].includes(ctx.role))throw new IntelligenceError("An administrator is required to prepare external assurance",403);
 if(!isRecognitionTrack(trackId))throw new IntelligenceError("Unknown assurance pathway",400);
 const track=RECOGNITION_TRACKS.find(x=>x.id===trackId)!;
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const old=await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey:taskKey(trackId)}}});
  if(old)return {taskId:old.id,reused:true,notice:"Existing internal action reused; no certification or regulatory advice has been claimed."};
  const owner=await tx.user.findUnique({where:{id:ctx.userId},select:{email:true}});
  if(!owner)throw new IntelligenceError("Current owner not found",403);
  const days=21;const due=new Date(new Date().toISOString().slice(0,10)+"T00:00:00Z");due.setUTCDate(due.getUTCDate()+days);
  const notes=("Prepare independent assurance evidence: "+track.requirements.join("; ")+
    ". Internal review target only; verify issuer, current scope and any expiry before claiming success.").slice(0,500);
  const row=await tx.obligation.create({data:{
    organizationId:ctx.organizationId,automationKey:taskKey(trackId),
    title:("Assurance evidence: "+track.title).slice(0,160),
    ownerName:safeUser(owner.email),assigneeId:ctx.userId,dueDate:due,
    category:"External regulatory assurance",notes,status:"OPEN"
  }});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
    action:"recognition.internal_evidence_action_created",entityType:"Obligation",entityId:row.id,
    details:{trackId,action:"collect_evidence",notAnApproval:true}}});
  return {taskId:row.id,reused:false,notice:"Internal evidence action created; no issuer, regulator or certification has verified this pathway."};
 });
}
