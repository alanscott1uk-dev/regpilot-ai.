import {Prisma,type ProgrammeImport} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {hashValue} from "../regulatory/intelligence";
import {PROGRAMME_ENGINE,findProgrammePassages,groundProgramme,type ImportDocument,type ProgrammeResult} from "../programme/import";
import {downloadEvidence} from "./evidence-service";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {extractPdf} from "./pdf-extraction";
import {generateProgramme} from "./programme-model";
import {aiConfigured} from "./ai-auth";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {z} from "zod";
const j=(v:unknown)=>v as Prisma.InputJsonValue;
export const programmeConfigured=()=>process.env.REGPILOT_PROGRAMME_ENABLED==="true"&&evidenceConfigured();
export const programmeAiEnabled=()=>programmeConfigured()&&aiConfigured()&&process.env.REGPILOT_PROGRAMME_AI_ENABLED==="true";
const prepareSchema=z.object({evidenceIds:z.array(z.uuid()).min(1).max(5).refine(v=>new Set(v).size===v.length),method:z.enum(["SEARCH","AI"]),retry:z.boolean().default(false),consent:z.literal(true)});
const reviewSchema=z.object({version:z.number().int().positive(),keys:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(30).refine(v=>new Set(v).size===v.length),ownerId:z.uuid(),intervalDays:z.number().int().min(7).max(365),firstReview:z.iso.date(),notes:z.string().trim().min(40).max(1200),scopeConfirmed:z.literal(true)});
async function manifest(tx:Prisma.TransactionClient,ctx:AuthorizedContext,ids:string[]){
 const rows=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,id:{in:ids}},orderBy:{id:"asc"},select:{id:true,sha256:true,scanStatus:true,reviewStatus:true,reviewVersion:true,uploadedById:true,reviewerId:true}});
 if(rows.length!==ids.length||rows.some(r=>r.scanStatus!=="CLEAN"))throw new IntelligenceError("Select clean evidence files from this organisation",409);
 return rows;
}
async function assertImport(tx:Prisma.TransactionClient,ctx:AuthorizedContext,row:ProgrammeImport,review=false){
 await requireMember(tx,ctx,review?ADMIN:WRITER);
 const stored=row.evidenceManifest as unknown as Awaited<ReturnType<typeof manifest>>;
 const current=await manifest(tx,ctx,stored.map(r=>r.id));
 if(hashValue(current)!==hashValue(stored))throw new IntelligenceError("Selected evidence changed; prepare a new import",409);
 if(review&&(row.createdById===ctx.userId||current.some(e=>e.uploadedById===ctx.userId)))throw new IntelligenceError("A different administrator must review the programme",403);
 if(review&&current.some(e=>e.reviewStatus!=="APPROVED"||!e.reviewerId||e.reviewerId===e.uploadedById))throw new IntelligenceError("Files need independent approval first",409);
 return current;
}
export async function prepareProgramme(ctx:AuthorizedContext,input:unknown,deps:{storage?:EvidenceObjectStore;generate?:typeof generateProgramme}={}){
 if(!programmeConfigured())throw new IntelligenceError("Programme import is awaiting activation",503);
 const parsed=prepareSchema.safeParse(input);if(!parsed.success)throw new IntelligenceError("Choose up to five PDFs, an import method and processing consent");const data=parsed.data;
 if(data.method==="AI"&&!programmeAiEnabled())throw new IntelligenceError("Programme AI is awaiting activation",503);
 const reservation=await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);const files=await manifest(tx,ctx,data.evidenceIds),inputHash=hashValue({engine:PROGRAMME_ENGINE,files});
  const existing=await tx.programmeImport.findUnique({where:{organizationId_inputHash_method:{organizationId:ctx.organizationId,inputHash,method:data.method}}});if(existing){
   if(!data.retry)return {row:existing,reused:true};
   if(existing.attempts>=3||!(existing.status==="FAILED"||existing.status==="PROCESSING"&&Date.now()-existing.lastStartedAt.getTime()>600000))throw new IntelligenceError("Only failed or interrupted imports can be retried, with a maximum of three attempts",409);
   const row=await tx.programmeImport.update({where:{id:existing.id},data:{status:"PROCESSING",version:{increment:1},attempts:{increment:1},lastStartedAt:new Date(),createdById:ctx.userId,result:Prisma.DbNull,resultHash:null}});return {row,reused:false};
  }
  if(await tx.programmeImport.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new IntelligenceError("Daily programme import limit reached",429);
  const row=await tx.programmeImport.create({data:{organizationId:ctx.organizationId,createdById:ctx.userId,inputHash,method:data.method,evidenceManifest:j(files)}});return {row,reused:false};
 });
 if(reservation.reused)return {id:reservation.row.id,reused:true};const row=reservation.row;
 try{
  const docs:ImportDocument[]=[];let characters=0;
  for(const id of data.evidenceIds){const file=await downloadEvidence(ctx,id,deps.storage);const saved=(row.evidenceManifest as any[]).find(e=>e.id===id);if(file.sha256!==saved.sha256)throw new IntelligenceError("Evidence changed",409);const document=await extractPdf(file.bytes);characters+=document.characters;if(characters>60000)throw new IntelligenceError("Use a smaller selection: import is limited to 60,000 extracted characters",413);docs.push({id,filename:file.filename,document});}
  await transaction(ctx,tx=>assertImport(tx,ctx,row));
  if(!programmeConfigured()||data.method==="AI"&&!programmeAiEnabled())throw new IntelligenceError("Import activation changed",503);
  if(data.method==="AI")await reserveAiRequest(ctx,"programme-import");
  const result=data.method==="AI"?groundProgramme(await (deps.generate||generateProgramme)(docs),docs):findProgrammePassages(docs);
  await transaction(ctx,async tx=>{await assertImport(tx,ctx,row);if(!programmeConfigured()||data.method==="AI"&&!programmeAiEnabled())throw new IntelligenceError("Import activation changed",503);
   const saved=await tx.programmeImport.updateMany({where:{id:row.id,organizationId:ctx.organizationId,status:"PROCESSING",version:row.version},data:{status:"DRAFT",result:j(result),resultHash:hashValue(result)}});if(!saved.count)throw new IntelligenceError("Import was removed or superseded",409);
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"programme.import_prepared",entityType:"ProgrammeImport",entityId:row.id,details:{controls:result.controls.length,rejected:result.rejected,inputHash:row.inputHash}}});
  });return {id:row.id,reused:false};
 }catch(error){await db.programmeImport.updateMany({where:{id:row.id,organizationId:ctx.organizationId,status:"PROCESSING",version:row.version},data:{status:"FAILED"}});if(error instanceof DailyLimitError)throw new IntelligenceError(error.message,429);throw error;}
}
export async function acceptProgramme(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 if(!programmeConfigured())throw new IntelligenceError("Programme import is awaiting activation",503);
 const parsed=reviewSchema.safeParse(input);if(!parsed.success)throw new IntelligenceError("Choose proposals, an owner, a valid review date and review rationale");const data=parsed.data;
 const first=new Date(data.firstReview+"T00:00:00Z"),today=new Date().toISOString().slice(0,10);
 if(data.firstReview<today||first.getTime()>Date.now()+366*86400000)throw new IntelligenceError("First review must be today or within the next year");
 const row=await db.programmeImport.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError("Import not found",404);
 await transaction(ctx,tx=>assertImport(tx,ctx,row,true));
 if(!row.result||hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Import integrity check failed",409);
 const result=row.result as unknown as ProgrammeResult;
 if(result.documents.some(d=>d.truncated||d.skippedPages.length))throw new IntelligenceError("Resolve incomplete extraction before accepting controls",409);
 if(data.keys.some(k=>!result.controls.some(c=>c.key===k)))throw new IntelligenceError("Unknown control proposal",400);
 for(const file of row.evidenceManifest as any[]){const original=await downloadEvidence(ctx,file.id,deps.storage);if(original.sha256!==file.sha256)throw new IntelligenceError("Evidence bytes changed",409);}
 return transaction(ctx,async tx=>{
  await assertImport(tx,ctx,row,true);
  const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:data.ownerId}},include:{user:{select:{email:true}}}});if(!owner||owner.role==="VIEWER")throw new IntelligenceError("Choose an active team member who can work on tasks",409);
  const saved=await tx.programmeImport.updateMany({where:{id,organizationId:ctx.organizationId,status:"DRAFT",version:data.version,resultHash:row.resultHash},data:{status:"ACCEPTED",reviewerId:ctx.userId,reviewedAt:new Date(),reviewNotes:data.notes,version:{increment:1}}});if(!saved.count)throw new IntelligenceError("Import changed or was already reviewed",409);
  const ids:string[]=[];
  for(const proposal of result.controls.filter(c=>data.keys.includes(c.key))){const control=await tx.managedControl.create({data:{organizationId:ctx.organizationId,importId:id,proposalKey:proposal.key,title:proposal.title,description:proposal.description,testProcedure:proposal.testProcedure,theme:proposal.theme,ownerId:data.ownerId,scheduledById:ctx.userId,intervalDays:data.intervalDays,nextReviewAt:first}});ids.push(control.id);}
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"programme.controls_accepted",entityType:"ProgrammeImport",entityId:id,details:{controlIds:ids,ownerId:data.ownerId,intervalDays:data.intervalDays}}});return {id,controlIds:ids};
 });
}
export async function redactProgramme(ctx:AuthorizedContext,id:string,version:number){
 if(!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid import version");
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const changed=await tx.programmeImport.updateMany({where:{id,organizationId:ctx.organizationId,version,status:{not:"REDACTED"}},data:{status:"REDACTED",result:Prisma.DbNull,resultHash:null,evidenceManifest:[],reviewNotes:"",version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Import changed",409);
 const controls=await tx.managedControl.findMany({where:{organizationId:ctx.organizationId,importId:id},select:{id:true}}),ids=controls.map(c=>c.id);
 await tx.managedControl.updateMany({where:{organizationId:ctx.organizationId,id:{in:ids}},data:{enabled:false,description:"Retained content removed",testProcedure:"Retained content removed",title:"Removed programme control",version:{increment:1}}});
 await tx.evidenceConnector.updateMany({where:{organizationId:ctx.organizationId,controlId:{in:ids}},data:{enabled:false,encryptedSecret:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"programme.content_removed",entityType:"ProgrammeImport",entityId:id,details:{affectedControls:ids.length}}});return {id};
 });
}
