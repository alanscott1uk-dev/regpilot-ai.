import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {currentAssessment} from './assurance-service';
import {completionReceiptSchema,completionTaskRecord,completionContext,completionParticipants,completionProofSnapshot,verifyCompletionFiles,savedCompletion,verifiedCompletionEvent,type CompletionTask,type CompletionContext,type CompletionReceipt,type SavedCompletion} from './work-completion-service';
import type {EvidenceObjectStore} from './evidence-storage';
import {allowedEmail} from '../ai/security.mjs';
import {hashValue} from '../regulatory/intelligence';
import {sourceTextHash} from '../regulatory/source-fingerprint.mjs';
import {workUuid} from '../work-hub.mjs';
import {COMPLETION_EVIDENCE_LIMIT,selectedCompletionEvidence} from '../work-completion.mjs';
import {WORK_REVIEW_PAGE_SIZE,WORK_REVIEW_SCOPE,parseWorkReviewFollowUp,parseWorkVerification,type WorkReviewQuery} from '../work-review.mjs';

const VERIFIED='work.review_verified',FOLLOW_UP='work.review_follow_up_created',HISTORY_BOUND=200;
const id=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),iso=z.string().datetime();
const findingSchema=z.object({code:z.string(),message:z.string(),href:z.string(),label:z.string()});
const proofSchema=completionReceiptSchema.pick({source:true,control:true,assessment:true,evidence:true}).extend({
 task:z.object({id,title:z.string(),category:z.string(),ownerName:z.string(),assigneeId:id.nullable(),dueDate:z.string(),updatedAt:iso})
});
const verificationSchema=z.object({format:z.literal('regpilot-work-verification'),version:z.literal(1),organizationId:id,originalTaskId:id,
 completionEventId:id,completionProofHash:sha,previousBasisEventId:id,previousBasisProofHash:sha,
 verifiedAt:iso,verifiedById:id,notes:z.string().min(20).max(500),proof:proofSchema,scope:z.string()});
const followUpSchema=z.object({format:z.literal('regpilot-work-review-follow-up'),version:z.literal(1),organizationId:id,originalTaskId:id,
 completionEventId:id,completionProofHash:sha,basisEventId:id,basisProofHash:sha,observationHash:sha,automationKey:sha,previousFollowUpTaskId:id.nullable(),
 taskId:id,title:z.string(),assigneeId:id,ownerName:z.string(),dueDate:z.string(),reason:z.string().min(20).max(500),
 findings:z.array(findingSchema).min(1),createdAt:iso,createdById:id});
type Proof=z.infer<typeof proofSchema>;
export type WorkVerificationRecord=z.infer<typeof verificationSchema>;
export type Finding=z.infer<typeof findingSchema>;
export type ReviewItem={task:{id:string;title:string;category:string;ownerName:string;dueDate:string;completedAt:string|null};state:'NO_RECORDED_CHANGES'|'NEEDS_REVIEW'|'UNAVAILABLE'|'SPECIALIST';findings:Finding[];basis:{eventId:string;proofHash:string;checkedAt:string;kind:'COMPLETION'|'VERIFICATION'}|null;followUp:{id:string;title:string;status:string;dueDate:string;ownerName:string}|null;href:string};
export type WorkReviewQueue={organizationId:string;actorId:string;role:string;items:ReviewItem[];total:number;page:number;pages:number;pageSize:25;query:WorkReviewQuery;scope:string};
export type WorkReviewDetail={organizationId:string;role:string;item:ReviewItem;original:{eventId:string;proofHash:string;completedAt:string;receipt:CompletionReceipt}|null;
 latestVerification:WorkVerificationRecord|null;verificationHistory:{eventId:string;proofHash:string;verifiedAt:string;verifiedById:string;notes:string}[];historyLimited:boolean;
 token:string|null;canCreateFollowUp:boolean;members:{id:string;email:string}[];membersLimited:boolean;
 verification:{canVerify:boolean;token:string|null;evidence:{id:string;filename:string;sha256:string;reviewVersion:number;reviewedAt:string;required:boolean}[];evidenceLimit:number;blockers:Finding[]};scope:string};
export type WorkReviewFollowUpPreview={token:string;sourceTaskId:string;title:string;assignee:{id:string;email:string};dueDate:string;reason:string;findings:Finding[];existing:ReviewItem['followUp']};
export type WorkReviewFollowUpResult={taskId:string;sourceTaskId:string;eventId:string;reused:boolean};
export type WorkReviewVerifyResult={taskId:string;eventId:string;proofHash:string;verifiedAt:string;evidenceCount:number;reused:boolean;record:WorkVerificationRecord};
type AuditRow={id:string;actorId:string;action:string;details:Prisma.JsonValue;createdAt:Date};
type Verification={eventId:string;proofHash:string;requestHash:string;record:WorkVerificationRecord};
type FollowUp={eventId:string;recordHash:string;requestHash:string;record:z.infer<typeof followUpSchema>;task:NonNullable<ReviewItem['followUp']>};
type ReviewState={task:CompletionTask;original:SavedCompletion|null;item:ReviewItem;proof:Proof|null;verifications:Verification[];followUps:FollowUp[];current:CompletionContext|null;token:string|null;verificationToken:string|null;observationHash:string|null};
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const href=(ctx:AuthorizedContext,path:string,taskId?:string)=>path+'?organizationId='+encodeURIComponent(ctx.organizationId)+(taskId?'&taskId='+encodeURIComponent(taskId):'');
const finding=(code:string,message:string,url='',label=''):Finding=>({code,message,href:url,label});
const details=(row:AuditRow)=>row.details&&typeof row.details==='object'&&!Array.isArray(row.details)?row.details as Record<string,Prisma.JsonValue>:{};
function originalProof(original:SavedCompletion):Proof {
 const {task,source,control,assessment,evidence}=original.receipt;
 return {task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate,updatedAt:task.updatedAtBefore},source,control,assessment,evidence};
}
function currentProof(current:CompletionContext,files:CompletionContext['evidence']):Proof {
 const task=current.task;
 return {task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate.toISOString().slice(0,10),updatedAt:task.updatedAt.toISOString()},...completionProofSnapshot(current,files)};
}
function parseVerification(event:AuditRow,ctx:AuthorizedContext,original:SavedCompletion):Verification|null {
 const data=details(event),parsed=verificationSchema.safeParse(data.record);
 if(!parsed.success||!sha.safeParse(data.proofHash).success||!sha.safeParse(data.requestHash).success||hashValue(parsed.data)!==data.proofHash)return null;
 const record=parsed.data;
 if(record.organizationId!==ctx.organizationId||record.originalTaskId!==original.receipt.task.id||record.proof.task.id!==record.originalTaskId||record.verifiedById!==event.actorId||record.completionEventId!==original.eventId||record.completionProofHash!==original.proofHash)return null;
 return {eventId:event.id,proofHash:data.proofHash as string,requestHash:data.requestHash as string,record};
}
const followUpKey=(record:{completionEventId:string;basisEventId:string;observationHash:string;previousFollowUpTaskId:string|null})=>hashValue({kind:'work-review-follow-up',completionEventId:record.completionEventId,basisEventId:record.basisEventId,observationHash:record.observationHash,previousFollowUpTaskId:record.previousFollowUpTaskId});

async function loadRecords(tx:Prisma.TransactionClient,ctx:AuthorizedContext,task:CompletionTask,original:SavedCompletion){
 // Ordering and app/DB clock differences cannot identify a proof generation. Validate records first,
 // scope by immutable completion linkage, then follow predecessor IDs/hashes rather than timestamps.
 const events=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:'Obligation',entityId:task.id,action:{in:[VERIFIED,FOLLOW_UP]}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:HISTORY_BOUND+1,select:{id:true,actorId:true,action:true,details:true,createdAt:true}});
 if(events.length>HISTORY_BOUND)return {error:'The review history exceeds the supported verification window. An administrator must inspect its audit history.',verifications:[],followUps:[]} as const;
 const pendingVerifications:Verification[]=[],pendingFollowUps:{event:AuditRow;record:z.infer<typeof followUpSchema>;recordHash:string;requestHash:string}[]=[];
 const invalid=(error:string)=>({error,verifications:[],followUps:[]} as const);
 const referencedIds=[...new Set(events.flatMap(event=>{const record=details(event).record;return record&&typeof record==='object'&&!Array.isArray(record)&&workUuid(record.completionEventId)?[record.completionEventId]:[];}))];
 const olderEvents=referencedIds.length?await tx.auditEvent.findMany({where:{id:{in:referencedIds},organizationId:ctx.organizationId,entityType:'Obligation',entityId:task.id,action:'work.completed'},select:{id:true,actorId:true,action:true,details:true}}):[];
 const completions=new Map<string,string>();
 for(const event of olderEvents){const saved=verifiedCompletionEvent(ctx,task.id,event);if(saved)completions.set(saved.eventId,saved.proofHash);}
 completions.set(original.eventId,original.proofHash);
 for(const event of events){
  const data=details(event);
  if(event.action===VERIFIED){
   const parsed=verificationSchema.safeParse(data.record);
   if(!parsed.success||!sha.safeParse(data.proofHash).success||!sha.safeParse(data.requestHash).success||hashValue(parsed.data)!==data.proofHash||parsed.data.organizationId!==ctx.organizationId||parsed.data.originalTaskId!==task.id||parsed.data.proof.task.id!==task.id||parsed.data.verifiedById!==event.actorId)return invalid('A saved verification record failed its integrity check. Review the audit history before creating a new decision.');
   if(completions.get(parsed.data.completionEventId)!==parsed.data.completionProofHash)return invalid('A verification references an unavailable or invalid completion generation.');
   if(parsed.data.completionEventId!==original.eventId)continue;
   const value=parseVerification(event,ctx,original);
   if(!value)return invalid('A saved verification record does not match this completion.');
   pendingVerifications.push(value);
  }else{
   const parsed=followUpSchema.safeParse(data.record);
   if(!parsed.success||!sha.safeParse(data.recordHash).success||!sha.safeParse(data.requestHash).success||hashValue(parsed.data)!==data.recordHash)return invalid('A saved follow-up link failed its integrity check. Review the audit history before proceeding.');
   const record=parsed.data;
   if(record.organizationId!==ctx.organizationId||record.originalTaskId!==task.id||record.createdById!==event.actorId||followUpKey(record)!==record.automationKey)return invalid('A saved follow-up link does not match its recorded task or creator.');
   if(completions.get(record.completionEventId)!==record.completionProofHash)return invalid('A follow-up references an unavailable or invalid completion generation.');
   if(record.completionEventId!==original.eventId)continue;
   if(record.completionProofHash!==original.proofHash)return invalid('A saved follow-up link does not match this completion.');
   pendingFollowUps.push({event,record,recordHash:data.recordHash as string,requestHash:data.requestHash as string});
  }
 }
 const verifications:Verification[]=[],followUps:FollowUp[]=[],bases=new Map([[original.eventId,original.proofHash]]);
 let previousId=original.eventId,previousHash=original.proofHash;
 while(verifications.length<pendingVerifications.length){
  const children=pendingVerifications.filter(row=>row.record.previousBasisEventId===previousId);
  if(children.length!==1||children[0].record.previousBasisProofHash!==previousHash)return invalid('The saved verification history is incomplete or branched. Review its audit history before proceeding.');
  const child=children[0];if(bases.has(child.eventId))return invalid('The saved verification history contains a cycle.');
  verifications.push(child);bases.set(child.eventId,child.proofHash);previousId=child.eventId;previousHash=child.proofHash;
 }
 let previousFollowUpTaskId:string|null=null;
 while(followUps.length<pendingFollowUps.length){
   const children=pendingFollowUps.filter(row=>row.record.previousFollowUpTaskId===previousFollowUpTaskId);
   if(children.length!==1)return invalid('The saved follow-up history is incomplete or branched. Review its audit history before proceeding.');
   const {event,record,recordHash,requestHash}=children[0];
   if(bases.get(record.basisEventId)!==record.basisProofHash||followUps.some(row=>row.task.id===record.taskId))return invalid('A follow-up does not match a verified review basis.');
   const linked=await tx.obligation.findFirst({where:{id:record.taskId,organizationId:ctx.organizationId,automationKey:record.automationKey,originKey:null,controlId:null},select:{id:true,title:true,status:true,dueDate:true,ownerName:true}});
   if(!linked)return invalid('The recorded follow-up task is unavailable or no longer matches its immutable link.');
   followUps.push({eventId:event.id,recordHash,requestHash,record,task:{...linked,dueDate:linked.dueDate.toISOString().slice(0,10)}});previousFollowUpTaskId=linked.id;
 }
 return {error:null,verifications,followUps};
}

/** Live metadata only: this does not retrieve bytes or claim they have just been verified. */
async function changes(tx:Prisma.TransactionClient,ctx:AuthorizedContext,task:CompletionTask,proof:Proof,basisActor:{id:string;roles:string[]}){
 const findings:Finding[]=[],evidenceLink=href(ctx,'/team/evidence',task.id),assessmentLink=href(ctx,'/team/assurance',task.id);
 const files=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,id:{in:proof.evidence.map(file=>file.id)}},orderBy:{id:'asc'},select:{id:true,obligationId:true,filename:true,sha256:true,scanStatus:true,reviewVersion:true,reviewStatus:true,reviewedAt:true,uploadedById:true,reviewerId:true}});
 const assessment=proof.assessment?await tx.assuranceAssessment.findFirst({where:{organizationId:ctx.organizationId,id:proof.assessment.id,obligationId:task.id}}):null;
 const source=proof.source?await tx.regulatorySnapshot.findFirst({where:{organizationId:ctx.organizationId,sourceId:proof.source.sourceId},orderBy:[{firstCapturedAt:'desc'},{id:'desc'}],select:{id:true,contentHash:true,bodyText:true,version:true,reviewStatus:true,reviewedAt:true,lastCheckedAt:true,capturedById:true,reviewerId:true}}):null;
 const people=await completionParticipants(tx,ctx,[basisActor.id,...files.flatMap(file=>[file.uploadedById,file.reviewerId]),assessment?.createdById||null,assessment?.reviewerId||null,source?.capturedById||null,source?.reviewerId||null]);
 const authorised=(userId:string|null,roles:string[])=>!!userId&&people.some(person=>person.id===userId&&person.approved&&roles.includes(person.role));
 if(!authorised(basisActor.id,basisActor.roles))findings.push(finding('BASIS_AUTHORITY_CHANGED','The person who recorded the latest completion or verification no longer has the required workspace permission. An authorised administrator should review the current proof.',href(ctx,'/team/work',task.id),'Review task context'));
 for(const old of proof.evidence){
  const file=files.find(row=>row.id===old.id);
  if(!file){findings.push(finding('EVIDENCE_UNAVAILABLE','A file recorded in the review basis is no longer available.',evidenceLink,'Review task evidence'));continue;}
  if(!proof.assessment&&!task.originKey&&file.obligationId!==task.id)findings.push(finding('EVIDENCE_SCOPE_CHANGED',old.filename+' is no longer attached to this task. Review its current scope.',evidenceLink,'Review task evidence'));
  if(file.sha256!==old.sha256||file.reviewVersion!==old.reviewVersion||file.reviewedAt?.toISOString()!==old.reviewedAt||file.uploadedById!==old.uploadedById||file.reviewerId!==old.reviewerId)findings.push(finding('EVIDENCE_CHANGED','The recorded fingerprint or review of '+old.filename+' has changed.',evidenceLink,'Review task evidence'));
  if(file.scanStatus!=='CLEAN'||file.reviewStatus!=='APPROVED'||!file.reviewedAt||!file.uploadedById||!file.reviewerId||file.uploadedById===file.reviewerId)findings.push(finding('EVIDENCE_APPROVAL_REQUIRED',old.filename+' no longer has a clean, independent approval.',evidenceLink,'Review task evidence'));
  if(!authorised(file.uploadedById,WRITER)||!authorised(file.reviewerId,ADMIN))findings.push(finding('EVIDENCE_AUTHORITY_CHANGED','The uploader or independent reviewer of '+old.filename+' is no longer authorised.',evidenceLink,'Review task evidence'));
 }
 let assessmentCurrent:null|{valid:boolean;reason:string|null}=null;
 if(proof.assessment){
  if(!assessment||assessment.status!=='ACCEPTED')findings.push(finding('ASSESSMENT_UNAVAILABLE','The accepted evidence assessment is no longer available as an accepted decision.',assessmentLink,'Review evidence assessment'));
  else{
   assessmentCurrent=await currentAssessment(tx,ctx.organizationId,assessment);
   if(!assessmentCurrent.valid)findings.push(finding('ASSESSMENT_NOT_CURRENT',assessmentCurrent.reason||'The evidence assessment needs a fresh independent review.',assessmentLink,'Review evidence assessment'));
   if(assessment.version!==proof.assessment.version||assessment.inputHash!==proof.assessment.inputHash||assessment.resultHash!==proof.assessment.resultHash||assessment.validUntil?.toISOString()!==proof.assessment.validUntil||assessment.reviewerId!==proof.assessment.reviewerId||assessment.reviewedAt?.toISOString()!==proof.assessment.reviewedAt)findings.push(finding('ASSESSMENT_CHANGED','The assessment decision or its review period changed after this proof was recorded.',assessmentLink,'Review evidence assessment'));
   if(!authorised(assessment.createdById,WRITER)||!authorised(assessment.reviewerId,ADMIN))findings.push(finding('ASSESSMENT_AUTHORITY_CHANGED','The assessment author or independent reviewer is no longer authorised.',assessmentLink,'Review evidence assessment'));
  }
 }else if(task.originKey)findings.push(finding('SOURCE_SCOPE_CHANGED','The task now requires a source-linked assessment that is absent from its review basis.',assessmentLink,'Review evidence assessment'));
 let sourceFresh=false,sourceIntegrity=false;
 if(proof.source){
  sourceFresh=!!source&&Date.now()-source.lastCheckedAt.getTime()<=7*86400000;sourceIntegrity=!!source&&sourceTextHash(source.bodyText)===source.contentHash;
  if(!source||!sourceIntegrity||source.id!==proof.source.id||source.contentHash!==proof.source.contentHash||source.version!==proof.source.version||source.reviewedAt?.toISOString()!==proof.source.reviewedAt||source.reviewerId!==proof.source.reviewerId||source.capturedById!==proof.source.capturedById)findings.push(finding('SOURCE_CHANGED','The source or its reviewed version changed after this proof was recorded.',href(ctx,'/team/sources'),'Review regulatory source'));
  if(!sourceFresh||source?.reviewStatus!=='REVIEWED')findings.push(finding('SOURCE_REVIEW_REQUIRED','The source requires a current independent review.',href(ctx,'/team/sources'),'Review regulatory source'));
  if(source&&(!source.reviewedAt||source.capturedById===source.reviewerId||!authorised(source.capturedById,WRITER)||!authorised(source.reviewerId,ADMIN)))findings.push(finding('SOURCE_AUTHORITY_CHANGED','The source no longer has an independent review supported by authorised members.',href(ctx,'/team/sources'),'Review regulatory source'));
 }
 const control=task.managedControl;
 if(proof.control?(!control||control.id!==proof.control.id||control.version!==proof.control.version||control.title!==proof.control.title||control.enabled!==proof.control.enabled):!!control)findings.push(finding('CONTROL_CHANGED','The control configuration changed. Check its scope, ownership and schedule; a version change does not establish control failure.',href(ctx,'/team/operations'),'Review control configuration'));
 if(task.title!==proof.task.title||task.category!==proof.task.category||task.assigneeId!==proof.task.assigneeId||task.ownerName!==proof.task.ownerName||task.dueDate.toISOString().slice(0,10)!==proof.task.dueDate)findings.push(finding('TASK_CONTEXT_CHANGED','The task title, category, recorded owner or deadline changed after this proof was recorded.',href(ctx,'/team/work',task.id),'Review task context'));
 // A successful source poll alone is not a new finding or new work request. Freshness is still fenced.
 const sourceState=source?{id:source.id,contentHash:source.contentHash,version:source.version,reviewStatus:source.reviewStatus,reviewedAt:source.reviewedAt,capturedById:source.capturedById,reviewerId:source.reviewerId,fresh:sourceFresh,integrity:sourceIntegrity}:null;
 const observationHash=hashValue(wire({task:{id:task.id,title:task.title,category:task.category,assigneeId:task.assigneeId,ownerName:task.ownerName,dueDate:task.dueDate,originKey:task.originKey},files,assessment:assessment?{id:assessment.id,status:assessment.status,version:assessment.version,inputHash:assessment.inputHash,resultHash:assessment.resultHash,reviewerId:assessment.reviewerId,reviewedAt:assessment.reviewedAt,validUntil:assessment.validUntil,current:assessmentCurrent}:null,source:sourceState,control,people,findings}));
 return {findings,observationHash};
}

async function reviewState(tx:Prisma.TransactionClient,ctx:AuthorizedContext,task:CompletionTask,role:string,full=true):Promise<ReviewState>{
 const item:ReviewItem={task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,dueDate:task.dueDate.toISOString().slice(0,10),completedAt:task.completedAt?.toISOString()||null},state:'UNAVAILABLE',findings:[],basis:null,followUp:null,href:href(ctx,'/team/work/reviews',task.id)};
 const empty:ReviewState={task,item,original:null,proof:null,verifications:[],followUps:[],current:null,token:null,verificationToken:null,observationHash:null};
 if(task.changeAction||task.auditRequest||task.accessItem){
  const path=task.changeAction?'/team/changes':task.auditRequest?'/team/audit-requests':'/team/access-reviews';
  item.state='SPECIALIST';item.findings=[finding('SPECIALIST_WORKFLOW','Review and manage this completed work in its linked specialist workflow.',href(ctx,path),'Open linked review workflow')];return empty;
 }
 const original=await savedCompletion(tx,ctx,task);
 if(!original){item.findings=[finding('COMPLETION_RECORD_UNAVAILABLE','A verified completion basis is unavailable. Review the original activity before relying on this outcome.',href(ctx,'/team/work',task.id),'View original task')];return empty;}
 const records=await loadRecords(tx,ctx,task,original);
 if(records.error){item.findings=[finding('REVIEW_RECORD_UNAVAILABLE',records.error,href(ctx,'/team/work',task.id),'View task activity')];return {...empty,original};}
 const verifications=[...records.verifications],followUps=[...records.followUps],latest=verifications.at(-1),proof=latest?.record.proof||originalProof(original);
 item.basis=latest?{eventId:latest.eventId,proofHash:latest.proofHash,checkedAt:latest.record.verifiedAt,kind:'VERIFICATION'}:{eventId:original.eventId,proofHash:original.proofHash,checkedAt:original.receipt.completedAt,kind:'COMPLETION'};
 item.followUp=[...followUps].reverse().find(row=>row.task.status!=='COMPLETE')?.task||followUps.at(-1)?.task||null;
 const state=await changes(tx,ctx,task,proof,{id:latest?.record.verifiedById||original.receipt.completedById,roles:latest?ADMIN:WRITER});item.findings=state.findings;item.state=state.findings.length?'NEEDS_REVIEW':'NO_RECORDED_CHANGES';
 if(!full)return {...empty,original,proof,verifications,followUps,observationHash:state.observationHash};
 const current=await completionContext(tx,ctx,task,role,true);
 const token=hashValue({organizationId:ctx.organizationId,actorId:ctx.userId,role,completionEventId:original.eventId,completionProofHash:original.proofHash,basis:item.basis,taskUpdatedAt:task.updatedAt.toISOString(),observationHash:state.observationHash,
  followUpCycle:followUps.map(row=>({eventId:row.eventId,recordHash:row.recordHash,task:row.task}))});
 const verificationToken=hashValue({kind:VERIFIED,token,current:current.token});
 return {task,item,original,proof,verifications,followUps,current,token,verificationToken,observationHash:state.observationHash};
}
async function readState(tx:Prisma.TransactionClient,ctx:AuthorizedContext,taskId:string,role:string,lock=false,full=true){
 if(!workUuid(taskId))throw new IntelligenceError('Invalid task identifier',400);
 if(lock)await tx.$queryRaw`SELECT id FROM "Obligation" WHERE id=${taskId}::uuid AND "organizationId"=${ctx.organizationId}::uuid FOR SHARE`;
 const task=await completionTaskRecord(tx,ctx,taskId);
 if(task.status!=='COMPLETE')throw new IntelligenceError('This task is no longer complete. Review its current task context.',409);
 return reviewState(tx,ctx,task,role,full);
}
function assertAvailable(state:ReviewState){
 if(!state.original||!state.item.basis||!state.current||!state.token||!state.observationHash||['UNAVAILABLE','SPECIALIST'].includes(state.item.state))throw new IntelligenceError(state.item.findings[0]?.message||'The saved review basis is unavailable.',409);
}

export async function workReviewQueue(ctx:AuthorizedContext,query:WorkReviewQuery):Promise<WorkReviewQueue>{
 return db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),where:Prisma.ObligationWhereInput={organizationId:ctx.organizationId,status:'COMPLETE',...(query.q?{OR:[{title:{contains:query.q,mode:'insensitive'}},{category:{contains:query.q,mode:'insensitive'}},{ownerName:{contains:query.q,mode:'insensitive'}}]}:{})};
  const total=await tx.obligation.count({where}),pages=Math.max(1,Math.ceil(total/WORK_REVIEW_PAGE_SIZE)),page=Math.min(query.page,pages);
  const rows=await tx.obligation.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],skip:(page-1)*WORK_REVIEW_PAGE_SIZE,take:WORK_REVIEW_PAGE_SIZE,select:{id:true}}),items:ReviewItem[]=[];
  for(const row of rows)items.push((await readState(tx,ctx,row.id,actor.role,false,false)).item);
  return {organizationId:ctx.organizationId,actorId:ctx.userId,role:actor.role,items,total,page,pages,pageSize:WORK_REVIEW_PAGE_SIZE,query:{...query,page},scope:WORK_REVIEW_SCOPE};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
export async function workReviewDetail(ctx:AuthorizedContext,taskId:string):Promise<WorkReviewDetail>{
 return db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),state=await readState(tx,ctx,taskId,actor.role),admin=ADMIN.includes(actor.role),usable=!['UNAVAILABLE','SPECIALIST'].includes(state.item.state);
  const members=admin?await tx.membership.findMany({where:{organizationId:ctx.organizationId,role:{in:['OWNER','ADMIN','EDITOR']}},orderBy:{userId:'asc'},take:201,select:{user:{select:{id:true,email:true}}}}):[];
  const eligible=members.filter(row=>allowedEmail(row.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(row=>row.user),blockers=state.current?.blockers||state.item.findings;
  return {organizationId:ctx.organizationId,role:actor.role,item:state.item,original:state.original?{eventId:state.original.eventId,proofHash:state.original.proofHash,completedAt:state.original.receipt.completedAt,receipt:state.original.receipt}:null,
   latestVerification:state.verifications.at(-1)?.record||null,verificationHistory:state.verifications.slice(-25).reverse().map(row=>({eventId:row.eventId,proofHash:row.proofHash,verifiedAt:row.record.verifiedAt,verifiedById:row.record.verifiedById,notes:row.record.notes})),historyLimited:state.verifications.length>25,
   token:admin&&usable?state.token:null,canCreateFollowUp:admin&&state.item.state==='NEEDS_REVIEW',members:eligible.slice(0,200),membersLimited:members.length>200,
   verification:{canVerify:admin&&usable&&blockers.length===0,token:admin&&usable&&blockers.length===0?state.verificationToken:null,evidence:state.current?.evidence.map(file=>({id:file.id,filename:file.filename,sha256:file.sha256,reviewVersion:file.reviewVersion,reviewedAt:file.reviewedAt!.toISOString(),required:!!state.task.originKey}))||[],evidenceLimit:COMPLETION_EVIDENCE_LIMIT,blockers:!admin&&blockers.length===0?[finding('ADMIN_REQUIRED','An administrator must record this fresh verification.')]:blockers},scope:WORK_REVIEW_SCOPE};
 },{isolationLevel:'RepeatableRead',timeout:12000});
}

function followResult(saved:FollowUp,sourceTaskId:string,reused:boolean):WorkReviewFollowUpResult{return {taskId:saved.task.id,sourceTaskId,eventId:saved.eventId,reused};}
export async function createWorkReviewFollowUp(ctx:AuthorizedContext,taskId:string,raw:unknown):Promise<WorkReviewFollowUpPreview|WorkReviewFollowUpResult>{
 if(!workUuid(taskId))throw new IntelligenceError('Invalid task identifier',400);taskId=taskId.toLowerCase();
 const input=parseWorkReviewFollowUp(raw),requestHash=hashValue({organizationId:ctx.organizationId,actorId:ctx.userId,taskId,input});
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN),state=await readState(tx,ctx,taskId,actor.role,true);assertAvailable(state);
  const replay=state.followUps.find(row=>row.requestHash===requestHash&&row.record.createdById===ctx.userId);
  if(input.phase==='apply'&&replay)return followResult(replay,taskId,true);
  if(input.reviewToken!==state.token)throw new IntelligenceError('The review basis or findings changed. Refresh and preview the follow-up again.',409);
  if(state.item.state!=='NEEDS_REVIEW')throw new IntelligenceError('No recorded changes currently require follow-up. Refresh the review.',409);
  let assignee;try{assignee=await requireMember(tx,{...ctx,userId:input.assigneeId},WRITER);}catch(error){if(error instanceof IntelligenceError)throw new IntelligenceError('Choose a current authorised editor or administrator as the owner.',409);throw error;}
  const title=('Review completed work: '+state.task.title).slice(0,160);
  const plan={sourceTaskId:taskId,title,assignee:{id:input.assigneeId,email:assignee.email},dueDate:input.dueDate,reason:input.reason,findings:state.item.findings,existing:state.item.followUp?.status!=='COMPLETE'?state.item.followUp:null};
  const token=hashValue({reviewToken:state.token,...plan,assigneeRole:assignee.role});
  if(input.phase==='preview')return {token,...plan};
  if(input.token!==token)throw new IntelligenceError('The follow-up preview changed. Refresh and preview it again.',409);
  const existing=state.followUps.find(row=>row.task.id===plan.existing?.id);
  if(existing)return followResult(existing,taskId,true);
  const origin=state.original!,basis=state.item.basis!,previousFollowUpTaskId=state.followUps.at(-1)?.task.id||null,keyData={completionEventId:origin.eventId,basisEventId:basis.eventId,observationHash:state.observationHash!,previousFollowUpTaskId},automationKey=followUpKey(keyData);
  const previous=state.followUps.find(row=>row.record.automationKey===automationKey);
  if(previous)return followResult(previous,taskId,true);
  if(await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey}},select:{id:true}}))throw new IntelligenceError('A follow-up with this key lacks a verified link. Review its audit history.',409);
  const createdAt=new Date().toISOString();
  const task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title,category:'Completed work review',ownerName:assignee.email,assigneeId:input.assigneeId,dueDate:new Date(input.dueDate+'T00:00:00.000Z'),automationKey,
   notes:('Review the findings for completed task '+taskId+'. '+input.reason+' Completing this follow-up alone does not restore the original proof; record a fresh verification after resolving its requirements.').slice(0,500)}});
  const record:z.infer<typeof followUpSchema>={format:'regpilot-work-review-follow-up',version:1,organizationId:ctx.organizationId,originalTaskId:taskId,completionEventId:origin.eventId,completionProofHash:origin.proofHash,basisEventId:basis.eventId,basisProofHash:basis.proofHash,observationHash:state.observationHash!,automationKey,previousFollowUpTaskId,taskId:task.id,title,assigneeId:input.assigneeId,ownerName:assignee.email,dueDate:input.dueDate,reason:input.reason,findings:state.item.findings,createdAt,createdById:ctx.userId};
  const recordHash=hashValue(record),event=await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:taskId,action:FOLLOW_UP,details:json({record,recordHash,requestHash})},select:{id:true}});
  return {taskId:task.id,sourceTaskId:taskId,eventId:event.id,reused:false};
 });
}
function verifyResult(row:Verification,reused:boolean):WorkReviewVerifyResult{return {taskId:row.record.originalTaskId,eventId:row.eventId,proofHash:row.proofHash,verifiedAt:row.record.verifiedAt,evidenceCount:row.record.proof.evidence.length,reused,record:row.record};}
function selectedProof(state:ReviewState,token:string,evidenceIds:string[]){
 assertAvailable(state);
 if(token!==state.verificationToken)throw new IntelligenceError('The review basis or current proof changed. Refresh before confirming fresh verification.',409);
 if(state.current!.blockers.length)throw new IntelligenceError(state.current!.blockers[0].message,409);
 return selectedCompletionEvidence(state.current!.evidence,evidenceIds,!!state.task.originKey);
}
export async function verifyWorkReview(ctx:AuthorizedContext,taskId:string,raw:unknown,dependencies:{storage?:EvidenceObjectStore}={}):Promise<WorkReviewVerifyResult>{
 if(!workUuid(taskId))throw new IntelligenceError('Invalid task identifier',400);taskId=taskId.toLowerCase();
 const input=parseWorkVerification(raw),requestHash=hashValue({organizationId:ctx.organizationId,actorId:ctx.userId,taskId,input});
 const pre=await transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN),state=await readState(tx,ctx,taskId,actor.role,true);assertAvailable(state);
  const replay=state.verifications.find(row=>row.requestHash===requestHash&&row.record.verifiedById===ctx.userId);
  if(replay)return {replay};
  return {files:selectedProof(state,input.token,input.evidenceIds)};
 });
 if(pre.replay)return verifyResult(pre.replay,true);
 await verifyCompletionFiles(ctx,pre.files,dependencies.storage);
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN),state=await readState(tx,ctx,taskId,actor.role,true);assertAvailable(state);
  const replay=state.verifications.find(row=>row.requestHash===requestHash&&row.record.verifiedById===ctx.userId);
  if(replay)return verifyResult(replay,true);
  const files=selectedProof(state,input.token,input.evidenceIds),basis=state.item.basis!,original=state.original!;
  const record:WorkVerificationRecord={format:'regpilot-work-verification',version:1,organizationId:ctx.organizationId,originalTaskId:taskId,completionEventId:original.eventId,completionProofHash:original.proofHash,previousBasisEventId:basis.eventId,previousBasisProofHash:basis.proofHash,verifiedAt:new Date().toISOString(),verifiedById:ctx.userId,notes:input.notes,proof:currentProof(state.current!,files),scope:WORK_REVIEW_SCOPE};
  const proofHash=hashValue(record),event=await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:taskId,action:VERIFIED,details:json({record,proofHash,requestHash})},select:{id:true}});
  return verifyResult({eventId:event.id,proofHash,requestHash,record},false);
 });
}
