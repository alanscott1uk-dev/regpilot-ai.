import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import type {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import type {EvidenceObjectStore} from "./evidence-storage";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {reviewedFiles} from "./reviewed-files";
import {downloadEvidence} from "./evidence-service";
import {RECOGNITION_TRACKS} from "../recognition/registry.mjs";
import {hashValue} from "../regulatory/intelligence";
import {makeAuditZip,archiveFilename} from "../audit-archive";

const LIMITS={files:10,bytes:15*1024*1024,candidates:100};
const selectionSchema=z.object({
 trackId:z.string().min(1).max(80),
 evidenceIds:z.array(z.uuid()).min(1).max(LIMITS.files).refine(ids=>new Set(ids).size===ids.length,"Duplicate evidence selection")
}).strict();
const exportSchema=selectionSchema.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)});
type Selection=z.infer<typeof selectionSchema>;
const notice="Preparation evidence only. This archive is not a certificate, regulatory submission, MHRA or government approval, or completed customer-specific GxP validation.";
function trackFor(id:string){
 const track=RECOGNITION_TRACKS.find(t=>t.id===id);
 if(!track)throw new IntelligenceError("Unknown assurance pathway",400);
 return track;
}
function assertAdmin(ctx:AuthorizedContext){
 if(!ADMIN.includes(ctx.role))throw new IntelligenceError("An owner or administrator must prepare an external-assessment pack",403);
}
async function taskFor(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 const task=await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey:"recognition:"+id}}});
 if(!task)throw new IntelligenceError("Create the assurance evidence action first",404);
 return task;
}
async function snapshot(tx:Prisma.TransactionClient,ctx:AuthorizedContext,input:Selection){
 await requireMember(tx,ctx,ADMIN);
 const track=trackFor(input.trackId),task=await taskFor(tx,ctx,track.id);
 const linked=await tx.evidence.count({where:{organizationId:ctx.organizationId,obligationId:task.id,id:{in:input.evidenceIds}}});
 if(linked!==input.evidenceIds.length)throw new IntelligenceError("Select evidence attached to this organisation's exact assurance action",409);
 const files=await reviewedFiles(tx,ctx.organizationId,input.evidenceIds);
 if(files.some(f=>f.sizeBytes>LIMITS.bytes)||files.reduce((n,f)=>n+f.sizeBytes,0)>LIMITS.bytes)
  throw new IntelligenceError("Selected evidence exceeds the 15 MB preparation-pack limit",413);
 return {
  organizationId:ctx.organizationId,
  pathway:{id:track.id,title:track.title,kind:track.kind,purpose:track.purpose,publicNote:track.publicNote},
  task:{id:task.id,title:task.title,ownerName:task.ownerName,assigneeId:task.assigneeId,status:task.status,
   dueDate:task.dueDate.toISOString().slice(0,10),updatedAt:task.updatedAt.toISOString(),notes:task.notes,
   completionException:task.completionException,completionRationale:task.completionRationale},
  requirements:track.requirements.map((text,index)=>({id:track.id+":"+(index+1),text,assessment:"NOT_ASSESSED" as const})),
  files
 };
}
export async function recognitionPackageWorkspace(ctx:AuthorizedContext,trackId:string){
 assertAdmin(ctx);const track=trackFor(trackId);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);const task=await taskFor(tx,ctx,track.id);
  const rows=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId:task.id},
   orderBy:[{createdAt:"desc"},{id:"asc"}],take:LIMITS.candidates+1,
   select:{id:true,filename:true,contentType:true,sizeBytes:true,sha256:true,reviewVersion:true,scanStatus:true,
    reviewStatus:true,reviewerId:true,uploadedById:true,reviewedAt:true}});
  return {trackId,taskId:task.id,limits:LIMITS,candidateLimitReached:rows.length>LIMITS.candidates,notice,
   files:rows.slice(0,LIMITS.candidates).map(f=>({id:f.id,filename:f.filename,sizeBytes:f.sizeBytes,sha256:f.sha256,
    reviewVersion:f.reviewVersion,eligible:f.scanStatus==="CLEAN"&&f.reviewStatus==="APPROVED"&&!!f.reviewedAt&&!!f.uploadedById&&!!f.reviewerId&&f.uploadedById!==f.reviewerId,
    reviewStatus:f.reviewStatus,scanStatus:f.scanStatus}))};
 });
}
export async function previewRecognitionPackage(ctx:AuthorizedContext,input:unknown){
 assertAdmin(ctx);const selection=selectionSchema.parse(input);
 const plan=await transaction(ctx,tx=>snapshot(tx,ctx,selection));
 return {plan,previewHash:hashValue(plan),selectedCount:plan.files.length,
  selectedBytes:plan.files.reduce((n,f)=>n+f.sizeBytes,0),notice,
  limits:LIMITS,filesVerifiedNow:false,
  explanation:"Preview checks current metadata only. Export separately retrieves and verifies the selected file bytes, then rechecks the task, evidence and permissions."};
}
export async function exportRecognitionPackage(ctx:AuthorizedContext,input:unknown,store?:EvidenceObjectStore){
 assertAdmin(ctx);const selection=exportSchema.parse(input);
 const plan=await transaction(ctx,tx=>snapshot(tx,ctx,selection));
 if(hashValue(plan)!==selection.previewHash)throw new IntelligenceError("The task or selected evidence changed. Prepare a fresh preview.",409);
 const entries:Array<{name:string;bytes:Uint8Array}>=[],fileManifest=[];
 const deadline=Date.now()+40000;
 for(const [index,file] of plan.files.entries()){
  if(Date.now()>deadline)throw new IntelligenceError("Pack verification exceeded its time budget; reduce the file selection",503);
  const actual=await downloadEvidence(ctx,file.id,store);
  if(actual.sha256!==file.sha256||actual.bytes.byteLength!==file.sizeBytes||actual.contentType!==file.contentType)
   throw new IntelligenceError("Selected evidence changed during file retrieval",409);
  const path=archiveFilename(index,file.filename);
  entries.push({name:path,bytes:actual.bytes});
  fileManifest.push({...file,archivePath:path,bytesVerified:true});
 }
 const manifest={format:"regpilot-assessment-preparation-v1",packageId:randomUUID(),generatedAt:new Date().toISOString(),
  preparedById:ctx.userId,previewHash:selection.previewHash,notice,...plan,files:fileManifest,
  externallySubmitted:false,externallyCertified:false,requirementCoverageAssessed:false,
  limitations:["Independent file approval is internal review, not issuer or regulator verification.",
   "Hashes establish file identity at export, not authenticity of an issuer or suitability for a regulated purpose.",
   "All listed requirements remain unassessed; selected attachments do not establish complete coverage.",
   "This archive contains private business evidence. Check recipients and disclosure authority before sharing."]};
 const readme=["REGPILOT — EXTERNAL ASSESSMENT PREPARATION PACK",notice,"",plan.pathway.title,
  "Read manifest.json for exact scope, task, files, hashes and limitations.",
  "No regulator enquiry has been submitted and no certificate or customer validation is awarded by this export.",
  "All requirements are NOT_ASSESSED until a suitably qualified reviewer records a scoped decision.",
  "The archive is private. Do not upload it to a public website or an unapproved AI provider.",""].join("\n");
 const zip=makeAuditZip([{name:"README.txt",bytes:Buffer.from(readme)},{name:"manifest.json",bytes:Buffer.from(JSON.stringify(manifest,null,2)+"\n")},...entries]);
 const sha256=createHash("sha256").update(zip).digest("hex");
 await transaction(ctx,async tx=>{
  const current=await snapshot(tx,ctx,selection);
  if(hashValue(current)!==selection.previewHash)throw new IntelligenceError("Permissions, task or evidence changed during export. Prepare a fresh preview.",409);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
   action:"recognition.preparation_package_exported",entityType:"Obligation",entityId:plan.task.id,
   details:{trackId:selection.trackId,packageId:manifest.packageId,previewHash:selection.previewHash,
    archiveSha256:sha256,fileIds:plan.files.map(f=>f.id),fileCount:plan.files.length,notAnApproval:true}}});
 });
 return {bytes:zip,filename:"regpilot-preparation-"+selection.trackId+".zip",sha256};
}
