import {Prisma,type AssuranceAssessment} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {aiConfigured} from "./ai-auth";
import {allowedEmail} from "../ai/security.mjs";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {downloadEvidence} from "./evidence-service";
import {extractDocument} from "./document-extraction";
import {extractionBlocked} from "../documents/coverage";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";
import {hashValue,type Analysis} from "../regulatory/intelligence";
import {ASSURANCE_ENGINE,contentAssessment,groundedAssessment,assertPassages,type AssuranceResult,type EvidenceDocument,type EvidenceManifest} from "../evidence/assurance";
import {generateAssurance,type AssuranceModelInput} from "./assurance-model";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {EvidenceError,MAX_ORG_EVIDENCE_FILES} from "../evidence/file-guard.mjs";
import {requireMember,ADMIN,WRITER} from "./workspace-member";

export function assuranceConfigured(){return evidenceConfigured()&&process.env.REGPILOT_ASSURANCE_ENABLED==="true";}
export function assuranceAiConfigured(){return assuranceConfigured()&&aiConfigured()&&process.env.REGPILOT_ASSURANCE_AI_ENABLED==="true"&&process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED==="true";}
const json=(v:unknown)=>v as Prisma.InputJsonValue;
const uuid=(s:string)=>/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(s);
type Dependencies={storage?:EvidenceObjectStore;generate?:(input:AssuranceModelInput)=>Promise<unknown>};
// Hash integrity alone cannot establish that stored JSON is safe to inspect.
const storedAssessmentResult=z.object({
  engineVersion:z.string(),sourceQuote:z.string(),method:z.enum(["CONTENT_SEARCH","AI"]),rejectedClaims:z.number().int().nonnegative(),warnings:z.array(z.string()),
  passages:z.array(z.object({key:z.string().regex(/^[a-f0-9]{64}$/),evidenceId:z.string().uuid(),page:z.number().int().positive(),start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),quote:z.string(),matchedTerms:z.array(z.string()),negationDetected:z.boolean(),unitKind:z.enum(["page","block"]).optional(),label:z.string().optional()})).max(47),
  checks:z.array(z.object({criterion:z.string(),sourceQuote:z.string(),verdict:z.enum(["SUPPORTED","CONTRADICTED","NOT_FOUND","UNASSESSED"]),explanation:z.string(),passageKeys:z.array(z.string())})).min(1).max(8),
  documents:z.array(z.object({id:z.string().uuid(),filename:z.string(),totalPages:z.number().int().nonnegative(),extractedPages:z.number().int().nonnegative(),truncated:z.boolean(),skippedPages:z.array(z.number().int()),blockingIssues:z.array(z.string()).optional(),unitKind:z.enum(["page","block"]).optional(),format:z.enum(["PDF","DOCX"]).optional()})).min(1).max(3)
});
const resultIsStructured=(value:unknown):value is AssuranceResult=>storedAssessmentResult.safeParse(value).success;
const storedManifest=z.array(z.object({id:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),reviewVersion:z.number().int().positive(),reviewStatus:z.string(),uploadedById:z.string().uuid().nullable(),reviewerId:z.string().uuid().nullable(),scanStatus:z.string(),obligationId:z.string().uuid()})).min(1).max(3);
function manifestProjection(value:unknown){const parsed=storedManifest.safeParse(value);return parsed.success?parsed.data:null;}
async function member(tx:Prisma.TransactionClient,ctx:AuthorizedContext,review=false){
  if(!(review?["OWNER","ADMIN"]:["OWNER","ADMIN","EDITOR"]).includes(ctx.role))throw new IntelligenceError("Your role cannot perform this assessment action",403);
  const m=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}},include:{user:{select:{email:true}}}});
  if(!m||!(review?["OWNER","ADMIN"]:["OWNER","ADMIN","EDITOR"]).includes(m.role)||!allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Your workspace permissions changed",403);
}
function manifestRow(e:{id:string;sha256:string;reviewVersion:number;reviewStatus:string;uploadedById:string|null;reviewerId:string|null;scanStatus:string;obligationId:string}):EvidenceManifest{
  return {id:e.id,sha256:e.sha256,reviewVersion:e.reviewVersion,reviewStatus:e.reviewStatus,uploadedById:e.uploadedById,reviewerId:e.reviewerId,scanStatus:e.scanStatus,obligationId:e.obligationId};
}
async function context(tx:Prisma.TransactionClient,organizationId:string,taskId:string,evidenceIds:string[]){
  const task=await tx.obligation.findFirst({where:{id:taskId,organizationId}});
  if(!task)throw new IntelligenceError("Task not found",404);
  const decision=await tx.intelligenceDecision.findFirst({where:{organizationId,obligationId:taskId,decision:"ACCEPTED"},include:{run:{include:{snapshot:true}}}});
  if(!decision||hashValue(decision.run.result)!==decision.run.resultHash||sourceTextHash(decision.run.snapshot.bodyText)!==decision.run.snapshot.contentHash)throw new IntelligenceError("This task needs a valid accepted source recommendation before evidence assessment",409);
  const candidate=(decision.run.result as unknown as Analysis).candidates.find(c=>c.key===decision.candidateKey);
  if(!candidate||decision.run.snapshot.bodyText.slice(candidate.start,candidate.end)!==candidate.quote)throw new IntelligenceError("Original source passage failed verification",409);
  const snapshot=await tx.regulatorySnapshot.findFirst({where:{organizationId,sourceId:decision.run.snapshot.sourceId},orderBy:{firstCapturedAt:"desc"}});
  if(!snapshot||sourceTextHash(snapshot.bodyText)!==snapshot.contentHash||!snapshot.bodyText.includes(candidate.quote))throw new IntelligenceError("The source requirement changed. Reassess the task against the current source first.",409);
  const profile=await tx.businessProfile.findUnique({where:{organizationId}});
  if(!profile)throw new IntelligenceError("Save your business context first",409);
  const evidence=await tx.evidence.findMany({where:{organizationId,id:{in:evidenceIds}},orderBy:{id:"asc"}});
  if(evidence.length!==evidenceIds.length)throw new IntelligenceError("One or more selected files are unavailable in this organisation",404);
  if(evidence.some(e=>e.scanStatus!=="CLEAN"))throw new IntelligenceError("Quarantined evidence cannot be assessed",423);
  const manifest=evidence.map(manifestRow);
  const inputHash=hashValue({engine:ASSURANCE_ENGINE,taskId,title:task.title,sourceHash:snapshot.contentHash,snapshotId:snapshot.id,sourceQuote:candidate.quote,profileVersion:profile.version,manifest});
  return {task,decision,candidate,snapshot,profile,evidence,manifest,inputHash};
}
async function documents(ctx:AuthorizedContext,manifest:EvidenceManifest[],storage?:EvidenceObjectStore){
  const result:EvidenceDocument[]=[];
  for(const row of manifest){
    const stored=await downloadEvidence(ctx,row.id,storage);
    if(stored.sha256!==row.sha256)throw new IntelligenceError("Selected evidence changed; prepare a fresh assessment",409);
    result.push({id:row.id,filename:stored.filename,document:await extractDocument(stored.bytes,stored.filename)});
  }
  return result;
}
export async function prepareAssurance(ctx:AuthorizedContext,input:{taskId:string;evidenceIds:string[];method:string;consent?:unknown},dependencies:Dependencies={}){
  if(!uuid(input.taskId)||!Array.isArray(input.evidenceIds)||input.evidenceIds.length<1||input.evidenceIds.length>3||new Set(input.evidenceIds).size!==input.evidenceIds.length||input.evidenceIds.some(id=>!uuid(id))||!["CONTENT_SEARCH","AI"].includes(input.method))throw new IntelligenceError("Choose a source-linked task and one to three distinct evidence files");
  if(input.consent!==true)throw new IntelligenceError("Confirm processing selected files and saving quoted passages for independent review");
  if(input.method==="AI"&&!assuranceAiConfigured())throw new IntelligenceError("AI evidence assessment is not activated",503);
  const prepared=await transaction(ctx,async tx=>{
    await member(tx,ctx);const current=await context(tx,ctx.organizationId,input.taskId,input.evidenceIds);
    const existing=await tx.assuranceAssessment.findUnique({where:{organizationId_inputHash_method:{organizationId:ctx.organizationId,inputHash:current.inputHash,method:input.method}}});
    if(existing){if(["PROCESSING","FAILED","REDACTED"].includes(existing.status))throw new IntelligenceError("This assessment attempt is pending or unavailable. Automatic repeats are blocked; use another method or updated evidence.",409);return {existing};}
    if(await tx.assuranceAssessment.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=20)throw new IntelligenceError("The daily limit of 20 evidence assessments has been reached",429);
    const row=await tx.assuranceAssessment.create({data:{organizationId:ctx.organizationId,obligationId:input.taskId,snapshotId:current.snapshot.id,profileVersion:current.profile.version,inputHash:current.inputHash,engineVersion:ASSURANCE_ENGINE,method:input.method,evidenceManifest:json(current.manifest),createdById:ctx.userId}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"assurance.processing_consented",entityType:"AssuranceAssessment",entityId:row.id,details:{method:input.method,inputHash:current.inputHash,evidenceCount:input.evidenceIds.length}}});
    return {row,current};
  });
  if(prepared.existing)return {id:prepared.existing.id,reused:true};
  const {row,current}=prepared;
  try{
    const extracted=await documents(ctx,current!.manifest,dependencies.storage);
    let result=contentAssessment(current!.candidate.quote,extracted);
    if(input.method==="AI"){
      if(extracted.reduce((n,d)=>n+d.document.characters,0)>60000)throw new IntelligenceError("AI assessment supports 60,000 extracted characters in total. Choose shorter documents or use content search.",413);
      // Recheck tenancy and context after slow file parsing, before spending a request.
      await transaction(ctx,async tx=>{await member(tx,ctx);const fresh=await context(tx,ctx.organizationId,input.taskId,input.evidenceIds);if(fresh.inputHash!==current!.inputHash)throw new IntelligenceError("Assessment inputs changed during extraction",409);});
      if(!assuranceAiConfigured())throw new IntelligenceError("AI evidence assessment was disabled",503);
      await reserveAiRequest(ctx,"evidence-assurance");
      result=groundedAssessment(await (dependencies.generate||generateAssurance)({sourceQuote:current!.candidate.quote,documents:extracted}),current!.candidate.quote,extracted);
    }
    return await transaction(ctx,async tx=>{
      await member(tx,ctx);const fresh=await context(tx,ctx.organizationId,input.taskId,input.evidenceIds);
      if(fresh.inputHash!==current!.inputHash||(input.method==="AI"&&!assuranceAiConfigured()))throw new IntelligenceError("Inputs or permissions changed. Draft discarded.",409);
      const saved=await tx.assuranceAssessment.updateMany({where:{id:row!.id,organizationId:ctx.organizationId,status:"PROCESSING",version:1},data:{status:"DRAFT",result:json(result),resultHash:hashValue(result)}});
      if(!saved.count)throw new IntelligenceError("Assessment was removed or changed during processing. Output discarded.",409);
      await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"assurance.draft_prepared",entityType:"AssuranceAssessment",entityId:row!.id,details:{inputHash:current!.inputHash,resultHash:hashValue(result),method:input.method,rejectedClaims:result.rejectedClaims}}});
      return {id:row!.id,reused:false};
    });
  }catch(e){
    await db.assuranceAssessment.updateMany({where:{id:row!.id,status:"PROCESSING"},data:{status:"FAILED",failureCode:e instanceof DailyLimitError?"DAILY_LIMIT":e instanceof IntelligenceError?"CONTEXT_OR_LIMIT":"EXTRACTION_OR_PROVIDER"}});
    if(e instanceof IntelligenceError)throw e;
    if(e instanceof EvidenceError)throw new IntelligenceError(e.message,e.status);
    throw new IntelligenceError(e instanceof DailyLimitError?"Daily AI allowance reached":"Evidence assessment failed. No review decision was recorded.",e instanceof DailyLimitError?429:422);
  }
}
async function assessmentState(tx:Prisma.TransactionClient,organizationId:string,row:AssuranceAssessment,expiryBypassedForExplicitRenewal=false){
  if(!row.result||hashValue(row.result)!==row.resultHash||!resultIsStructured(row.result))return {valid:false,reason:"Assessment content failed integrity verification"};
  if(!manifestProjection(row.evidenceManifest))return {valid:false,reason:"The assessment evidence manifest is unavailable or invalid"};
  if(row.status==="ACCEPTED"&&(!row.reviewerId||row.reviewerId===row.createdById||!row.reviewedAt||!Array.isArray(row.selectedPassages)||!row.selectedPassages.length||row.selectedPassages.length>8||new Set(row.selectedPassages).size!==row.selectedPassages.length||row.selectedPassages.some(key=>typeof key!=="string"||!row.result||!(row.result as unknown as AssuranceResult).passages.some(p=>p.key===key))||(row.evidenceManifest as unknown as EvidenceManifest[]).some(e=>e.uploadedById===row.reviewerId)))return {valid:false,reason:"Independent assessment approval could not be established"};
  if(row.status==="ACCEPTED"&&(!row.validUntil||!expiryBypassedForExplicitRenewal&&row.validUntil.getTime()<=Date.now()))return {valid:false,reason:"The evidence review period has expired"};
  if(row.status==="ACCEPTED"){
    const newer=await tx.assuranceAssessment.findMany({where:{organizationId,obligationId:row.obligationId,createdAt:{gt:row.createdAt},status:{in:["DRAFT","NEEDS_WORK","ACCEPTED","REDACTED"]}},take:21,orderBy:[{createdAt:"desc"},{id:"desc"}],select:{status:true,result:true,resultHash:true}});
    if(newer.length>20)return {valid:false,reason:"More recent assessments require review before this decision can be relied on"};
    if(newer.some(a=>a.status!=="DRAFT"||!a.result||hashValue(a.result)!==a.resultHash||!resultIsStructured(a.result)||(a.result as unknown as AssuranceResult).checks.some(c=>["CONTRADICTED","NOT_FOUND"].includes(c.verdict))))return {valid:false,reason:"A newer assessment supersedes this decision or identifies unresolved gaps"};
  }
  try{
    const manifest=row.evidenceManifest as unknown as EvidenceManifest[];
    const fresh=await context(tx,organizationId,row.obligationId,manifest.map(e=>e.id));
    if(fresh.inputHash!==row.inputHash)return {valid:false,reason:"Source, business context or evidence changed"};
    if(fresh.snapshot.reviewStatus!=="REVIEWED"||Date.now()-fresh.snapshot.lastCheckedAt.getTime()>7*86400000)return {valid:false,reason:"The source needs a current independent review"};
    if(fresh.evidence.some(e=>e.reviewStatus!=="APPROVED"||!e.reviewedAt||!e.uploadedById||!e.reviewerId||e.uploadedById===e.reviewerId))return {valid:false,reason:"Selected files need independent approval"};
    return {valid:true,reason:null};
  }catch{return {valid:false,reason:"Supporting context is unavailable or changed"};}
}
/** Normal callers must always enforce the saved review period. */
export async function currentAssessment(tx:Prisma.TransactionClient,organizationId:string,row:AssuranceAssessment){
  return assessmentState(tx,organizationId,row);
}
/** Only the explicit renewal workflow may disregard elapsed time; every other guard still applies. */
async function currentAssessmentExceptExpiryForExplicitRenewal(tx:Prisma.TransactionClient,organizationId:string,row:AssuranceAssessment){
  return assessmentState(tx,organizationId,row,true);
}
export async function completionAssessment(tx:Prisma.TransactionClient,organizationId:string,taskId:string){
  const assessment=await tx.assuranceAssessment.findFirst({where:{organizationId,obligationId:taskId,status:"ACCEPTED"},orderBy:{createdAt:"desc"}});
  if(!assessment||(await currentAssessment(tx,organizationId,assessment)).valid!==true)throw new Error("Completion requires a current independently accepted evidence assessment for this source-linked task");
  return assessment;
}
export async function assuranceWorkspace(ctx:AuthorizedContext,taskId?:string,assessmentId?:string){
  if(taskId&&!uuid(taskId))throw new IntelligenceError("Invalid task identifier");
  if(assessmentId&&(!uuid(assessmentId)||!taskId))throw new IntelligenceError("Choose the task and a valid assessment identifier");
  const taskSelect={id:true,title:true,status:true,ownerName:true,dueDate:true} as const;
  const taskScope={organizationId:ctx.organizationId,originKey:{not:null}};
  const [page,evidence]=await Promise.all([
    db.obligation.findMany({where:taskScope,orderBy:[{dueDate:"asc"},{id:"asc"}],take:101,select:taskSelect}),
    db.evidence.findMany({where:{organizationId:ctx.organizationId},orderBy:{createdAt:"desc"},take:MAX_ORG_EVIDENCE_FILES,select:{id:true,obligationId:true,filename:true,sha256:true,reviewVersion:true,reviewStatus:true,scanStatus:true,uploadedById:true,reviewerId:true}})
  ]);
  const tasks=page.slice(0,100);
  if(taskId && !tasks.some(task=>task.id===taskId)){
    const linked=await db.obligation.findFirst({where:{...taskScope,id:taskId},select:taskSelect});
    if(!linked)throw new IntelligenceError("Source-linked task unavailable in this organisation",404);
    tasks.unshift(linked);
  }
  const selected=taskId||tasks[0]?.id;let source:null|{quote:string;title:string;url:string;hash:string}=null,contextIssue:string|null=null;
  const assessmentPage=selected?await db.assuranceAssessment.findMany({where:{organizationId:ctx.organizationId,obligationId:selected},orderBy:[{createdAt:"desc"},{id:"desc"}],take:11}):[];
  const assessments=assessmentPage.slice(0,10);
  if(assessmentId&&!assessments.some(row=>row.id===assessmentId)){
    const linked=await db.assuranceAssessment.findFirst({where:{id:assessmentId,organizationId:ctx.organizationId,obligationId:selected}});
    if(!linked)throw new IntelligenceError("The linked assessment is unavailable for this task",404);
    assessments.push(linked);
  }
  if(selected){try{const c=await context(db,ctx.organizationId,selected,[]);source={quote:c.candidate.quote,title:c.snapshot.title,url:c.snapshot.url,hash:c.snapshot.contentHash};}catch(error){if(error instanceof IntelligenceError&&error.status===404)throw error;contextIssue=error instanceof IntelligenceError?error.message:"Source context unavailable";}}
  const reviews=await Promise.all(assessments.map(async row=>{
    const manifest=manifestProjection(row.evidenceManifest),state=["PROCESSING","FAILED","REDACTED"].includes(row.status)?{valid:false,reason:row.status==="PROCESSING"?"Processing has not completed; refresh to check its status.":row.status==="REDACTED"?"Retained assessment content was removed.":"Processing did not complete. Check the files and prepare updated evidence."}:await currentAssessment(db,ctx.organizationId,row),integrityValid=!!manifest&&!!row.result&&hashValue(row.result)===row.resultHash&&resultIsStructured(row.result);
    return {id:row.id,obligationId:row.obligationId,createdById:row.createdById,createdAt:row.createdAt,method:row.method,status:row.status==="PROCESSING"&&Date.now()-row.createdAt.getTime()>180000?"INTERRUPTED":row.status,version:row.version,result:integrityValid?row.result:null,integrityValid,reviewNotes:row.reviewNotes,reviewerId:row.reviewerId,reviewedAt:row.reviewedAt,selectedPassages:Array.isArray(row.selectedPassages)?row.selectedPassages.filter(key=>typeof key==="string"&&/^[a-f0-9]{64}$/.test(key)).slice(0,8):[],validUntil:row.validUntil,evidenceManifest:manifest||[],current:state.valid,reason:state.reason};
  }));
  const accepted=reviews.find(r=>r.status==="ACCEPTED"&&r.current),latest=reviews[0];
  const nextStep=contextIssue||(!selected?"Accept a source recommendation in the regulatory inbox first.":accepted?"Evidence assessment is current. Check the task outcome before marking it complete.":latest?.status==="DRAFT"&&latest.current?"An independent administrator can now check the quoted passages and record a scoped decision.":latest?.reason?latest.reason:"Choose supporting files and prepare a content-level assessment.");
  return {tasks,evidence,selectedTaskId:selected||null,selectedAssessmentId:assessmentId||reviews[0]?.id||null,source,contextIssue,assessments:reviews,nextStep,aiEnabled:assuranceAiConfigured(),taskLimitReached:page.length>100,assessmentLimitReached:assessmentPage.length>10};
}
export async function exportAssurance(ctx:AuthorizedContext,id:string){
  if(!uuid(id))throw new IntelligenceError("Invalid assessment identifier");
  return transaction(ctx,async tx=>{
    const row=await tx.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId},include:{obligation:{select:{id:true,title:true,status:true}},snapshot:{select:{id:true,sourceId:true,title:true,url:true,contentHash:true,lastCheckedAt:true,reviewStatus:true}}}});
    if(!row)throw new IntelligenceError("Assessment not found",404);
    if(row.status==="REDACTED")throw new IntelligenceError("Quoted content was removed",410);
    if(!row.result||hashValue(row.result)!==row.resultHash||!resultIsStructured(row.result))throw new IntelligenceError("Assessment is unavailable or failed integrity verification",409);
    const state=await currentAssessment(tx,ctx.organizationId,row);
    const payload={format:"regpilot-evidence-assessment",version:1,exportedAt:new Date().toISOString(),organizationId:ctx.organizationId,task:row.obligation,source:row.snapshot,evidence:row.evidenceManifest,assessment:{id:row.id,engineVersion:row.engineVersion,method:row.method,status:row.status,inputHash:row.inputHash,resultHash:row.resultHash,result:row.result,reviewerId:row.reviewerId,reviewNotes:row.reviewNotes,selectedPassages:row.selectedPassages,reviewedAt:row.reviewedAt,validUntil:row.validUntil},currentAtExport:state.valid,reviewNeeded:state.reason,scope:"Scoped evidence review record, not legal certification. Contains selected quotations; original PDFs are not included."};
    // Hash the serialized wire representation (including ISO dates), not Date objects.
    const wire=JSON.parse(JSON.stringify(payload));
    const result={...wire,exportHash:hashValue(wire),hashPurpose:"Content integrity only. This is not a digital signature or proof of authenticity."};
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"assurance.record_exported",entityType:"AssuranceAssessment",entityId:id,details:{exportHash:result.exportHash,currentAtExport:state.valid}}});
    return result;
  });
}
export async function reviewAssurance(ctx:AuthorizedContext,id:string,input:{decision:string;version:number;notes:string;passageKeys?:string[];validUntil?:string;scopeConfirmed?:unknown;originalsChecked?:unknown},dependencies:Dependencies={}){
  if(!uuid(id)||!Number.isInteger(input.version)||input.version<1||!["ACCEPTED","NEEDS_WORK","REDACTED"].includes(input.decision)||typeof input.notes!=="string"||input.notes.trim().length<40||input.notes.length>1200)throw new IntelligenceError("Choose a decision, current version and rationale of 40 to 1,200 characters");
  const row=await db.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError("Assessment not found",404);
  if(row.version!==input.version||row.status==="REDACTED"||(input.decision!=="REDACTED"&&row.status!=="DRAFT"))throw new IntelligenceError("This assessment changed or was already reviewed",409);
  if(input.decision!=="REDACTED"&&(row.createdById===ctx.userId||(row.evidenceManifest as unknown as EvidenceManifest[]).some(e=>e.uploadedById===ctx.userId)))throw new IntelligenceError("A different administrator who did not upload the selected files must review this assessment",403);
  let validUntil:Date|null=null;
  if(input.decision==="ACCEPTED"){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil||""))throw new IntelligenceError("Choose when evidence must be reviewed again");
    validUntil=new Date(input.validUntil+"T23:59:59.999Z");
    if(Number.isNaN(validUntil.getTime())||validUntil.toISOString().slice(0,10)!==input.validUntil||validUntil.getTime()<=Date.now()||validUntil.getTime()>Date.now()+90*86400000)throw new IntelligenceError("The next evidence review must be within 90 days");
    if(input.scopeConfirmed!==true||input.originalsChecked!==true)throw new IntelligenceError("Confirm the business scope and that you checked the original PDFs");
    if(!row.result||hashValue(row.result)!==row.resultHash||!resultIsStructured(row.result))throw new IntelligenceError("Assessment integrity check failed",409);
    const result=row.result as unknown as AssuranceResult;
    if(result.rejectedClaims||result.documents.some(extractionBlocked)||result.checks.some(c=>["CONTRADICTED","NOT_FOUND"].includes(c.verdict)))throw new IntelligenceError("Resolve contradictions, missing proof or incomplete extraction before accepting this assessment",409);
    if(result.method==="AI"&&result.checks.some(c=>c.verdict!=="SUPPORTED"))throw new IntelligenceError("Every AI check needs supported evidence before this draft can be accepted",409);
    // Read-only preflight before accessing bytes; DB transaction repeats the checks after parsing.
    await transaction(ctx,async tx=>{await member(tx,ctx,true);const state=await currentAssessment(tx,ctx.organizationId,row);if(!state.valid)throw new IntelligenceError(state.reason!,409);});
    const extracted=await documents(ctx,row.evidenceManifest as unknown as EvidenceManifest[],dependencies.storage);
    try{assertPassages(result,extracted,input.passageKeys||[]);}catch{throw new IntelligenceError("Selected passages did not pass PDF verification",409);}
  }
  return transaction(ctx,async tx=>{
    await member(tx,ctx,true);
    const current=await tx.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId}});
    if(!current||current.version!==input.version||(input.decision!=="REDACTED"&&current.status!=="DRAFT")||current.status==="REDACTED")throw new IntelligenceError("This assessment changed or was already reviewed",409);
    if(input.decision==="ACCEPTED"&&current.resultHash!==row.resultHash)throw new IntelligenceError("Assessment content changed during review",409);
    if(input.decision==="ACCEPTED"){const state=await currentAssessment(tx,ctx.organizationId,current);if(!state.valid)throw new IntelligenceError(state.reason!,409);}
    const update=await tx.assuranceAssessment.updateMany({where:{id,organizationId:ctx.organizationId,version:input.version,status:current.status},data:{status:input.decision,reviewerId:ctx.userId,reviewNotes:input.decision==="REDACTED"?"":input.notes.trim(),selectedPassages:input.decision==="ACCEPTED"?input.passageKeys!:[],reviewedAt:new Date(),validUntil,version:{increment:1},...(input.decision==="REDACTED"?{result:Prisma.DbNull,resultHash:null,evidenceManifest:[]}: {})}});
    if(!update.count)throw new IntelligenceError("Another reviewer saved first. Refresh.",409);
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"assurance."+input.decision.toLowerCase(),entityType:"AssuranceAssessment",entityId:id,details:{inputHash:current.inputHash,resultHash:current.resultHash,version:input.version+1,validUntil:validUntil?.toISOString()||null}}});
    return {id,status:input.decision};
  });
}

type RenewalInput={version:number;notes:string;passageKeys:string[];validUntil:Date;scopeConfirmed:true;originalsChecked:true};
/** Pure validation shared by the renewal service and its boundary tests. */
export function parseAssuranceRenewal(raw:unknown,now=new Date()):RenewalInput {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(key=>!["version","notes","passageKeys","validUntil","scopeConfirmed","originalsChecked"].includes(key)))throw new IntelligenceError("Enter an explicit evidence review renewal");
  const input=raw as Record<string,unknown>;
  if(typeof input.version!=="number"||!Number.isSafeInteger(input.version)||input.version<1||typeof input.notes!=="string"||input.notes.trim().length<40||input.notes.length>1200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.notes))throw new IntelligenceError("Choose the current review version and explain the renewed scope in 40 to 1,200 characters");
  if(input.scopeConfirmed!==true||input.originalsChecked!==true)throw new IntelligenceError("Confirm the business scope and that you inspected the original documents again");
  if(!Array.isArray(input.passageKeys)||input.passageKeys.length<1||input.passageKeys.length>8||new Set(input.passageKeys).size!==input.passageKeys.length||input.passageKeys.some(key=>typeof key!=="string"||!/^[a-f0-9]{64}$/.test(key)))throw new IntelligenceError("Select one to eight distinct verified evidence passages");
  if(typeof input.validUntil!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil))throw new IntelligenceError("Choose the next evidence review date");
  const validUntil=new Date(input.validUntil+"T23:59:59.999Z");
  if(Number.isNaN(validUntil.getTime())||validUntil.toISOString().slice(0,10)!==input.validUntil||validUntil.getTime()<=now.getTime()||validUntil.getTime()>now.getTime()+90*86400000)throw new IntelligenceError("The next evidence review must be within 90 days");
  return {version:input.version,notes:input.notes.trim(),passageKeys:[...input.passageKeys] as string[],validUntil,scopeConfirmed:true,originalsChecked:true};
}
type RenewalCheck={eligible:false;reason:string}|{eligible:true;reason:null;row:AssuranceAssessment;fresh:Awaited<ReturnType<typeof context>>;result:AssuranceResult;fingerprint:string};
const renewalWire=(value:unknown)=>JSON.parse(JSON.stringify(value));
const renewalScope="A fresh independent review of unchanged supporting context. Original completion receipts remain historical records. Renewal does not certify legal compliance or automatically extend a task's completion record.";
function reviewMetadata(row:AssuranceAssessment){
  return renewalWire({status:row.status,version:row.version,reviewerId:row.reviewerId,reviewedAt:row.reviewedAt,validUntil:row.validUntil,reviewNotes:row.reviewNotes,selectedPassages:row.selectedPassages,inputHash:row.inputHash,resultHash:row.resultHash});
}
/** This check never downloads originals, invokes a model, or writes a review. */
async function renewalCheck(tx:Prisma.TransactionClient,ctx:AuthorizedContext,row:AssuranceAssessment):Promise<RenewalCheck>{
  const actor=await requireMember(tx,ctx);
  if(!ADMIN.includes(actor.role))return {eligible:false,reason:"An independent administrator or owner must renew this evidence review"};
  if(row.status!=="ACCEPTED")return {eligible:false,reason:"Only an accepted evidence assessment can be renewed"};
  if(row.createdById===ctx.userId||Array.isArray(row.evidenceManifest)&&(row.evidenceManifest as unknown as EvidenceManifest[]).some(file=>file?.uploadedById===ctx.userId))return {eligible:false,reason:"A different administrator who neither prepared this assessment nor uploaded its files must renew it"};
  const state=await currentAssessmentExceptExpiryForExplicitRenewal(tx,ctx.organizationId,row);
  if(!state.valid)return {eligible:false,reason:state.reason!};
  const result=row.result as unknown as AssuranceResult;
  if(result.engineVersion!==row.engineVersion||result.method!==row.method||!Array.isArray(result.documents)||!result.documents.length||!Array.isArray(result.checks)||!result.checks.length||!Array.isArray(result.passages)||!result.passages.length||typeof result.rejectedClaims!=="number"||result.rejectedClaims!==0||result.documents.some(extractionBlocked)||result.checks.some(check=>!["SUPPORTED","UNASSESSED"].includes(check.verdict))||result.method==="AI"&&result.checks.some(check=>check.verdict!=="SUPPORTED"))return {eligible:false,reason:"Resolve missing proof, conflicting claims or incomplete extraction before renewing this review"};
  const fresh=await context(tx,ctx.organizationId,row.obligationId,(row.evidenceManifest as unknown as EvidenceManifest[]).map(file=>file.id));
  if(fresh.snapshot.id!==row.snapshotId||fresh.profile.version!==row.profileVersion||result.sourceQuote!==fresh.candidate.quote||fresh.snapshot.reviewerId===fresh.snapshot.capturedById||!fresh.snapshot.reviewerId||!fresh.snapshot.reviewedAt)return {eligible:false,reason:"The source or business context needs a current independent review"};
  const needed=[{id:row.createdById,roles:WRITER},{id:row.reviewerId,roles:ADMIN},{id:fresh.snapshot.capturedById,roles:WRITER},{id:fresh.snapshot.reviewerId,roles:ADMIN},...fresh.evidence.flatMap(file=>[{id:file.uploadedById,roles:WRITER},{id:file.reviewerId,roles:ADMIN}])];
  const ids=[...new Set(needed.map(person=>person.id).filter((id):id is string=>!!id))].sort();
  // Hold current memberships and pilot identities until the final versioned write commits.
  const people=await tx.$queryRaw<Array<{id:string;role:string;email:string}>>(Prisma.sql`
    SELECT m."userId"::text AS id,m.role::text AS role,u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId"
    WHERE m."organizationId"=${ctx.organizationId}::uuid AND m."userId" IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})
    ORDER BY m."userId" FOR SHARE OF m,u`);
  if(needed.some(person=>!person.id||!people.some(current=>current.id===person.id&&person.roles.includes(current.role)&&allowedEmail(current.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))))return {eligible:false,reason:"Supporting reviewers or uploaders no longer have the required workspace permission"};
  const fingerprint=hashValue(renewalWire({assessment:{id:row.id,createdById:row.createdById,review:reviewMetadata(row),manifest:row.evidenceManifest,method:row.method,engineVersion:row.engineVersion},task:{id:fresh.task.id,title:fresh.task.title,updatedAt:fresh.task.updatedAt,status:fresh.task.status},source:{id:fresh.snapshot.id,hash:fresh.snapshot.contentHash,version:fresh.snapshot.version,lastCheckedAt:fresh.snapshot.lastCheckedAt,reviewStatus:fresh.snapshot.reviewStatus,reviewerId:fresh.snapshot.reviewerId,reviewedAt:fresh.snapshot.reviewedAt,capturedById:fresh.snapshot.capturedById},profile:fresh.profile,evidence:fresh.evidence,participants:people.map(person=>({id:person.id,role:person.role,approved:allowedEmail(person.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)})),actor:{id:ctx.userId,role:actor.role}}));
  return {eligible:true,reason:null,row,fresh,result,fingerprint};
}
export async function assuranceRenewal(ctx:AuthorizedContext,id:string){
  if(!uuid(id))throw new IntelligenceError("Invalid assessment identifier");
  return db.$transaction(async tx=>{
    await requireMember(tx,ctx);
    const row=await tx.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId}});
    if(!row)throw new IntelligenceError("Assessment not found",404);
    const state=await renewalCheck(tx,ctx,row);
    return {id:row.id,organizationId:ctx.organizationId,version:row.version,status:row.status,eligible:state.eligible,reason:state.reason,expired:!!row.validUntil&&row.validUntil.getTime()<=Date.now(),validUntil:row.validUntil?.toISOString()||null,reviewedAt:row.reviewedAt?.toISOString()||null,reviewerId:row.reviewerId,selectedPassages:Array.isArray(row.selectedPassages)?row.selectedPassages.filter(key=>typeof key==="string"&&/^[a-f0-9]{64}$/.test(key)).slice(0,8):[],scope:renewalScope};
  },{isolationLevel:"RepeatableRead",timeout:12000});
}
async function renewalReady(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string,version:number){
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!row)throw new IntelligenceError("Assessment not found",404);
  if(row.version!==version||row.status!=="ACCEPTED")throw new IntelligenceError("This evidence review changed. Refresh its saved record before renewing.",409);
  if(row.createdById===ctx.userId||Array.isArray(row.evidenceManifest)&&(row.evidenceManifest as unknown as EvidenceManifest[]).some(file=>file?.uploadedById===ctx.userId))throw new IntelligenceError("An independent administrator who did not prepare the assessment or upload its files must renew it",403);
  const checked=await renewalCheck(tx,ctx,row);
  if(!checked.eligible)throw new IntelligenceError(checked.reason,409);
  return checked;
}
/** Renewal is a new human decision about the same assessed inputs, never regeneration or an automatic extension. */
export async function renewAssurance(ctx:AuthorizedContext,id:string,raw:unknown,dependencies:Pick<Dependencies,"storage">={}){
  if(!uuid(id))throw new IntelligenceError("Invalid assessment identifier");
  const input=parseAssuranceRenewal(raw),before=await transaction(ctx,tx=>renewalReady(tx,ctx,id,input.version));
  try{
    const extracted=await documents(ctx,before.row.evidenceManifest as unknown as EvidenceManifest[],dependencies.storage);
    if(extracted.some(file=>extractionBlocked(file.document)))throw new IntelligenceError("Original document extraction is incomplete. No renewed review was saved.",409);
    try{assertPassages(before.result,extracted,input.passageKeys);}catch{throw new IntelligenceError("Selected passages did not pass original document verification",409);}
  }catch(error){
    if(error instanceof IntelligenceError)throw error;
    if(error instanceof EvidenceError)throw new IntelligenceError(error.message,error.status);
    throw new IntelligenceError("Original documents could not be verified. No renewed review was saved.",422);
  }
  return transaction(ctx,async tx=>{
    const current=await renewalReady(tx,ctx,id,input.version);
    if(current.fingerprint!==before.fingerprint)throw new IntelligenceError("Supporting context or permissions changed during renewal. Refresh and review it again.",409);
    // Time may have moved while files were read; the requested period must still be valid.
    parseAssuranceRenewal({...input,validUntil:input.validUntil.toISOString().slice(0,10)});
    const reviewedAt=new Date(),updated={...current.row,reviewerId:ctx.userId,reviewNotes:input.notes,selectedPassages:input.passageKeys,reviewedAt,validUntil:input.validUntil,version:input.version+1};
    const changed=await tx.assuranceAssessment.updateMany({where:{id,organizationId:ctx.organizationId,status:"ACCEPTED",version:input.version},data:{reviewerId:ctx.userId,reviewNotes:input.notes,selectedPassages:input.passageKeys,reviewedAt,validUntil:input.validUntil,version:{increment:1}}});
    if(changed.count!==1)throw new IntelligenceError("Another reviewer saved first. Refresh the saved review before trying again.",409);
    const event=await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"assurance.review_renewed",entityType:"AssuranceAssessment",entityId:id,details:json({format:"regpilot-assessment-renewal",version:1,assessmentId:id,taskId:current.row.obligationId,createdById:current.row.createdById,renewedById:ctx.userId,method:current.row.method,engineVersion:current.row.engineVersion,source:{id:current.fresh.snapshot.id,sourceId:current.fresh.snapshot.sourceId,contentHash:current.fresh.snapshot.contentHash,version:current.fresh.snapshot.version,reviewerId:current.fresh.snapshot.reviewerId,reviewedAt:current.fresh.snapshot.reviewedAt?.toISOString(),capturedById:current.fresh.snapshot.capturedById,lastCheckedAt:current.fresh.snapshot.lastCheckedAt.toISOString()},profileVersion:current.fresh.profile.version,evidenceManifest:current.fresh.manifest,previousReview:reviewMetadata(current.row),renewedReview:reviewMetadata(updated),confirmations:{scopeConfirmed:true,originalsChecked:true},scope:renewalScope})},select:{id:true}});
    return {id,status:"ACCEPTED" as const,version:updated.version,reviewedAt:reviewedAt.toISOString(),validUntil:input.validUntil.toISOString(),eventId:event.id};
  });
}
