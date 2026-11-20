import {Prisma,type AssuranceAnswer,type AssuranceQuestionnaire} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {hashValue} from "../regulatory/intelligence";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {activeOwner} from "./library-service";
import {reviewedFileSchema,reviewedFilesSchema,reviewedFiles,assertReviewedFiles,verifyReviewedBytes,futureDate,type ReviewedFile} from "./reviewed-files";
import {answerInput,answerAction,questionnaireInput,questionnaireAction,questionImportRowSchema,questionsSchema,parseCsv,answerMatches,normalQuestion,safeCsv} from "../assurance-operations";
import {completionParticipants} from "./work-completion-service";
import {knowledgeHealth,recurringQuestionnaireGaps} from "../questionnaire-automation";
import {answerProductContextSchema,productQuestionnaireContextSchema,answerMatchesProduct} from "../product-scope";
import {loadProductScopeState,captureAnswerProductContextFromState,assertAnswerProductContextFromState,captureQuestionnaireProducts,captureQuestionProductContextFromState} from "./product-service";
import {questionnaireDraftResultSchema} from "../questionnaire-drafts";
import type {AuthorizedContext} from "./authorization";
import type {EvidenceObjectStore} from "./evidence-storage";
import {assertQuestionnaireOcrSourcesCurrent,verifyQuestionnaireOcrOriginals} from "./ocr-currentness";
type Tx=Prisma.TransactionClient;const org=(c:AuthorizedContext)=>({organizationId:c.organizationId}),j=(v:unknown)=>v as Prisma.InputJsonValue;
async function event(tx:Tx,c:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonValue={}){await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:"CustomerAssurance",entityId:id,action:"customer_assurance."+action,details}});}
function answerContent(a:{question:string;scope:string;answer:string;files:unknown;validUntil:Date;productContext?:unknown}){return {question:a.question,scope:a.scope,answer:a.answer,files:reviewedFilesSchema.parse(a.files),validUntil:a.validUntil.toISOString(),...(a.productContext?{productContext:answerProductContextSchema.parse(a.productContext)}:{})};}
function integrity(a:AssuranceAnswer){let content;try{content=answerContent(a);}catch(error){if(error instanceof z.ZodError)throw new IntelligenceError("Answer or evidence metadata failed its integrity check",409);throw error;}if((a.productId||content.productContext)&&(!content.productContext||(content.productContext.mode==="PRODUCT"?content.productContext.product.id!==a.productId:!!a.productId)))throw new IntelligenceError("Answer product identity failed its integrity check",409);if(!content.files.length||hashValue(content)!==a.contentHash)throw new IntelligenceError("Answer integrity check failed",409);return content;}
type AssurancePeople=Awaited<ReturnType<typeof completionParticipants>>;
function assertAssurancePeople(people:AssurancePeople,files:ReviewedFile[],authors:string[],reviewers:(string|null)[]){
 const allowed=(id:string|null,roles:string[])=>!!id&&people.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
 if(authors.some(id=>!allowed(id,WRITER))||reviewers.some(id=>!allowed(id,ADMIN))||files.some(file=>file.uploadedById===file.reviewerId||!allowed(file.uploadedById,WRITER)||!allowed(file.reviewerId,ADMIN)))throw new IntelligenceError("An answer, evidence author or independent reviewer no longer has current company permission",409);
}
/** Current authority is checked while membership and pilot identities are locked. */
export async function assertAssuranceParticipants(tx:Tx,organizationId:string,files:ReviewedFile[],authors:string[]=[],reviewers:(string|null)[]=[]){
 const people=await completionParticipants(tx,{organizationId,userId:"",role:"ADMIN"},[...authors,...reviewers,...files.flatMap(file=>[file.uploadedById,file.reviewerId])]);
 assertAssurancePeople(people,files,authors,reviewers);
 return people;
}
type CheckedAnswer={a:AssuranceAnswer;content:ReturnType<typeof answerContent>|null;current:boolean;reason:string;participants:AssurancePeople};
/** One scoped evidence read and one ordered participant lock serve the complete bounded answer set. */
export async function checkedAssuranceAnswers(tx:Tx,organizationId:string,answers:AssuranceAnswer[]):Promise<CheckedAnswer[]>{
 if(answers.length>300)throw new IntelligenceError("Answer projection exceeds the library limit",409);
 if(answers.some(answer=>answer.organizationId!==organizationId))throw new IntelligenceError("Answer not found",404);
 const now=new Date(),checked:CheckedAnswer[]=answers.map(a=>{
  let content:ReturnType<typeof answerContent>|null=null,reason="";
  try{
   content=integrity(a);
   if(a.status!=="APPROVED"||!a.reviewerId||a.reviewerId===a.createdById||content.files.some(file=>file.uploadedById===a.reviewerId))throw new IntelligenceError("Answer is unapproved or withdrawn",409);
   if(a.validUntil<now)throw new IntelligenceError("Answer has expired",409);
  }catch(error){if(!(error instanceof IntelligenceError))throw error;reason=error.message;}
  return {a,content,current:false,reason,participants:[]};
 });
 const eligible=checked.filter(answer=>!answer.reason&&answer.content),fileIds=[...new Set(eligible.flatMap(answer=>answer.content!.files.map(file=>file.id)))].sort();
 const files=fileIds.length?await tx.evidence.findMany({where:{organizationId,id:{in:fileIds}},orderBy:{id:"asc"},select:{id:true,filename:true,sha256:true,reviewVersion:true,contentType:true,sizeBytes:true,uploadedById:true,reviewerId:true,scanStatus:true,reviewStatus:true,reviewedAt:true}}):[];
 const currentFiles=new Map<string,ReviewedFile>();
 for(const file of files){
  if(file.scanStatus!=="CLEAN"||file.reviewStatus!=="APPROVED"||!file.reviewedAt||!file.uploadedById||!file.reviewerId||file.uploadedById===file.reviewerId)continue;
  const parsed=reviewedFileSchema.safeParse(file);if(parsed.success)currentFiles.set(file.id,parsed.data);
 }
 const productState=await loadProductScopeState(tx,organizationId,fileIds);
 const people=await completionParticipants(tx,{organizationId,userId:"",role:"ADMIN"},eligible.flatMap(answer=>[answer.a.createdById,answer.a.reviewerId,...answer.content!.files.flatMap(file=>[file.uploadedById,file.reviewerId])]));
 for(const answer of eligible){
  const content=answer.content!,ids=new Set([answer.a.createdById,answer.a.reviewerId,...content.files.flatMap(file=>[file.uploadedById,file.reviewerId])]);
  answer.participants=people.filter(person=>ids.has(person.id));
  try{
   const current=content.files.map(file=>currentFiles.get(file.id)).filter((file):file is ReviewedFile=>!!file).sort((a,b)=>a.id.localeCompare(b.id));
   if(current.length!==content.files.length||new Set(content.files.map(file=>file.id)).size!==content.files.length)throw new IntelligenceError("Select current, independently approved evidence from this organisation",409);
   if(hashValue(current)!==hashValue(content.files))throw new IntelligenceError("Evidence changed. Prepare a new version or review",409);
   assertAnswerProductContextFromState(productState,answer.a,content.files.map(file=>file.id));
   assertAssurancePeople(answer.participants,content.files,[answer.a.createdById],[answer.a.reviewerId]);answer.current=true;
  }catch(error){if(!(error instanceof IntelligenceError))throw error;answer.reason=error.message;}
 }
 return checked;
}
export async function currentAnswer(tx:Tx,organizationId:string,id:string){const a=await tx.assuranceAnswer.findFirst({where:{id,organizationId}});if(!a)throw new IntelligenceError("Answer not found",404);const checked=(await checkedAssuranceAnswers(tx,organizationId,[a]))[0];if(!checked.current||!checked.content)throw new IntelligenceError(checked.reason||"Current approved answer unavailable",409);return {a,content:checked.content,participants:checked.participants};}
const answerOperationSchema=z.object({format:z.literal("regpilot-answer-operation-v1"),organizationId:z.uuid(),actorId:z.uuid(),requestKey:z.uuid(),answerId:z.uuid(),requestHash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime()});
const answerOperationKey=(c:AuthorizedContext,requestKey:string)=>hashValue({kind:"assurance-answer-create",organizationId:c.organizationId,actorId:c.userId,requestKey});
async function answerOperationRecord(tx:Tx,c:AuthorizedContext,requestKey:string){
 z.uuid().parse(requestKey);
 const events=await tx.auditEvent.findMany({where:{...org(c),entityType:"AssuranceAnswerOperation",entityId:answerOperationKey(c,requestKey)},take:2});
 if(events.length>1)throw new IntelligenceError("Answer creation history needs administrator review",409);
 if(!events[0])return null;
 const event=events[0],payload=event.details as {record?:unknown;recordHash?:unknown}|null,parsed=answerOperationSchema.safeParse(payload?.record);
 if(!parsed.success||hashValue(parsed.data)!==payload?.recordHash)throw new IntelligenceError("Answer creation integrity failed",409);
 const record=parsed.data;
 if(record.organizationId!==c.organizationId||record.actorId!==c.userId||record.requestKey!==requestKey||record.actorId!==event.actorId||record.createdAt!==event.createdAt.toISOString()||event.action!=="customer_assurance.answer_created")throw new IntelligenceError("Answer creation identity failed",409);
 if(!await tx.assuranceAnswer.findFirst({where:{id:record.answerId,...org(c)},select:{id:true}}))throw new IntelligenceError("The saved answer for this creation is unavailable",409);
 return record;
}
export async function answerWorkspace(c:AuthorizedContext,requestKey?:string){return transaction(c,async tx=>{
 const actor=await requireMember(tx,c,WRITER);
 const [answers,evidence,products]=await Promise.all([tx.assuranceAnswer.findMany({where:org(c),orderBy:[{createdAt:"desc"},{id:"asc"}],take:300}),tx.evidence.findMany({where:{...org(c),reviewStatus:"APPROVED",scanStatus:"CLEAN"},select:{id:true,filename:true,productApplicability:{select:{mode:true,products:{select:{productId:true}}}}},orderBy:{createdAt:"desc"},take:100}),tx.companyProduct.findMany({where:{...org(c),status:"ACTIVE"},select:{id:true,code:true,name:true,version:true,status:true},orderBy:{name:"asc"},take:100})]);
 const visible=(await checkedAssuranceAnswers(tx,c.organizationId,answers)).map(({a,current,reason})=>({id:a.id,question:a.question,scope:a.scope,status:a.status,version:a.version,validUntil:a.validUntil,productId:a.productId,productContext:a.productContext,current,reason}));
 const saved=requestKey?await answerOperationRecord(tx,c,requestKey):null;
 return {admin:ADMIN.includes(actor.role),products,evidence:evidence.map(f=>({id:f.id,filename:f.filename,mode:f.productApplicability?.mode||"UNSCOPED",productIds:f.productApplicability?.products.map(p=>p.productId)||[]})),answers:visible,knowledgeHealth:knowledgeHealth(visible.map(a=>({...a,answer:"",contentHash:"",validUntil:a.validUntil.toISOString()}))),operation:saved?{requestKey:saved.requestKey,answerId:saved.answerId}:null};
});}
export async function createAssuranceAnswerRecord(tx:Tx,c:AuthorizedContext,input:unknown){
 const d=answerInput.parse(input);await requireMember(tx,c,WRITER);
 const requestHash=hashValue({question:d.question,scope:d.scope,answer:d.answer,evidenceIds:[...d.evidenceIds].sort(),validUntil:d.validUntil,...(d.productId?{productId:d.productId}:{}),...(d.globalForProducts?{globalForProducts:true}:{})});
 if(d.requestKey){const saved=await answerOperationRecord(tx,c,d.requestKey);if(saved){if(saved.requestHash!==requestHash)throw new IntelligenceError("This request key was already used for different answer details",409);return {id:saved.answerId,reused:true};}}
 const validUntil=futureDate(d.validUntil);
 if(await tx.assuranceAnswer.count({where:org(c)})>=300)throw new IntelligenceError("Answer library limit reached",429);
 const files=await reviewedFiles(tx,c.organizationId,d.evidenceIds);await assertAssuranceParticipants(tx,c.organizationId,files,[c.userId]);
 const productContext=captureAnswerProductContextFromState(await loadProductScopeState(tx,c.organizationId,d.evidenceIds),d,d.evidenceIds);
 const content=answerContent({...d,productContext,files:j(files),validUntil}),a=await tx.assuranceAnswer.create({data:{...org(c),createdById:c.userId,question:d.question,scope:d.scope,answer:d.answer,validUntil,files:j(files),productId:d.productId||null,...(productContext?{productContext:j(productContext)}:{}),contentHash:hashValue(content)}});
 await event(tx,c,a.id,"answer_drafted");
 if(d.requestKey){const createdAt=new Date(),record=answerOperationSchema.parse({format:"regpilot-answer-operation-v1",organizationId:c.organizationId,actorId:c.userId,requestKey:d.requestKey,answerId:a.id,requestHash,createdAt:createdAt.toISOString()});await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:"AssuranceAnswerOperation",entityId:answerOperationKey(c,d.requestKey),action:"customer_assurance.answer_created",createdAt,details:j({record,recordHash:hashValue(record)})}});}
 return {id:a.id,reused:false};
}
export async function createAssuranceAnswer(c:AuthorizedContext,input:unknown){return transaction(c,tx=>createAssuranceAnswerRecord(tx,c,input));}
export async function assuranceAnswerDetail(c:AuthorizedContext,id:string){return transaction(c,async tx=>{
 const actor=await requireMember(tx,c,WRITER),a=await tx.assuranceAnswer.findFirst({where:{id,...org(c)}});if(!a)throw new IntelligenceError("Answer not found",404);
 const content=integrity(a);let current=false,reason="";try{await currentAnswer(tx,c.organizationId,id);current=true;}catch(e){if(!(e instanceof IntelligenceError))throw e;reason=e.message;}
 const draft=await tx.questionnaireDraftRun.findFirst({where:{...org(c),answerId:id},orderBy:{createdAt:"desc"}}),result=questionnaireDraftResultSchema.safeParse(draft?.result);
 const questionnaire=draft?await tx.assuranceQuestionnaire.findFirst({where:{id:draft.questionnaireId,...org(c)},select:{questions:true}}):null;
 const visible=ADMIN.includes(actor.role)||!!questionnaire&&questionsSchema.parse(questionnaire.questions).some(question=>question.id===draft?.questionId&&question.ownerId===c.userId);
 const generatedDraft=visible&&draft&&result.success&&hashValue(draft.result)===draft.resultHash?{id:draft.id,questionnaireId:draft.questionnaireId,questionId:draft.questionId,method:draft.method,engineVersion:draft.engineVersion,result:result.data,answerEdited:a.answer!==result.data.answer}:null;
 const productState=await loadProductScopeState(tx,c.organizationId,content.files.map(f=>f.id));
 return {...a,...content,current,reason,generatedDraft,evidenceApplicability:Object.fromEntries(productState.applicability)};
});}
async function approvableAnswer(tx:Tx,c:AuthorizedContext,id:string,version:number){await requireMember(tx,c,ADMIN);const a=await tx.assuranceAnswer.findFirst({where:{id,...org(c)}});if(!a||a.status!=="DRAFT"||a.version!==version)throw new IntelligenceError("Answer changed; refresh",409);const content=integrity(a);if(a.createdById===c.userId||content.files.some(f=>f.uploadedById===c.userId))throw new IntelligenceError("A different administrator from the author and file uploaders must approve",403);if(a.validUntil<new Date())throw new IntelligenceError("Set a future review date",409);await assertReviewedFiles(tx,c.organizationId,content.files);assertAnswerProductContextFromState(await loadProductScopeState(tx,c.organizationId,content.files.map(f=>f.id)),a,content.files.map(f=>f.id));await assertAssuranceParticipants(tx,c.organizationId,content.files,[a.createdById],[c.userId]);return {a,content};}
export async function changeAssuranceAnswer(c:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){const d=answerAction.parse(input);if(d.action==="APPROVE"){const pre=await transaction(c,tx=>approvableAnswer(tx,c,id,d.version));await verifyReviewedBytes(c,pre.content.files,store);return transaction(c,async tx=>{const {a}=await approvableAnswer(tx,c,id,d.version);if(a.contentHash!==pre.a.contentHash)throw new IntelligenceError("Answer changed during retrieval",409);await tx.assuranceAnswer.update({where:{id},data:{status:"APPROVED",reviewerId:c.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});await event(tx,c,id,"answer_approved",{contentHash:a.contentHash});return {id};});}
 return transaction(c,async tx=>{const actor=await requireMember(tx,c,WRITER),a=await tx.assuranceAnswer.findFirst({where:{id,...org(c)}});if(!a||a.version!==d.version)throw new IntelligenceError("Answer changed; refresh",409);if(!ADMIN.includes(actor.role)&&a.createdById!==c.userId)throw new IntelligenceError("Only the author or an administrator may change this answer",403);integrity(a);if(d.action==="WITHDRAW"){await requireMember(tx,c,ADMIN);await tx.assuranceAnswer.update({where:{id},data:{status:"WITHDRAWN",reviewNotes:d.notes,version:{increment:1}}});}else if(d.action==="REVISE"){const history=z.array(z.unknown()).max(19).parse(a.history),files=await reviewedFiles(tx,c.organizationId,d.evidenceIds),validUntil=futureDate(d.validUntil),productContext=captureAnswerProductContextFromState(await loadProductScopeState(tx,c.organizationId,d.evidenceIds),d,d.evidenceIds),content=answerContent({...d,productContext,files:j(files),validUntil});await assertAssuranceParticipants(tx,c.organizationId,files,[c.userId]);await tx.assuranceAnswer.update({where:{id},data:{question:d.question,scope:d.scope,answer:d.answer,files:j(files),validUntil,productId:d.productId||null,productContext:productContext?j(productContext):Prisma.DbNull,createdById:c.userId,contentHash:hashValue(content),status:"DRAFT",reviewerId:null,reviewedAt:null,reviewNotes:"",history:j([...history,{...answerContent(a),contentHash:a.contentHash,version:a.version,status:a.status,createdById:a.createdById,reviewerId:a.reviewerId,reviewedAt:a.reviewedAt?.toISOString()||null,reviewNotes:a.reviewNotes}]),version:{increment:1}}});}await event(tx,c,id,d.action.toLowerCase()+"_answer");return {id};});}
const operationSchema=z.object({format:z.literal("regpilot-questionnaire-operation-v1"),organizationId:z.uuid(),actorId:z.uuid(),requestKey:z.uuid(),kind:z.enum(["IMPORT","REUSE"]),questionnaireId:z.uuid(),version:z.number().int().positive(),applied:z.number().int().min(0).max(100),requestHash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime()});
export type QuestionnaireOperation=z.infer<typeof operationSchema>;
const operationKey=(c:AuthorizedContext,requestKey:string)=>hashValue({kind:"questionnaire-operation",organizationId:c.organizationId,actorId:c.userId,requestKey});
export async function questionnaireOperationRecord(tx:Tx,c:AuthorizedContext,requestKey:string){
 z.uuid().parse(requestKey);
 const events=await tx.auditEvent.findMany({where:{...org(c),entityType:"QuestionnaireOperation",entityId:operationKey(c,requestKey)},take:2});
 if(events.length>1)throw new IntelligenceError("Questionnaire operation history needs administrator review",409);
 if(!events[0])return null;
 const event=events[0],payload=event.details as {record?:unknown;recordHash?:unknown}|null,parsed=operationSchema.safeParse(payload?.record);
 if(!parsed.success||hashValue(parsed.data)!==payload?.recordHash)throw new IntelligenceError("Questionnaire operation integrity failed",409);
 const record=parsed.data;
 if(record.organizationId!==c.organizationId||record.actorId!==c.userId||event.actorId!==record.actorId||record.requestKey!==requestKey||record.createdAt!==event.createdAt.toISOString()||event.action!=="customer_assurance."+record.kind.toLowerCase()+"_completed")throw new IntelligenceError("Questionnaire operation identity failed",409);
 if(!await tx.assuranceQuestionnaire.findFirst({where:{id:record.questionnaireId,...org(c)},select:{id:true}}))throw new IntelligenceError("The saved questionnaire for this operation is unavailable",409);
 return record;
}
export async function saveQuestionnaireOperation(tx:Tx,c:AuthorizedContext,record:Omit<QuestionnaireOperation,"format"|"organizationId"|"actorId"|"createdAt">){
 const createdAt=new Date(),saved=operationSchema.parse({...record,format:"regpilot-questionnaire-operation-v1",organizationId:c.organizationId,actorId:c.userId,createdAt:createdAt.toISOString()});
 await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:"QuestionnaireOperation",entityId:operationKey(c,record.requestKey),action:"customer_assurance."+record.kind.toLowerCase()+"_completed",createdAt,details:j({record:saved,recordHash:hashValue(saved)})}});
 return saved;
}
export async function questionnaireWorkspace(c:AuthorizedContext,requestKey?:string){return transaction(c,async tx=>{const actor=await requireMember(tx,c,WRITER),admin=ADMIN.includes(actor.role);const all=await tx.assuranceQuestionnaire.findMany({where:org(c),orderBy:[{createdAt:"desc"},{id:"asc"}],take:100});const rows=admin?all:all.filter(q=>questionsSchema.parse(q.questions).some(r=>r.ownerId===c.userId));const [members,answers,products]=await Promise.all([tx.membership.findMany({where:{...org(c),role:{not:"VIEWER"}},select:{user:{select:{id:true,email:true}}},take:100}),tx.assuranceAnswer.findMany({where:{...org(c),status:"APPROVED",validUntil:{gt:new Date()}},select:{id:true,question:true,scope:true,productId:true,productContext:true},take:300}),tx.companyProduct.findMany({where:{...org(c),status:"ACTIVE"},select:{id:true,code:true,name:true,version:true,status:true},orderBy:{name:"asc"},take:100})]);let operation=null;if(requestKey){await requireMember(tx,c,ADMIN);const record=await questionnaireOperationRecord(tx,c,requestKey);if(record?.kind==="IMPORT")operation={requestKey:record.requestKey,questionnaireId:record.questionnaireId,version:record.version,kind:record.kind};else if(record)throw new IntelligenceError("This request key belongs to another operation",409);}const recurringGaps=requestKey?undefined:recurringQuestionnaireGaps(rows.filter(row=>row.status==="DRAFT").map(row=>({...row,questions:questionsSchema.parse(row.questions)})),admin?undefined:c.userId);return {admin,products,recurringGaps,questionnaires:rows.map(q=>({id:q.id,title:q.title,scope:q.scope,status:q.status,version:q.version,productContext:q.productContext})),members:admin?members:[],answers,operation};});}
export async function createQuestionnaire(c:AuthorizedContext,input:unknown,options?:{verifiedFile:{filename:string;sha256:string}}){
 const d=questionnaireInput.parse(input);let rows:z.infer<typeof questionImportRowSchema>[];
 if("csv" in d){try{rows=parseCsv(d.csv,["reference","question"],100).map(row=>questionImportRowSchema.parse(row));}catch{throw new IntelligenceError("Use reference,question CSV headers, quoted commas and at most 100 questions");}}
 else rows=d.rows.map(row=>{if(options?.verifiedFile){if(!row.source||row.source.filename!==options.verifiedFile.filename||row.source.sha256!==options.verifiedFile.sha256)throw new IntelligenceError("Imported question source does not match the inspected file",409);return row;}const {source:_unverifiedSource,...manual}=row;return manual;});
 if(new Set(rows.map(row=>row.reference)).size!==rows.length)throw new IntelligenceError("Question references must be unique");
 if(rows.length*Math.max(1,d.productIds?.length||0)>100)throw new IntelligenceError("Use at most 100 product responses per questionnaire; reduce the question or product selection",400);
 const requestHash=hashValue({title:d.title,recipient:d.recipient,scope:d.scope,ownerId:d.ownerId,rows,...(d.productIds?.length?{productIds:[...d.productIds].sort()}:{})});
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  await assertQuestionnaireOcrSourcesCurrent(tx,c.organizationId,rows);
  if(d.requestKey){const saved=await questionnaireOperationRecord(tx,c,d.requestKey);if(saved){if(saved.kind!=="IMPORT"||saved.requestHash!==requestHash)throw new IntelligenceError("This request key was already used for different questionnaire details",409);return {id:saved.questionnaireId,version:saved.version,reused:true};}}
  await activeOwner(tx,c,d.ownerId);await requireMember(tx,{...c,userId:d.ownerId},WRITER);
  if(await tx.assuranceQuestionnaire.count({where:org(c)})>=100)throw new IntelligenceError("Questionnaire limit reached",429);
  const approved=await tx.assuranceAnswer.findMany({where:{...org(c),scope:d.scope,status:"APPROVED",validUntil:{gt:new Date()}},orderBy:{id:"asc"},take:300}),usable=(await checkedAssuranceAnswers(tx,c.organizationId,approved)).filter(answer=>answer.current).map(answer=>answer.a);
  const productContext=await captureQuestionnaireProducts(tx,c.organizationId,d.productIds||[]),expanded:Array<z.infer<typeof questionImportRowSchema>&{productId?:string;productName?:string}>=rows.flatMap(row=>productContext?productContext.products.map(product=>({...row,productId:product.id,productName:product.name})):[row]);
  const questions=questionsSchema.parse(expanded.map(row=>{const matches=row.instructions?.trim()?[]:usable.filter(a=>answerMatchesProduct(row,a)&&normalQuestion(a.question)===normalQuestion(row.question)),a=matches.length===1?matches[0]:null;return {...row,id:randomUUID(),ownerId:d.ownerId,answerId:a?.id||null,answerVersion:a?.version||null,answerHash:a?.contentHash||null,status:a?"SUGGESTED":"EMPTY",changedById:null};}));
  const q=await tx.assuranceQuestionnaire.create({data:{...org(c),createdById:c.userId,title:d.title,recipient:d.recipient,scope:d.scope,questions:j(questions),...(productContext?{productContext:j(productContext)}:{})}});
  await event(tx,c,q.id,"questionnaire_imported",{count:questions.length,suggested:questions.filter(row=>row.status==="SUGGESTED").length,source:options?.verifiedFile?"VERIFIED_FILE":"MANUAL"});
  if(d.requestKey)await saveQuestionnaireOperation(tx,c,{requestKey:d.requestKey,kind:"IMPORT",questionnaireId:q.id,version:q.version,applied:questions.length,requestHash});
  return {id:q.id,version:q.version,reused:false};
 });
}
export async function questionnaireState(tx:Tx,c:AuthorizedContext,row:AssuranceQuestionnaire){
 const questions=questionsSchema.parse(row.questions),blockers:string[]=[],output=[];
 try{await assertQuestionnaireOcrSourcesCurrent(tx,c.organizationId,questions);}catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push(e.message);}
 try{await assertAssuranceParticipants(tx,c.organizationId,[],[row.createdById,...questions.flatMap(q=>[q.ownerId,...(q.changedById?[q.changedById]:[])])]);}catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push(e.message);}
 const answerIds=[...new Set(questions.map(q=>q.answerId).filter((id):id is string=>!!id))],rows=answerIds.length?await tx.assuranceAnswer.findMany({where:{...org(c),id:{in:answerIds}},orderBy:{id:"asc"}}):[],checked=await checkedAssuranceAnswers(tx,c.organizationId,rows),answers=new Map(checked.map(answer=>[answer.a.id,answer]));
 const productState=await loadProductScopeState(tx,c.organizationId,checked.flatMap(answer=>answer.content?.files.map(f=>f.id)||[]));
 for(const q of questions){
  let answer:CheckedAnswer|undefined,reason="";
  try{captureQuestionProductContextFromState(productState,row,q,[]);}catch(error){if(!(error instanceof IntelligenceError))throw error;reason=error.message;}
  if(!reason&&q.answerId){answer=answers.get(q.answerId);if(!answer)reason="Answer not found";else if(!answer.current){reason=answer.reason;answer=undefined;}else if(answer.a.scope!==row.scope||answer.a.version!==q.answerVersion||answer.a.contentHash!==q.answerHash||!answerMatchesProduct(q,answer.a)){reason="Approved answer changed or belongs to another product or scope";answer=undefined;}else try{captureQuestionProductContextFromState(productState,row,q,answer.content!.files.map(f=>f.id));}catch(error){if(!(error instanceof IntelligenceError))throw error;reason=error.message;answer=undefined;}}
  else if(!reason)reason="Choose an independently approved answer";
  const label=q.reference+(q.productName?" · "+q.productName:"");
  if(q.status!=="READY")blockers.push(label+": confirm the answer for this question");if(reason)blockers.push(label+": "+reason);
  output.push({...q,answer:answer?.content?.answer||null,files:answer?.content?.files||[],reason});
 }
 const files=[...new Map(output.flatMap(q=>q.files).map(f=>[f.id,f])).values()];if(files.length>50)blockers.push("A questionnaire can disclose at most 50 distinct evidence references");
 const products=productQuestionnaireContextSchema.safeParse(row.productContext);
 const disclosure={title:row.title,recipient:row.recipient,scope:row.scope,questions:output.map(q=>({reference:q.reference,question:q.question,answer:q.answer||"",evidence:q.files.map(f=>({filename:f.filename,sha256:f.sha256})),...(q.productId?{product:products.success?products.data.products.find(p=>p.id===q.productId)||null:null}:{}),...(q.instructions!==undefined?{instructions:q.instructions}:{}),...(q.suppliedAnswer!==undefined?{suppliedAnswer:q.suppliedAnswer}:{}),...(q.source?{source:q.source}:{})}))};
 const contextHash=hashValue({questions:row.questions,disclosure,files,blockers,...(row.productContext?{productContext:row.productContext}:{})});
 return {questions:output,files,disclosure,contextHash,blockers};
}
export async function questionnaireDetail(c:AuthorizedContext,id:string){return transaction(c,async tx=>{const actor=await requireMember(tx,c,WRITER),admin=ADMIN.includes(actor.role),row=await tx.assuranceQuestionnaire.findFirst({where:{id,...org(c)}});if(!row||!admin&&!questionsSchema.parse(row.questions).some(q=>q.ownerId===c.userId))throw new IntelligenceError("Questionnaire not found",404);const s=await questionnaireState(tx,c,row),answers=await tx.assuranceAnswer.findMany({where:{...org(c),scope:row.scope,status:"APPROVED",validUntil:{gt:new Date()}},select:{id:true,question:true,productId:true,productContext:true},take:300});const questions=(admin?s.questions:s.questions.filter(q=>q.ownerId===c.userId)).map(q=>({...q,instructions:q.instructions||"",suppliedAnswer:q.suppliedAnswer||"",suggestions:answerMatches(q.question,answers.filter(a=>answerMatchesProduct(q,a)))}));let current=false,currentReason="";if(row.status==="APPROVED"){try{await approvedDisclosure(tx,c.organizationId,id);current=true;}catch(e){if(!(e instanceof IntelligenceError)&&!(e instanceof z.ZodError))throw e;currentReason=e instanceof IntelligenceError?e.message:"Approved disclosure integrity failed";}}return {admin,canPrepare:admin&&row.status==="DRAFT",questionnaire:{id:row.id,title:row.title,recipient:row.recipient,scope:row.scope,status:row.status,version:row.version,createdById:row.createdById,reviewerId:row.reviewerId,reviewNotes:row.reviewNotes,productContext:row.productContext},questions,blockers:admin?s.blockers:[],contextHash:admin?s.contextHash:"",disclosure:admin?s.disclosure:null,current,currentReason};});}
async function approvableQuestionnaire(tx:Tx,c:AuthorizedContext,id:string,version:number){await requireMember(tx,c,ADMIN);const row=await tx.assuranceQuestionnaire.findFirst({where:{id,...org(c),version,status:"DRAFT"}});if(!row)throw new IntelligenceError("Questionnaire changed; refresh",409);const s=await questionnaireState(tx,c,row);if(s.blockers.length)throw new IntelligenceError(s.blockers[0],409);if(row.createdById===c.userId||s.questions.some(q=>q.changedById===c.userId)||s.files.some(f=>f.uploadedById===c.userId))throw new IntelligenceError("A different administrator must approve the customer disclosure",403);return {row,...s};}
export async function changeQuestionnaire(c:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){const d=questionnaireAction.parse(input);if(d.action==="APPROVE"){const pre=await transaction(c,tx=>approvableQuestionnaire(tx,c,id,d.version));await verifyReviewedBytes(c,pre.files,store);await verifyQuestionnaireOcrOriginals(c,pre.questions,store);return transaction(c,async tx=>{const s=await approvableQuestionnaire(tx,c,id,d.version);if(s.contextHash!==pre.contextHash)throw new IntelligenceError("Customer disclosure changed during verification",409);const snapshot={contextHash:s.contextHash,disclosure:s.disclosure,approvedById:c.userId,approvedAt:new Date().toISOString()};await tx.assuranceQuestionnaire.update({where:{id},data:{status:"APPROVED",approvedSnapshot:j(snapshot),approvedHash:hashValue(snapshot),approvedAt:new Date(),reviewerId:c.userId,reviewNotes:d.notes,version:{increment:1}}});await event(tx,c,id,"questionnaire_approved",{approvedHash:hashValue(snapshot)});return {id};});}
 return transaction(c,async tx=>{const actor=await requireMember(tx,c,WRITER),row=await tx.assuranceQuestionnaire.findFirst({where:{id,...org(c)}});if(!row||row.version!==d.version)throw new IntelligenceError("Questionnaire changed; refresh",409);const questions=questionsSchema.parse(row.questions);
 if(d.action==="ANSWER"||d.action==="ASSIGN"){if(row.status!=="DRAFT")throw new IntelligenceError("Reopen the questionnaire before changing answers",409);const q=questions.find(q=>q.id===d.questionId);if(!q)throw new IntelligenceError("Question not found",404);if(d.action==="ASSIGN"){await requireMember(tx,c,ADMIN);await activeOwner(tx,c,d.ownerId);await requireMember(tx,{...c,userId:d.ownerId},WRITER);if(q.ownerId!==d.ownerId){q.ownerId=d.ownerId;q.status=q.answerId?"SUGGESTED":"EMPTY";q.changedById=null;}}else{await assertQuestionnaireOcrSourcesCurrent(tx,c.organizationId,[q]);if(q.ownerId!==c.userId)throw new IntelligenceError("Only the assigned colleague may confirm this answer",403);const {a,content}=await currentAnswer(tx,c.organizationId,d.answerId);if(a.scope!==row.scope||!answerMatchesProduct(q,a))throw new IntelligenceError("Answer product and scope must match this question",409);captureQuestionProductContextFromState(await loadProductScopeState(tx,c.organizationId,content.files.map(f=>f.id)),row,q,content.files.map(f=>f.id));q.answerId=a.id;q.answerVersion=a.version;q.answerHash=a.contentHash;q.status="READY";q.changedById=c.userId;}await tx.assuranceQuestionnaire.update({where:{id},data:{questions:j(questions),version:{increment:1}}});}
 else{await requireMember(tx,c,ADMIN);if(d.action==="REFRESH_PRODUCTS"){
  if(row.status!=="DRAFT")throw new IntelligenceError("Reopen the questionnaire before refreshing products",409);
  const old=productQuestionnaireContextSchema.safeParse(row.productContext);if(!old.success)throw new IntelligenceError("This questionnaire has no product selection to refresh",409);
  const productContext=await captureQuestionnaireProducts(tx,c.organizationId,old.data.products.map(p=>p.id));
  const refreshed=questions.map(q=>{const product=productContext!.products.find(p=>p.id===q.productId);if(!product)throw new IntelligenceError("Question product context is inconsistent",409);const previous=old.data.products.find(p=>p.id===q.productId);return hashValue(previous)===hashValue(product)?q:{...q,productName:product.name,status:q.answerId?"SUGGESTED":"EMPTY",changedById:null};});
  await tx.assuranceQuestionnaire.update({where:{id},data:{productContext:j(productContext),questions:j(refreshed),version:{increment:1}}});
 }else if(d.action==="WITHDRAW"){await tx.assuranceQuestionnaire.update({where:{id},data:{status:"WITHDRAWN",reviewNotes:d.notes,version:{increment:1}}});}else{if(row.status!=="APPROVED")throw new IntelligenceError("Only an approved questionnaire can be reopened",409);const history=z.array(z.unknown()).max(19).parse(row.history);if(!row.approvedSnapshot||hashValue(row.approvedSnapshot)!==row.approvedHash)throw new IntelligenceError("Earlier disclosure integrity failed",409);await tx.assuranceQuestionnaire.update({where:{id},data:{status:"DRAFT",createdById:c.userId,questions:j(questions.map(q=>({...q,status:q.answerId?"SUGGESTED":"EMPTY",changedById:null}))),approvedSnapshot:Prisma.DbNull,approvedHash:null,approvedAt:null,reviewerId:null,history:j([...history,{snapshot:row.approvedSnapshot,hash:row.approvedHash,notes:d.notes}]),version:{increment:1}}});}}
 await event(tx,c,id,d.action.toLowerCase()+"_questionnaire");return {id};});}
export async function approvedDisclosure(tx:Tx,organizationId:string,id:string){const row=await tx.assuranceQuestionnaire.findFirst({where:{id,organizationId,status:"APPROVED"}});if(!row||!row.approvedSnapshot||hashValue(row.approvedSnapshot)!==row.approvedHash)throw new IntelligenceError("Approved customer disclosure unavailable",409);const state=await questionnaireState(tx,{organizationId,userId:"",role:"ADMIN"},row);if(state.blockers.length||(row.approvedSnapshot as {contextHash:string}).contextHash!==state.contextHash)throw new IntelligenceError("Customer disclosure is stale; review the changed answers or evidence",409);if(!row.reviewerId||row.reviewerId===row.createdById||state.questions.some(q=>q.changedById===row.reviewerId)||state.files.some(file=>file.uploadedById===row.reviewerId)||(row.approvedSnapshot as {approvedById?:string}).approvedById!==row.reviewerId)throw new IntelligenceError("Customer disclosure independent approval is no longer valid",409);await assertAssuranceParticipants(tx,organizationId,state.files,[row.createdById,...state.questions.flatMap(q=>[q.ownerId,...(q.changedById?[q.changedById]:[])])],[row.reviewerId]);return {row,...state};}
export async function exportQuestionnaire(c:AuthorizedContext,id:string,store?:EvidenceObjectStore){const pre=await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);return approvedDisclosure(tx,c.organizationId,id);});await verifyReviewedBytes(c,pre.files,store);await verifyQuestionnaireOcrOriginals(c,pre.questions,store);return transaction(c,async tx=>{await requireMember(tx,c,ADMIN);const s=await approvedDisclosure(tx,c.organizationId,id);if(s.row.version!==pre.row.version||s.contextHash!==pre.contextHash)throw new IntelligenceError("Disclosure changed during export",409);await event(tx,c,id,"questionnaire_exported");return {format:"regpilot-customer-assurance-v1",...s.disclosure,approvedHash:s.row.approvedHash,approvedAt:s.row.approvedAt,csv:safeCsv([["Reference","Question","Answer","Scope","Evidence references",...(s.row.productContext?["Product code","Product name","Product ID"]:[])],...s.disclosure.questions.map(q=>[q.reference,q.question,q.answer,s.disclosure.scope,q.evidence.map(f=>f.filename+" (SHA-256 "+f.sha256+")").join("; "),...(s.row.productContext?[q.product?.code||"",q.product?.name||"",q.product?.id||""]:[])])])};});}
