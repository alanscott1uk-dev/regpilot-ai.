import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import type {EvidenceObjectStore} from "./evidence-storage";
import {privateEvidenceStore} from "./evidence-storage";
import {EvidenceError,MAX_ORG_EVIDENCE_BYTES,MAX_ORG_EVIDENCE_FILES,
 checkPdf,evidenceHash,contentDispositionFilename,objectKey,scanWithClamd
} from "../evidence/file-guard.mjs";

const idOk=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||"");
type Scan=(bytes:Uint8Array)=>Promise<{status:"CLEAN";engine:string}>;
function scannerConfig(){
 const port=Number(process.env.REGPILOT_CLAMD_PORT||"3310");
 if(!Number.isInteger(port)||port<1||port>65535)throw new EvidenceError("Invalid scanner configuration",503);
 return {host:process.env.REGPILOT_CLAMD_HOST||"",port};
}
const productionScan:Scan=async bytes=>scanWithClamd(bytes,scannerConfig());

function canUpload(ctx:AuthorizedContext){return ["OWNER","ADMIN","EDITOR"].includes(ctx.role);}
function recordView(row:any){
 return {id:row.id,organizationId:row.organizationId,obligationId:row.obligationId,
  filename:row.filename,contentType:row.contentType,sizeBytes:row.sizeBytes,sha256:row.sha256,
  scanStatus:row.scanStatus,scannedAt:row.scannedAt,reviewStatus:row.reviewStatus,
  uploadedById:row.uploadedById,reviewerId:row.reviewerId,reviewedAt:row.reviewedAt,
  reviewerNotes:row.reviewerNotes,reviewVersion:row.reviewVersion,createdAt:row.createdAt};
}
export async function listEvidence(ctx:AuthorizedContext,obligationId:string){
 await db.$transaction(tx=>requireMember(tx,ctx));
 if(!idOk(obligationId))throw new EvidenceError("Invalid task ID",400);
 const task=await db.obligation.findFirst({where:{id:obligationId,organizationId:ctx.organizationId},select:{id:true}});
 if(!task)throw new EvidenceError("Task not found",404);
 const rows=await db.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId},orderBy:{createdAt:"desc"},take:100});
 return rows.map(recordView);
}

/** File enters a private bucket ONLY after scan has explicitly returned CLEAN.
 * Insertion is limited atomically by per-organisation quotas.
 */
export async function createEvidence(ctx:AuthorizedContext,taskId:string,filename:string,uploaded:Uint8Array,
 dependencies:{storage?:EvidenceObjectStore;scan?:Scan}={}){
 await db.$transaction(tx=>requireMember(tx,ctx,WRITER));
 if(!canUpload(ctx))throw new EvidenceError("Insufficient permission to upload",403);
 if(!idOk(taskId))throw new EvidenceError("Invalid task ID",400);
 const bytes=checkPdf(uploaded,filename);
 const task=await db.obligation.findFirst({where:{id:taskId,organizationId:ctx.organizationId},select:{id:true}});
 if(!task)throw new EvidenceError("Task not found",404);
 const scanner=dependencies.scan||productionScan;
 const result=await scanner(bytes);
 if(result?.status!=="CLEAN")throw new EvidenceError("Evidence scan not clean",422);
 const hash=evidenceHash(bytes),key=objectKey(ctx.organizationId);
 const store=dependencies.storage||await privateEvidenceStore();
 await store.put(key,bytes);
 try{
  const record=await db.$transaction(async tx=>{
   await requireMember(tx,ctx,WRITER);
   const reserved=await tx.organization.updateMany({
    where:{id:ctx.organizationId,
     evidenceCount:{lt:MAX_ORG_EVIDENCE_FILES},
     evidenceBytes:{lte:BigInt(MAX_ORG_EVIDENCE_BYTES-bytes.byteLength)}},
    data:{evidenceCount:{increment:1},evidenceBytes:{increment:BigInt(bytes.byteLength)}}
   });
   if(reserved.count!==1)throw new EvidenceError("Organisation evidence quota reached",429);
   const row=await tx.evidence.create({data:{
    organizationId:ctx.organizationId,obligationId:taskId,
    filename:contentDispositionFilename(filename),contentType:"application/pdf",storageKey:key,
    sizeBytes:bytes.byteLength,sha256:hash,scanStatus:"CLEAN",scannedAt:new Date(),
    uploadedById:ctx.userId,reviewStatus:"PENDING_REVIEW"
   }});
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
    action:"evidence.scanned_upload",entityType:"Evidence",entityId:row.id,
    details:{taskId,hash,sizeBytes:bytes.byteLength,scanEngine:result.engine}
   }});
   return row;
  },{isolationLevel:"Serializable",timeout:8000,maxWait:4000});
  return recordView(record);
 }catch(error){
  try{await store.remove(key);}catch{ /* follow-up required: orphan object must be reconciled */ }
  throw error;
 }
}
export async function downloadEvidence(ctx:AuthorizedContext,id:string,store?:EvidenceObjectStore){
 await db.$transaction(tx=>requireMember(tx,ctx));
 if(!idOk(id))throw new EvidenceError("Invalid evidence ID",400);
 const record=await db.evidence.findFirst({where:{id,organizationId:ctx.organizationId}});
 if(!record)throw new EvidenceError("Evidence not found",404);
 if(record.scanStatus!=="CLEAN")throw new EvidenceError("Evidence is quarantined",423);
 const backend=store||await privateEvidenceStore();
 const bytes=await backend.get(record.storageKey);
 if(bytes.byteLength!==record.sizeBytes||evidenceHash(bytes)!==record.sha256)
  throw new EvidenceError("File integrity verification failed; download blocked",409);
 await db.$transaction(tx=>requireMember(tx,ctx));
 return {bytes,filename:contentDispositionFilename(record.filename),sha256:record.sha256,contentType:record.contentType};
}
export async function reviewEvidence(ctx:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 if(!idOk(id))throw new EvidenceError("Invalid evidence ID",400);
 if(!["OWNER","ADMIN"].includes(ctx.role))throw new EvidenceError("Independent reviewer permission required",403);
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new EvidenceError("Invalid review",400);
 const input=raw as {decision?:string;notes?:string;version?:number};
 if(!["APPROVED","REJECTED"].includes(input.decision||""))throw new EvidenceError("Invalid evidence review decision",400);
 if(!Number.isInteger(input.version)||Number(input.version)<1)throw new EvidenceError("Invalid evidence version",400);
 if(typeof input.notes!=="string"||input.notes.trim().length<20||input.notes.length>800)
  throw new EvidenceError("Explain the review in 20 to 800 characters",400);
 const notes=input.notes.trim();
 const record=await db.evidence.findFirst({where:{id,organizationId:ctx.organizationId}});
 if(!record)throw new EvidenceError("Evidence not found",404);
 if(record.uploadedById===ctx.userId)throw new EvidenceError("Uploader cannot approve their own evidence",403);
 if(record.reviewStatus!=="PENDING_REVIEW"||record.reviewVersion!==input.version)
  throw new EvidenceError("Evidence already reviewed or version changed",409);
 // Check the *stored bytes*, not merely the attachment flag, before any approval.
 await downloadEvidence(ctx,id,store);
 return db.$transaction(async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const change=await tx.evidence.updateMany({where:{
   id,organizationId:ctx.organizationId,reviewStatus:"PENDING_REVIEW",reviewVersion:input.version,scanStatus:"CLEAN"},
   data:{reviewStatus:input.decision as "APPROVED"|"REJECTED",reviewerId:ctx.userId,
    reviewVersion:{increment:1},reviewerNotes:notes,reviewedAt:new Date()}
  });
  if(change.count!==1)throw new EvidenceError("Evidence review conflict; refresh",409);
  const updated=await tx.evidence.findFirstOrThrow({where:{id,organizationId:ctx.organizationId}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
   action:"evidence.independent_review",entityType:"Evidence",entityId:id,
   details:{decision:input.decision,sha256:updated.sha256,version:updated.reviewVersion}
  }});
  return recordView(updated);
 },{isolationLevel:"Serializable"});
}
