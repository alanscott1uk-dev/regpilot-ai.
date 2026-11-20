import {Prisma} from '@prisma/client';
import {questionsSchema} from '../assurance-operations';
import {automationInput,classifyQuestion,knowledgeHealth,QUESTIONNAIRE_AUTOMATION_VERSION,type AutomationInput,type KnowledgeAnswer} from '../questionnaire-automation';
import {hashValue} from '../regulatory/intelligence';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {completionParticipants} from './work-completion-service';
import {checkedAssuranceAnswers,questionnaireOperationRecord,saveQuestionnaireOperation} from './customer-assurance-service';
import {reviewedFilesSchema,verifyReviewedBytes,type ReviewedFile} from './reviewed-files';
import type {AuthorizedContext} from './authorization';
import type {EvidenceObjectStore} from './evidence-storage';

type Tx=Prisma.TransactionClient;
type Knowledge=KnowledgeAnswer&{files:ReviewedFile[];participants:Awaited<ReturnType<typeof completionParticipants>>};
type Apply=Extract<AutomationInput,{operation:'APPLY'}>;
const org=(c:AuthorizedContext)=>({organizationId:c.organizationId});
const json=(value:unknown)=>value as Prisma.InputJsonValue;

async function scopedKnowledge(tx:Tx,c:AuthorizedContext,scope:string):Promise<Knowledge[]>{
 const answers=await tx.assuranceAnswer.findMany({where:{...org(c),scope},orderBy:{id:'asc'},take:300});
 return (await checkedAssuranceAnswers(tx,c.organizationId,answers)).map(({a:answer,current,reason,content,participants})=>({id:answer.id,question:answer.question,scope:answer.scope,answer:answer.answer,version:answer.version,contentHash:answer.contentHash,validUntil:answer.validUntil.toISOString(),status:answer.status,current,reason,files:current?content!.files:[],participants}));
}

async function automationState(tx:Tx,c:AuthorizedContext,id:string){
 const actor=await requireMember(tx,c,WRITER),admin=ADMIN.includes(actor.role);
 const row=await tx.assuranceQuestionnaire.findFirst({where:{id,...org(c)}});
 if(!row)throw new IntelligenceError('Questionnaire not found',404);
 const all=questionsSchema.parse(row.questions),visible=admin?all:all.filter(question=>question.ownerId===c.userId);
 if(!admin&&!visible.length)throw new IntelligenceError('Questionnaire not found',404);
 const knowledge=await scopedKnowledge(tx,c,row.scope);
 const people=await completionParticipants(tx,c,[c.userId,row.createdById,...all.flatMap(question=>[question.ownerId,question.changedById])]);
 const questions=visible.map(question=>{
  const {candidates,...insight}=classifyQuestion(question,knowledge);
  return {...question,instructions:question.instructions||'',suppliedAnswer:question.suppliedAnswer||'',...insight,candidates:candidates.map(({participants:_participants,...candidate})=>candidate)};
 });
 const token=hashValue({engine:QUESTIONNAIRE_AUTOMATION_VERSION,organizationId:c.organizationId,actorId:c.userId,role:actor.role,questionnaire:{id:row.id,version:row.version,title:row.title,recipient:row.recipient,scope:row.scope,status:row.status,questions:row.questions},people,knowledge});
 return {row,all,knowledge,people,token,view:{questionnaireId:row.id,version:row.version,canPrepare:admin&&row.status==='DRAFT',summary:{total:questions.length,supported:questions.filter(question=>question.classification==='SUPPORTED').length,ambiguous:questions.filter(question=>question.classification==='AMBIGUOUS').length,unanswered:questions.filter(question=>question.classification==='UNANSWERED').length,conflicting:questions.filter(question=>question.classification==='CONFLICTING').length,expired:questions.filter(question=>question.classification==='EXPIRED').length,ready:questions.filter(question=>question.status==='READY').length},questions,knowledgeHealth:knowledgeHealth(knowledge)}};
}

const operationView=(record:NonNullable<Awaited<ReturnType<typeof questionnaireOperationRecord>>>)=>({requestKey:record.requestKey,questionnaireId:record.questionnaireId,version:record.version,applied:record.applied});
/** Read-only recovery is exact to the actor, company, questionnaire and client request key. */
export async function questionnaireAutomation(c:AuthorizedContext,id:string,requestKey?:string){
 return transaction(c,async tx=>{
  let operation=null;
  if(requestKey){await requireMember(tx,c,ADMIN);const saved=await questionnaireOperationRecord(tx,c,requestKey);if(saved){if(saved.kind!=='REUSE'||saved.questionnaireId!==id)throw new IntelligenceError('This request key belongs to another questionnaire operation',409);operation=operationView(saved);}}
  const state=await automationState(tx,c,id);
  return {...state.view,operation};
 });
}

const requestHash=(id:string,input:Apply)=>hashValue({engine:QUESTIONNAIRE_AUTOMATION_VERSION,questionnaireId:id,version:input.version,previewToken:input.previewToken,selections:[...input.selections].sort((a,b)=>a.questionId.localeCompare(b.questionId))});
async function prepareApply(tx:Tx,c:AuthorizedContext,id:string,input:Apply){
 await requireMember(tx,c,ADMIN);
 const hash=requestHash(id,input),saved=await questionnaireOperationRecord(tx,c,input.requestKey);
 if(saved){if(saved.kind!=='REUSE'||saved.questionnaireId!==id||saved.requestHash!==hash)throw new IntelligenceError('This request key was already used for different answer selections',409);return {kind:'REPLAY' as const,saved};}
 const state=await automationState(tx,c,id);
 if(state.row.status!=='DRAFT'||state.row.version!==input.version)throw new IntelligenceError('Questionnaire changed; refresh and preview again',409);
 if(state.token!==input.previewToken)throw new IntelligenceError('The approved answers, evidence, owners or questionnaire changed. Preview the current suggestions again.',409);
 const selected=new Map<string,Knowledge>();
 for(const choice of input.selections){
  const question=state.all.find(question=>question.id===choice.questionId),insight=state.view.questions.find(question=>question.id===choice.questionId);
  if(!question||!insight)throw new IntelligenceError('Selected question not found',404);
  if(question.status==='READY')throw new IntelligenceError('A confirmed answer cannot be replaced by batch suggestions',409);
  if(!state.people.some(person=>person.id===question.ownerId&&person.approved&&WRITER.includes(person.role)))throw new IntelligenceError('Every selected question needs a current editor or administrator as its owner',409);
  const candidate=insight.candidates.find(answer=>answer.id===choice.answerId&&answer.selectable),answer=state.knowledge.find(answer=>answer.id===choice.answerId&&answer.current);
  if(!candidate||!answer)throw new IntelligenceError('Choose a current approved answer from the preview for every selected question',409);
  selected.set(question.id,answer);
 }
 const files=new Map<string,ReviewedFile>();
 for(const question of state.all){const answer=selected.get(question.id)||state.knowledge.find(answer=>answer.id===question.answerId&&answer.current);if(answer)for(const file of answer.files)files.set(file.id,file);}
 if(files.size>50)throw new IntelligenceError('A questionnaire can disclose at most 50 distinct evidence references',409);
 const selectedFiles=[...new Map([...selected.values()].flatMap(answer=>answer.files).map(file=>[file.id,file])).values()].sort((a,b)=>a.id.localeCompare(b.id));
 // Parse the complete safe projection before any private object access.
 for(const answer of selected.values())reviewedFilesSchema.parse(answer.files);
 return {kind:'APPLY' as const,state,selected,selectedFiles,requestHash:hash};
}

export async function automateQuestionnaire(c:AuthorizedContext,id:string,input:unknown,storage?:EvidenceObjectStore){
 const data=automationInput.parse(input);
 if(data.operation==='PREVIEW')return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);const state=await automationState(tx,c,id);
  if(state.row.status!=='DRAFT'||state.row.version!==data.version)throw new IntelligenceError('Questionnaire changed; refresh before previewing',409);
  return {...state.view,operation:null,previewToken:state.token};
 });
 const before=await transaction(c,tx=>prepareApply(tx,c,id,data));
 if(before.kind==='REPLAY')return {id:before.saved.questionnaireId,version:before.saved.version,requestKey:data.requestKey,applied:before.saved.applied,reused:true};
 await verifyReviewedBytes(c,before.selectedFiles,storage);
 return transaction(c,async tx=>{
  const checked=await prepareApply(tx,c,id,data);
  if(checked.kind==='REPLAY')return {id:checked.saved.questionnaireId,version:checked.saved.version,requestKey:data.requestKey,applied:checked.saved.applied,reused:true};
  const questions=checked.state.all.map(question=>{const answer=checked.selected.get(question.id);return answer?{...question,answerId:answer.id,answerVersion:answer.version,answerHash:answer.contentHash,status:'SUGGESTED' as const,changedById:null}:question;});
  const updated=await tx.assuranceQuestionnaire.update({where:{id},data:{questions:json(questions),version:{increment:1}},select:{version:true}});
  const saved=await saveQuestionnaireOperation(tx,c,{kind:'REUSE',requestKey:data.requestKey,questionnaireId:id,version:updated.version,applied:checked.selected.size,requestHash:checked.requestHash});
  await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:'CustomerAssurance',entityId:id,action:'customer_assurance.answers_suggested',details:{version:updated.version,questionIds:data.selections.map(choice=>choice.questionId),answerIds:data.selections.map(choice=>choice.answerId),requestKey:data.requestKey,requiresOwnerConfirmation:true}}});
  return {id,version:updated.version,requestKey:data.requestKey,applied:saved.applied,reused:false};
 });
}
