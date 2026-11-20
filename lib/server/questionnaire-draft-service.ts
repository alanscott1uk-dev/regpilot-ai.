import {Prisma,type QuestionnaireDraftRun} from "@prisma/client";
import {z} from "zod";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,WRITER,ADMIN} from "./workspace-member";
import {questionsSchema} from "../assurance-operations";
import {hashValue} from "../regulatory/intelligence";
import {reviewedFiles,reviewedFileSchema,reviewedFilesSchema,type ReviewedFile} from "./reviewed-files";
import {assertAssuranceParticipants,createAssuranceAnswerRecord} from "./customer-assurance-service";
import {completionParticipants} from "./work-completion-service";
import {downloadEvidence} from "./evidence-service";
import {extractDocument} from "./document-extraction";
import type {EvidenceObjectStore} from "./evidence-storage";
import type {EvidenceDocument} from "../evidence/assurance";
import {assuranceConfigured,assuranceAiConfigured} from "./assurance-service";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {generateQuestionnaireDraft,type QuestionnaireDraftModelInput} from "./questionnaire-draft-model";
import {QUESTIONNAIRE_DRAFT_ENGINE,QUESTIONNAIRE_DRAFT_LIMITS,prepareQuestionnaireDraftInput,saveQuestionnaireDraftInput,questionnaireDraftResultSchema,searchedQuestionnaireDraft,groundedQuestionnaireDraft,assertDraftDocuments,verifyDraftCitations} from "../questionnaire-drafts";

type Tx=Prisma.TransactionClient;
type Dependencies={storage?:EvidenceObjectStore;generate?:(input:QuestionnaireDraftModelInput)=>Promise<unknown>};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function questionnaireAiReady(){return assuranceAiConfigured()&&process.env.REGPILOT_QUESTIONNAIRE_AI_ENABLED==="true";}
const stateSchema=z.object({engine:z.literal(QUESTIONNAIRE_DRAFT_ENGINE),questionnaireId:z.uuid(),title:z.string(),recipient:z.string(),scope:z.string(),createdById:z.uuid(),question:z.object({id:z.uuid(),reference:z.string(),question:z.string(),instructions:z.string(),ownerId:z.uuid()}),files:reviewedFilesSchema,participants:z.array(z.object({id:z.uuid(),role:z.string(),approved:z.boolean()})),model:z.string().nullable()});
async function questionnaire(tx:Tx,c:AuthorizedContext,id:string){
 const actor=await requireMember(tx,c,WRITER),row=await tx.assuranceQuestionnaire.findFirst({where:{id,organizationId:c.organizationId}});
 if(!row)throw new IntelligenceError("Questionnaire not found",404);
 const questions=questionsSchema.parse(row.questions),admin=ADMIN.includes(actor.role);
 if(!admin&&!questions.some(q=>q.ownerId===c.userId))throw new IntelligenceError("Questionnaire not found",404);
 return {row,questions,admin};
}
async function capture(tx:Tx,c:AuthorizedContext,id:string,questionId:string,evidenceIds:string[],creator:string,method:string){
 const q=await questionnaire(tx,c,id),question=q.questions.find(v=>v.id===questionId);
 if(!question||!q.admin&&question.ownerId!==c.userId)throw new IntelligenceError("Question not found",404);
 const files=await reviewedFiles(tx,c.organizationId,evidenceIds),participants=await assertAssuranceParticipants(tx,c.organizationId,files,[creator,question.ownerId]);
 return captured(q,question,files,participants,creator,method);
}
function captured(q:Awaited<ReturnType<typeof questionnaire>>,question:z.infer<typeof questionsSchema>[number],files:ReviewedFile[],participants:Awaited<ReturnType<typeof completionParticipants>>,creator:string,method:string){
 const context=stateSchema.parse({engine:QUESTIONNAIRE_DRAFT_ENGINE,questionnaireId:q.row.id,title:q.row.title,recipient:q.row.recipient,scope:q.row.scope,createdById:creator,question:{id:question.id,reference:question.reference,question:question.question,instructions:question.instructions||"",ownerId:question.ownerId},files,participants,model:method==="AI"?process.env.REGPILOT_AI_MODEL||"":null});
 return {...q,question,context,files,inputHash:hashValue(context)};
}
function stored(run:QuestionnaireDraftRun){
 const context=stateSchema.safeParse(run.context),files=reviewedFilesSchema.safeParse(run.evidenceManifest);
 if(!context.success||!files.success||run.engineVersion!==QUESTIONNAIRE_DRAFT_ENGINE||hashValue(context.data)!==run.inputHash||hashValue(files.data)!==hashValue(context.data.files)||context.data.createdById!==run.createdById||context.data.questionnaireId!==run.questionnaireId||context.data.question.id!==run.questionId)throw new IntelligenceError("Draft context integrity failed",409);
 return {context:context.data,files:files.data};
}
function resultOf(run:QuestionnaireDraftRun){
 const result=questionnaireDraftResultSchema.safeParse(run.result);
 if(!result.success||hashValue(result.data)!==run.resultHash)throw new IntelligenceError("Draft result integrity failed",409);
 return result.data;
}
/** A historical origin reference only; callers must separately verify the linked answer is current. */
export function savedQuestionnaireAnswerOrigin(run:QuestionnaireDraftRun){
 if(run.status!=="SAVED"||!run.answerId||!run.saveHash||!/^[a-f0-9]{64}$/.test(run.saveHash))throw new IntelligenceError("Saved answer origin unavailable",409);
 const {context,files}=stored(run),result=resultOf(run);
 if(!result.citations.length||result.citations.some(citation=>!files.some(file=>file.id===citation.evidenceId&&file.filename===citation.filename)))throw new IntelligenceError("Saved answer origin evidence failed its integrity check",409);
 return {id:run.id,organizationId:run.organizationId,questionnaireId:run.questionnaireId,questionId:run.questionId,answerId:run.answerId,version:run.version,savedAt:run.updatedAt.toISOString(),inputHash:run.inputHash,resultHash:run.resultHash!,saveHash:run.saveHash,question:context.question.question,instructions:context.question.instructions,scope:context.scope,files};
}
async function current(tx:Tx,c:AuthorizedContext,run:QuestionnaireDraftRun){
 const original=stored(run),now=await capture(tx,c,run.questionnaireId,run.questionId,original.files.map(f=>f.id),run.createdById,run.method);
 if(now.inputHash!==run.inputHash)throw new IntelligenceError("The question, business scope, selected evidence or participant permissions changed. Prepare a new draft.",409);
 return now;
}
async function documents(c:AuthorizedContext,files:ReviewedFile[],storage?:EvidenceObjectStore){
 const output:EvidenceDocument[]=[];
 for(const f of files){const actual=await downloadEvidence(c,f.id,storage);if(actual.sha256!==f.sha256||actual.filename!==f.filename)throw new IntelligenceError("Selected evidence changed during retrieval",409);output.push({id:f.id,filename:f.filename,document:await extractDocument(actual.bytes,actual.filename)});}
 try{assertDraftDocuments(output);}catch(e){throw new IntelligenceError((e as Error).message,409);}
 return output;
}
async function event(tx:Tx,c:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonValue={}){await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:"QuestionnaireDraftRun",entityId:id,action:"questionnaire_draft."+action,details}});}

export async function prepareQuestionnaireDraft(c:AuthorizedContext,id:string,input:unknown,dependencies:Dependencies={}){
 const d=prepareQuestionnaireDraftInput.parse(input),requestHash=hashValue({id,...d,evidenceIds:[...d.evidenceIds].sort()}),prepared=await transaction(c,async tx=>{
  const q=await questionnaire(tx,c,id),existing=await tx.questionnaireDraftRun.findUnique({where:{organizationId_requestKey:{organizationId:c.organizationId,requestKey:d.requestKey}}});
  if(existing){if(existing.createdById!==c.userId||existing.questionnaireId!==id||existing.requestHash!==requestHash)throw new IntelligenceError("This request key already belongs to a different preparation",409);if(!q.questions.some(v=>v.id===existing.questionId&&v.ownerId===c.userId))throw new IntelligenceError("The assigned question owner changed",403);return {existing};}
  if(!assuranceConfigured()||d.method==="AI"&&!questionnaireAiReady())throw new IntelligenceError(d.method==="AI"?"AI questionnaire drafting awaits activation":"Private evidence processing awaits activation",503);
  if(q.row.status!=="DRAFT"||q.row.version!==d.questionnaireVersion)throw new IntelligenceError("Questionnaire changed; refresh before preparation",409);
  const selected=q.questions.find(v=>v.id===d.questionId);if(!selected||selected.ownerId!==c.userId)throw new IntelligenceError("The assigned question owner must prepare the response",403);
  const state=await capture(tx,c,id,d.questionId,d.evidenceIds,c.userId,d.method),same=await tx.questionnaireDraftRun.findUnique({where:{organizationId_inputHash_method:{organizationId:c.organizationId,inputHash:state.inputHash,method:d.method}}});
  if(same)throw new IntelligenceError("These exact inputs already have a preparation record. Open its saved outcome; automatic repeat generation is blocked.",409);
  if(await tx.questionnaireDraftRun.count({where:{organizationId:c.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=QUESTIONNAIRE_DRAFT_LIMITS.daily)throw new IntelligenceError("The daily limit of 20 questionnaire preparations has been reached",429);
  const run=await tx.questionnaireDraftRun.create({data:{organizationId:c.organizationId,questionnaireId:id,questionId:d.questionId,createdById:c.userId,requestKey:d.requestKey,requestHash,inputHash:state.inputHash,engineVersion:QUESTIONNAIRE_DRAFT_ENGINE,method:d.method,evidenceManifest:json(state.files),context:json(state.context)}});
  await event(tx,c,run.id,"processing_consented",{method:d.method,inputHash:state.inputHash,evidenceCount:state.files.length});return {run,state};
 });
 if(prepared.existing)return {id:prepared.existing.id,reused:true,status:prepared.existing.status};
 const {run,state}=prepared;
 try{
  const extracted=await documents(c,state.files,dependencies.storage);
  await transaction(c,async tx=>{const now=await current(tx,c,run);if(now.row.status!=="DRAFT")throw new IntelligenceError("Questionnaire is no longer a draft",409);if(!assuranceConfigured()||d.method==="AI"&&!questionnaireAiReady())throw new IntelligenceError("Document processing was deactivated",503);});
  let result;
  if(d.method==="AI"){
   await reserveAiRequest(c,"QUESTIONNAIRE_DRAFT",{purpose:"Draft a customer assurance response from selected evidence",dataCategory:"Private reviewed business evidence",recordPurpose:"Independent review before customer disclosure",humanReviewRequired:true});
   result=groundedQuestionnaireDraft(await (dependencies.generate||generateQuestionnaireDraft)({question:state.question.question,instructions:state.question.instructions||"",scope:state.row.scope,documents:extracted}),extracted);
  }else result=searchedQuestionnaireDraft(state.question.question+" "+(state.question.instructions||""),extracted);
  await transaction(c,async tx=>{const now=await current(tx,c,run);if(now.row.status!=="DRAFT")throw new IntelligenceError("Questionnaire is no longer a draft",409);if(!assuranceConfigured()||d.method==="AI"&&!questionnaireAiReady())throw new IntelligenceError("Document processing was deactivated",503);const changed=await tx.questionnaireDraftRun.updateMany({where:{id:run.id,organizationId:c.organizationId,status:"PROCESSING",version:1},data:{status:"DRAFT",result:json(result),resultHash:hashValue(result),version:{increment:1}}});if(changed.count!==1)throw new IntelligenceError("This preparation is no longer pending",409);await event(tx,c,run.id,"prepared",{method:d.method,resultHash:hashValue(result),citations:result.citations.length});});
  return {id:run.id,reused:false,status:"DRAFT"};
 }catch(error){
  await transaction(c,async tx=>{await tx.questionnaireDraftRun.updateMany({where:{id:run.id,organizationId:c.organizationId,status:"PROCESSING"},data:{status:"FAILED",failureCode:error instanceof DailyLimitError?"DAILY_LIMIT":error instanceof IntelligenceError?"CONTEXT_OR_EVIDENCE_CHANGED":"PREPARATION_FAILED",version:{increment:1}}});await event(tx,c,run.id,"failed");});
  if(error instanceof DailyLimitError)throw new IntelligenceError(error.message,429);
  if(error instanceof IntelligenceError)throw error;
  throw new IntelligenceError("Preparation failed. The attempt is recorded and will not repeat automatically. Inspect its status before preparing with changed inputs.",502);
 }
}

export async function questionnaireDrafts(c:AuthorizedContext,id:string,filter:{runId?:string;requestKey?:string}={}){
 if(filter.runId)z.uuid().parse(filter.runId);if(filter.requestKey)z.uuid().parse(filter.requestKey);
 return transaction(c,async tx=>{
  const q=await questionnaire(tx,c,id),owned=q.questions.filter(v=>v.ownerId===c.userId).map(v=>v.id),questionIds=q.admin?q.questions.map(v=>v.id):owned;
  const where={organizationId:c.organizationId,questionnaireId:id,questionId:{in:questionIds},...(filter.runId?{id:filter.runId}:{}),...(filter.requestKey?{requestKey:filter.requestKey}:{})};
  await tx.questionnaireDraftRun.updateMany({where:{...where,status:"PROCESSING",createdAt:{lt:new Date(Date.now()-QUESTIONNAIRE_DRAFT_LIMITS.processingTimeoutMs)}},data:{status:"FAILED",failureCode:"INTERRUPTED",version:{increment:1}}});
  const runs=await tx.questionnaireDraftRun.findMany({where,orderBy:[{createdAt:"desc"},{id:"asc"}],take:QUESTIONNAIRE_DRAFT_LIMITS.history}),drafts=[];
  // A history page is one company snapshot. Avoid re-reading the same question,
  // files and locked memberships for every run inside the 12-second transaction.
  const originals=new Map<string,ReturnType<typeof stored>>(),invalidContexts=new Map<string,unknown>();
  for(const run of runs){try{originals.set(run.id,stored(run));}catch(error){invalidContexts.set(run.id,error);}}
  const fileIds=[...new Set([...originals.values()].flatMap(value=>value.files.map(file=>file.id)))];
  const fileRows=fileIds.length?await tx.evidence.findMany({where:{organizationId:c.organizationId,id:{in:fileIds}},select:{id:true,filename:true,sha256:true,reviewVersion:true,contentType:true,sizeBytes:true,uploadedById:true,reviewerId:true,scanStatus:true,reviewStatus:true,reviewedAt:true},orderBy:{id:"asc"}}):[];
  const usableFiles=new Map<string,ReviewedFile>();
  for(const file of fileRows){
   if(file.scanStatus!=="CLEAN"||file.reviewStatus!=="APPROVED"||!file.reviewedAt||!file.uploadedById||!file.reviewerId||file.uploadedById===file.reviewerId)continue;
   const parsed=reviewedFileSchema.safeParse(file);if(parsed.success)usableFiles.set(file.id,parsed.data);
  }
  const people=runs.length?await completionParticipants(tx,c,[...runs.map(run=>run.createdById),...q.questions.map(question=>question.ownerId),...[...usableFiles.values()].flatMap(file=>[file.uploadedById,file.reviewerId])]):[];
  for(const run of runs){
   let isCurrent=false,reason="",result=null;
   try{
    if(invalidContexts.has(run.id))throw invalidContexts.get(run.id);
    const original=originals.get(run.id)!;if(["DRAFT","SAVED"].includes(run.status))result=resultOf(run);
    const question=q.questions.find(question=>question.id===run.questionId);
    if(!question||!q.admin&&question.ownerId!==c.userId)throw new IntelligenceError("Question not found",404);
    const selectedIds=new Set(original.files.map(file=>file.id)),files=[...usableFiles.values()].filter(file=>selectedIds.has(file.id));
    if(files.length!==original.files.length)throw new IntelligenceError("Select current, independently approved evidence from this organisation",409);
    const participantIds=new Set([run.createdById,question.ownerId,...files.flatMap(file=>[file.uploadedById,file.reviewerId])]),participants=people.filter(person=>participantIds.has(person.id));
    const allowed=(id:string,roles:string[])=>participants.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
    if(!allowed(run.createdById,WRITER)||!allowed(question.ownerId,WRITER)||files.some(file=>!allowed(file.uploadedById,WRITER)||!allowed(file.reviewerId,ADMIN)))throw new IntelligenceError("An answer, evidence author or independent reviewer no longer has current company permission",409);
    if(captured(q,question,files,participants,run.createdById,run.method).inputHash!==run.inputHash)throw new IntelligenceError("The question, business scope, selected evidence or participant permissions changed. Prepare a new draft.",409);
    isCurrent=true;
   }catch(e){if(!(e instanceof IntelligenceError)&&!(e instanceof z.ZodError))throw e;reason=e instanceof IntelligenceError?e.message:"Stored draft could not be verified";}
   drafts.push({id:run.id,questionId:run.questionId,createdById:run.createdById,method:run.method,status:run.status,version:run.version,current:isCurrent,reason,failureCode:run.failureCode,answerId:run.answerId,result,canSave:isCurrent&&run.status==="DRAFT"&&run.createdById===c.userId&&owned.includes(run.questionId)&&q.row.status==="DRAFT"});
  }
  const evidence=await tx.evidence.findMany({where:{organizationId:c.organizationId,scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true},orderBy:{createdAt:"desc"},take:100});
  return {drafts,evidence,evidenceReady:assuranceConfigured(),aiReady:questionnaireAiReady(),canPrepareQuestionIds:q.row.status==="DRAFT"?owned:[],limits:QUESTIONNAIRE_DRAFT_LIMITS};
 });
}

export async function saveQuestionnaireDraft(c:AuthorizedContext,id:string,runId:string,input:unknown,dependencies:Dependencies={}){
 const d=saveQuestionnaireDraftInput.parse(input),saveHash=hashValue({action:d.action,answer:d.answer,validUntil:d.validUntil,reviewedSupport:d.reviewedSupport,confirm:d.confirm});
 async function check(tx:Tx){
  await questionnaire(tx,c,id);const run=await tx.questionnaireDraftRun.findFirst({where:{id:runId,organizationId:c.organizationId,questionnaireId:id}});
  if(!run||run.createdById!==c.userId)throw new IntelligenceError("Draft not found",404);
  const now=await current(tx,c,run);
  if(now.question.ownerId!==c.userId)throw new IntelligenceError("The assigned question owner changed",403);
  if(run.status==="SAVED"){if(run.saveHash!==saveHash||!run.answerId)throw new IntelligenceError("This preparation already saved a different response",409);return {run,now,reused:true as const};}
  if(!assuranceConfigured())throw new IntelligenceError("Private evidence processing awaits activation",503);
  if(run.status!=="DRAFT"||run.version!==d.version||now.row.status!=="DRAFT")throw new IntelligenceError("Draft or questionnaire changed; refresh before saving",409);
  return {run,now,reused:false as const,result:resultOf(run)};
 }
 const before=await transaction(c,check);
 if(before.reused)return {id:runId,answerId:before.run.answerId,reused:true};
 const extracted=await documents(c,before.now.files,dependencies.storage);
 try{verifyDraftCitations(before.result!,extracted);}catch(e){throw new IntelligenceError((e as Error).message,409);}
 return transaction(c,async tx=>{
  const after=await check(tx);if(after.reused)return {id:runId,answerId:after.run.answerId,reused:true};
  if(after.run.inputHash!==before.run.inputHash||after.run.resultHash!==before.run.resultHash)throw new IntelligenceError("Draft changed during evidence verification",409);
  const answer=await createAssuranceAnswerRecord(tx,c,{question:after.now.question.question,scope:after.now.row.scope,answer:d.answer,evidenceIds:after.now.files.map(f=>f.id),validUntil:d.validUntil,confirm:true});
  await tx.questionnaireDraftRun.update({where:{id:runId},data:{status:"SAVED",answerId:answer.id,saveHash,version:{increment:1}}});await event(tx,c,runId,"answer_saved",{answerId:answer.id,saveHash,resultHash:after.run.resultHash});
  return {id:runId,answerId:answer.id,reused:false};
 });
}
