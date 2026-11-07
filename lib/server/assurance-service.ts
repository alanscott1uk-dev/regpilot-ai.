import {Prisma,type AssuranceAssessment} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {aiConfigured} from "./ai-auth";
import {allowedEmail} from "../ai/security.mjs";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {downloadEvidence} from "./evidence-service";
import {extractPdf} from "./pdf-extraction";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";
import {hashValue,type Analysis} from "../regulatory/intelligence";
import {ASSURANCE_ENGINE,contentAssessment,groundedAssessment,assertPassages,type AssuranceResult,type EvidenceDocument,type EvidenceManifest} from "../evidence/assurance";
import {generateAssurance,type AssuranceModelInput} from "./assurance-model";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {EvidenceError} from "../evidence/file-guard.mjs";

export function assuranceConfigured(){return evidenceConfigured()&&process.env.REGPILOT_ASSURANCE_ENABLED==="true";}
export function assuranceAiConfigured(){return assuranceConfigured()&&aiConfigured()&&process.env.REGPILOT_ASSURANCE_AI_ENABLED==="true"&&process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED==="true";}
const json=(v:unknown)=>v as Prisma.InputJsonValue;
const uuid=(s:string)=>/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(s);
type Dependencies={storage?:EvidenceObjectStore;generate?:(input:AssuranceModelInput)=>Promise<unknown>};
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
    result.push({id:row.id,filename:stored.filename,document:await extractPdf(stored.bytes)});
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
export async function currentAssessment(tx:Prisma.TransactionClient,organizationId:string,row:AssuranceAssessment){
  if(!row.result||hashValue(row.result)!==row.resultHash)return {valid:false,reason:"Assessment content failed integrity verification"};
  if(row.status==="ACCEPTED"&&(!row.reviewerId||row.reviewerId===row.createdById||!row.reviewedAt||!(row.selectedPassages as string[]).length||(row.evidenceManifest as unknown as EvidenceManifest[]).some(e=>e.uploadedById===row.reviewerId)))return {valid:false,reason:"Independent assessment approval could not be established"};
  if(row.status==="ACCEPTED"&&(!row.validUntil||row.validUntil.getTime()<=Date.now()))return {valid:false,reason:"The evidence review period has expired"};
  if(row.status==="ACCEPTED"){
    const newer=await tx.assuranceAssessment.findMany({where:{organizationId,obligationId:row.obligationId,createdAt:{gt:row.createdAt},status:{in:["DRAFT","NEEDS_WORK","ACCEPTED","REDACTED"]}},take:20,orderBy:{createdAt:"desc"},select:{status:true,result:true}});
    if(newer.some(a=>a.status!=="DRAFT"||(a.result as unknown as AssuranceResult|null)?.checks.some(c=>["CONTRADICTED","NOT_FOUND"].includes(c.verdict))))return {valid:false,reason:"A newer assessment supersedes this decision or identifies unresolved gaps"};
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
export async function completionAssessment(tx:Prisma.TransactionClient,organizationId:string,taskId:string){
  const assessment=await tx.assuranceAssessment.findFirst({where:{organizationId,obligationId:taskId,status:"ACCEPTED"},orderBy:{createdAt:"desc"}});
  if(!assessment||(await currentAssessment(tx,organizationId,assessment)).valid!==true)throw new Error("Completion requires a current independently accepted evidence assessment for this source-linked task");
  return assessment;
}
export async function assuranceWorkspace(ctx:AuthorizedContext,taskId?:string){
  if(taskId&&!uuid(taskId))throw new IntelligenceError("Invalid task identifier");
  const [tasks,evidence]=await Promise.all([
    db.obligation.findMany({where:{organizationId:ctx.organizationId,originKey:{not:null}},orderBy:[{dueDate:"asc"},{id:"asc"}],take:100,select:{id:true,title:true,status:true,ownerName:true,dueDate:true}}),
    db.evidence.findMany({where:{organizationId:ctx.organizationId},orderBy:{createdAt:"desc"},take:120,select:{id:true,obligationId:true,filename:true,sha256:true,reviewVersion:true,reviewStatus:true,scanStatus:true,uploadedById:true,reviewerId:true}})
  ]);
  const selected=taskId||tasks[0]?.id;let source:null|{quote:string;title:string;url:string;hash:string}=null,contextIssue:string|null=null;
  const assessments=selected?await db.assuranceAssessment.findMany({where:{organizationId:ctx.organizationId,obligationId:selected},orderBy:{createdAt:"desc"},take:10}):[];
  if(selected){try{const c=await context(db,ctx.organizationId,selected,[]);source={quote:c.candidate.quote,title:c.snapshot.title,url:c.snapshot.url,hash:c.snapshot.contentHash};}catch(error){if(error instanceof IntelligenceError&&error.status===404)throw error;contextIssue=error instanceof IntelligenceError?error.message:"Source context unavailable";}}
  const reviews=await Promise.all(assessments.map(async row=>{
    const state=["PROCESSING","FAILED","REDACTED"].includes(row.status)?{valid:false,reason:row.status==="PROCESSING"?"Processing has not completed; refresh to check its status.":row.status==="REDACTED"?"Retained assessment content was removed.":"Processing did not complete. Check the files and prepare updated evidence."}:await currentAssessment(db,ctx.organizationId,row),integrityValid=!!row.result&&hashValue(row.result)===row.resultHash;
    return {id:row.id,obligationId:row.obligationId,createdById:row.createdById,createdAt:row.createdAt,method:row.method,status:row.status==="PROCESSING"&&Date.now()-row.createdAt.getTime()>180000?"INTERRUPTED":row.status,version:row.version,result:integrityValid?row.result:null,integrityValid,reviewNotes:row.reviewNotes,reviewerId:row.reviewerId,validUntil:row.validUntil,evidenceManifest:row.evidenceManifest,current:state.valid,reason:state.reason};
  }));
  const accepted=reviews.find(r=>r.status==="ACCEPTED"&&r.current),latest=reviews[0];
  const nextStep=contextIssue||(!selected?"Accept a source recommendation in the regulatory inbox first.":accepted?"Evidence assessment is current. Check the task outcome before marking it complete.":latest?.status==="DRAFT"&&latest.current?"An independent administrator can now check the quoted passages and record a scoped decision.":latest?.reason?latest.reason:"Choose supporting files and prepare a content-level assessment.");
  return {tasks,evidence,selectedTaskId:selected||null,source,contextIssue,assessments:reviews,nextStep,aiEnabled:assuranceAiConfigured(),taskLimitReached:tasks.length===100};
}
export async function exportAssurance(ctx:AuthorizedContext,id:string){
  if(!uuid(id))throw new IntelligenceError("Invalid assessment identifier");
  return transaction(ctx,async tx=>{
    const row=await tx.assuranceAssessment.findFirst({where:{id,organizationId:ctx.organizationId},include:{obligation:{select:{id:true,title:true,status:true}},snapshot:{select:{id:true,sourceId:true,title:true,url:true,contentHash:true,lastCheckedAt:true,reviewStatus:true}}}});
    if(!row)throw new IntelligenceError("Assessment not found",404);
    if(row.status==="REDACTED")throw new IntelligenceError("Quoted content was removed",410);
    if(!row.result||hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Assessment is unavailable or failed integrity verification",409);
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
    if(!row.result||hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Assessment integrity check failed",409);
    const result=row.result as unknown as AssuranceResult;
    if(result.rejectedClaims||result.documents.some(d=>d.truncated||d.skippedPages.length)||result.checks.some(c=>["CONTRADICTED","NOT_FOUND"].includes(c.verdict)))throw new IntelligenceError("Resolve contradictions, missing proof or incomplete extraction before accepting this assessment",409);
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
