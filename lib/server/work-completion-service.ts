import {Prisma,type AssuranceAssessment} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {completionAssessment} from './assurance-service';
import {downloadEvidence} from './evidence-service';
import type {EvidenceObjectStore} from './evidence-storage';
import {allowedEmail} from '../ai/security.mjs';
import {hashValue} from '../regulatory/intelligence';
import type {EvidenceManifest} from '../evidence/assurance';
import {MAX_ORG_EVIDENCE_FILES} from '../evidence/file-guard.mjs';
import {workUuid} from '../work-hub.mjs';
import {COMPLETION_EVIDENCE_LIMIT,COMPLETION_SCOPE,parseWorkCompletion,selectedCompletionEvidence,type WorkCompletionInput} from '../work-completion.mjs';

const ACTION='work.completed';
const taskSelect={id:true,title:true,category:true,ownerName:true,assigneeId:true,dueDate:true,status:true,updatedAt:true,originKey:true,notes:true,completedAt:true,
 completionException:true,completionRationale:true,controlId:true,connectorId:true,sourceUrl:true,sourceCheckedAt:true,
 managedControl:{select:{id:true,title:true,version:true,enabled:true,updatedAt:true}},
 changeAction:{select:{id:true,responseId:true}},auditRequest:{select:{id:true}},accessItem:{select:{id:true}}
} satisfies Prisma.ObligationSelect;
const evidenceSelect={id:true,obligationId:true,filename:true,storageKey:true,contentType:true,sizeBytes:true,sha256:true,scanStatus:true,scannedAt:true,reviewVersion:true,reviewStatus:true,reviewedAt:true,reviewerId:true,uploadedById:true} satisfies Prisma.EvidenceSelect;
const sourceSelect={id:true,sourceId:true,title:true,url:true,contentHash:true,version:true,lastCheckedAt:true,reviewedAt:true,reviewStatus:true,reviewerId:true,capturedById:true} satisfies Prisma.RegulatorySnapshotSelect;
export type CompletionTask=Prisma.ObligationGetPayload<{select:typeof taskSelect}>;
type Task=CompletionTask;
export type CompletionEvidence=Prisma.EvidenceGetPayload<{select:typeof evidenceSelect}>;
type EvidenceRow=CompletionEvidence;
type SourceRow=Prisma.RegulatorySnapshotGetPayload<{select:typeof sourceSelect}>;
type Blocker={code:string;message:string;href:string;label:string};
type Participant={id:string;role:string;approved:boolean};

const id=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),iso=z.string().datetime();
// A strict projection also prevents unexpected audit JSON fields entering a reader/export response.
export const completionReceiptSchema=z.object({
 format:z.literal('regpilot-work-completion'),version:z.literal(1),organizationId:id,
 task:z.object({id,title:z.string(),category:z.string(),ownerName:z.string(),assigneeId:id.nullable(),dueDate:z.string(),statusBefore:z.enum(['OPEN','IN_PROGRESS']),updatedAtBefore:iso}),
 completedAt:iso,completedById:id,notes:z.string().min(20).max(500),
 source:z.object({id,sourceId:z.string(),title:z.string(),url:z.string(),contentHash:sha,version:z.number().int().positive(),lastCheckedAt:iso,reviewedAt:iso.nullable(),reviewerId:id,capturedById:id}).nullable(),
 control:z.object({id,title:z.string(),version:z.number().int().positive(),enabled:z.boolean()}).nullable(),
 assessment:z.object({id,version:z.number().int().positive(),inputHash:sha,resultHash:sha,reviewedAt:iso,reviewerId:id,validUntil:iso}).nullable(),
 evidence:z.array(z.object({id,filename:z.string(),sha256:sha,reviewVersion:z.number().int().positive(),reviewedAt:iso,reviewerId:id,uploadedById:id})).min(1).max(COMPLETION_EVIDENCE_LIMIT),
 scope:z.string()
});
export type CompletionReceipt=z.infer<typeof completionReceiptSchema>;
export type CompletionResult={taskId:string;status:'COMPLETE';completedAt:string;eventId:string;proofHash:string;evidenceCount:number;reused:boolean};
export type CompletionReadiness={
 organizationId:string;
 task:{id:string;title:string;status:string;updatedAt:string};
 canComplete:boolean;ready:boolean;token:string|null;blockers:Blocker[];
 evidence:{id:string;filename:string;sha256:string;reviewVersion:number;reviewedAt:string;required:boolean}[];
 evidenceLimit:number;assessment:{id:string;reviewedAt:string;validUntil:string}|null;
 completed:{eventId:string;completedAt:string;proofHash:string;evidenceCount:number}|null;
 receipt:CompletionReceipt|null;scope:string;
};
export type CompletionContext={task:Task;actorRole:string;blockers:Blocker[];evidence:EvidenceRow[];assessment:AssuranceAssessment|null;source:SourceRow|null;participants:Participant[];token:string};
type Context=CompletionContext;
export type SavedCompletion={eventId:string;requestHash:string;actorId:string;receipt:CompletionReceipt;proofHash:string};
type Saved=SavedCompletion;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const link=(ctx:AuthorizedContext,path:string,taskId?:string)=>path+'?organizationId='+encodeURIComponent(ctx.organizationId)+(taskId?'&taskId='+encodeURIComponent(taskId):'');

export async function completionTaskRecord(tx:Prisma.TransactionClient,ctx:AuthorizedContext,taskId:string) {
 const task=await tx.obligation.findFirst({where:{id:taskId,organizationId:ctx.organizationId},select:taskSelect});
 if(!task)throw new IntelligenceError('Task not found',404);
 return task;
}
/** Locks both membership and pilot identity so a revocation cannot slip between the final check and commit. */
export async function completionParticipants(tx:Prisma.TransactionClient,ctx:AuthorizedContext,ids:(string|null)[]) {
 const unique=[...new Set(ids.filter((value):value is string=>!!value))].sort();
 if(!unique.length)return [];
 const rows=await tx.$queryRaw<Array<{id:string;role:string;email:string}>>(Prisma.sql`
  SELECT m."userId"::text AS id,m.role::text AS role,u.email
  FROM "Membership" m JOIN "User" u ON u.id=m."userId"
  WHERE m."organizationId"=${ctx.organizationId}::uuid AND m."userId" IN (${Prisma.join(unique.map(value=>Prisma.sql`${value}::uuid`))})
  ORDER BY m."userId" FOR SHARE OF m,u`);
 return unique.map(userId=>{const row=rows.find(value=>value.id===userId);return {id:userId,role:row?.role||'REMOVED',approved:!!row&&allowedEmail(row.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)};});
}
function participantAllowed(rows:Participant[],userId:string|null,roles:readonly string[]) {
 return !!userId&&rows.some(row=>row.id===userId&&row.approved&&roles.includes(row.role));
}
function independentFile(file:EvidenceRow,people:Participant[]) {
 return file.scanStatus==='CLEAN'&&file.reviewStatus==='APPROVED'&&!!file.reviewedAt&&file.uploadedById!==file.reviewerId&&/^[a-f0-9]{64}$/.test(file.sha256)
  &&participantAllowed(people,file.uploadedById,WRITER)&&participantAllowed(people,file.reviewerId,ADMIN);
}
function sourceForReceipt(source:SourceRow|null):CompletionReceipt['source'] {
 return source?{id:source.id,sourceId:source.sourceId,title:source.title,url:source.url,contentHash:source.contentHash,version:source.version,lastCheckedAt:source.lastCheckedAt.toISOString(),reviewedAt:source.reviewedAt?.toISOString()||null,reviewerId:source.reviewerId!,capturedById:source.capturedById}:null;
}
function assessmentForReceipt(assessment:AssuranceAssessment|null):CompletionReceipt['assessment'] {
 return assessment?{id:assessment.id,version:assessment.version,inputHash:assessment.inputHash,resultHash:assessment.resultHash!,reviewedAt:assessment.reviewedAt!.toISOString(),reviewerId:assessment.reviewerId!,validUntil:assessment.validUntil!.toISOString()}:null;
}

/** Shared safe proof projection. Currentness/independence must be checked by completionContext first. */
export function completionProofSnapshot(current:CompletionContext,files:CompletionEvidence[]) {
 const control=current.task.managedControl;
 return {source:sourceForReceipt(current.source),control:control?{id:control.id,title:control.title,version:control.version,enabled:control.enabled}:null,
  assessment:assessmentForReceipt(current.assessment),evidence:files.map(file=>({id:file.id,filename:file.filename,sha256:file.sha256,reviewVersion:file.reviewVersion,reviewedAt:file.reviewedAt!.toISOString(),reviewerId:file.reviewerId!,uploadedById:file.uploadedById!}))};
}
export async function verifyCompletionFiles(ctx:AuthorizedContext,files:CompletionEvidence[],storage?:EvidenceObjectStore) {
 for(const file of files){
  const downloaded=await downloadEvidence(ctx,file.id,storage);
  if(downloaded.sha256!==file.sha256||downloaded.bytes.byteLength!==file.sizeBytes)throw new IntelligenceError('Supporting evidence changed during verification. Refresh the completion check.',409);
 }
}

export async function completionContext(tx:Prisma.TransactionClient,ctx:AuthorizedContext,task:Task,actorRole:string,reviewCompleted=false):Promise<Context> {
 const blockers:Blocker[]=[],evidenceHref=link(ctx,'/team/evidence',task.id),assessmentHref=link(ctx,'/team/assurance',task.id);
 const block=(code:string,message:string,href:string,label:string)=>blockers.push({code,message,href,label});
 if(!WRITER.includes(actorRole))block('ROLE_REQUIRED','An editor or administrator must confirm the completed outcome.',link(ctx,'/team/work',task.id),'Back to task');
 if(task.status==='COMPLETE'&&!reviewCompleted)block('ALREADY_COMPLETE','This task is already complete. Its saved receipt records the basis at that time.',link(ctx,'/team/work',task.id),'View completed task');
 if(task.changeAction){
  const canView=ADMIN.includes(actorRole)||task.assigneeId===ctx.userId;
  block('SPECIALIST_WORKFLOW','Complete and review this action in its change response so its independent decision is preserved.',link(ctx,'/team/changes')+(canView?'&responseId='+encodeURIComponent(task.changeAction.responseId):''),'Open change response');
 }
 if(task.auditRequest)block('SPECIALIST_WORKFLOW','Submit and independently review this request in the audit request workflow.',link(ctx,'/team/audit-requests'),'Open audit requests');
 if(task.accessItem)block('SPECIALIST_WORKFLOW','Complete the access decision, remediation and verification in the access review workflow.',link(ctx,'/team/access-reviews'),'Open access reviews');

 let assessment:AssuranceAssessment|null=null,source:SourceRow|null=null,files:EvidenceRow[]=[];
 // The existing assessment guard is the authority: this includes source freshness, business context,
 // exact evidence manifests and superseding adverse decisions. Do not replace it with attachment counts.
 if(task.originKey){
  try{assessment=await completionAssessment(tx,ctx.organizationId,task.id);}
  catch{block('ASSESSMENT_REQUIRED','This source-linked task needs a current, independently accepted evidence assessment. Review any changed source, expired approval or unresolved finding.',assessmentHref,'Review evidence assessment');}
  if(assessment){
   const manifest=assessment.evidenceManifest as unknown as EvidenceManifest[];
   if(!Array.isArray(manifest)||!manifest.length||manifest.length>COMPLETION_EVIDENCE_LIMIT||manifest.some(file=>!workUuid(file.id))||new Set(manifest.map(file=>file.id)).size!==manifest.length){
    block('ASSESSMENT_REQUIRED','The accepted assessment has no valid completion evidence manifest. Prepare a fresh assessment.',assessmentHref,'Review evidence assessment');
   }else{
    files=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,id:{in:manifest.map(file=>file.id)}},orderBy:{id:'asc'},select:evidenceSelect});
    if(files.length!==manifest.length)block('EVIDENCE_CHANGED','Files from the accepted assessment are no longer available. Reassess the task.',assessmentHref,'Review evidence assessment');
   }
   source=await tx.regulatorySnapshot.findFirst({where:{id:assessment.snapshotId,organizationId:ctx.organizationId},select:sourceSelect});
   if(!source)block('SOURCE_UNAVAILABLE','The reviewed source is unavailable. Review this task in evidence assurance.',assessmentHref,'Review evidence assessment');
  }
 }else{
  files=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId:task.id},orderBy:{id:'asc'},take:MAX_ORG_EVIDENCE_FILES+1,select:evidenceSelect});
  if(files.length>MAX_ORG_EVIDENCE_FILES)block('EVIDENCE_LIMIT','This task exceeds the evidence review limit. Ask an administrator to reconcile its evidence records.',evidenceHref,'Review task evidence');
 }
 const people=await completionParticipants(tx,ctx,[...files.flatMap(file=>[file.uploadedById,file.reviewerId]),assessment?.createdById||null,assessment?.reviewerId||null,source?.reviewerId||null,source?.capturedById||null]);
 const eligible=files.filter(file=>independentFile(file,people));
 if(task.originKey&&assessment){
  if(eligible.length!==files.length||!files.length)block('EVIDENCE_REVIEW_REQUIRED','Every assessment file must remain clean, independently approved and supported by current authorised uploader and reviewer memberships.',evidenceHref,'Review task evidence');
  if(!participantAllowed(people,assessment.createdById,WRITER)||!participantAllowed(people,assessment.reviewerId,ADMIN))block('ASSESSMENT_REVIEWER_CHANGED','The assessment author or independent reviewer is no longer authorised. Obtain a current independent assessment.',assessmentHref,'Review evidence assessment');
  if(source&&(!source.reviewedAt||source.reviewerId===source.capturedById||!participantAllowed(people,source.capturedById,WRITER)||!participantAllowed(people,source.reviewerId,ADMIN)))block('SOURCE_REVIEWER_CHANGED','The source needs an independent review by currently authorised members.',link(ctx,'/team/sources'),'Review regulatory source');
 }else if(!task.originKey&&!eligible.length){
  const pending=files.some(file=>file.scanStatus==='CLEAN'&&file.reviewStatus==='PENDING_REVIEW');
  const reviewed=files.some(file=>file.reviewStatus==='APPROVED');
  block(pending?'EVIDENCE_REVIEW_REQUIRED':reviewed?'EVIDENCE_REVIEWER_CHANGED':'EVIDENCE_REQUIRED',pending?'Supporting files are awaiting independent administrator review. Completion does not approve those files.':reviewed?'Approved evidence needs a clean scan and distinct, currently authorised uploader and administrator reviewer. Request a fresh review or upload.':'Add supporting evidence and have a different administrator review it before completing this task.',evidenceHref,pending?'Review pending evidence':'Open task evidence');
  if(ADMIN.includes(actorRole)&&!reviewCompleted)block('EXCEPTION_WORKFLOW','If supporting evidence cannot be provided, use the separate documented exception workflow and record its rationale.',link(ctx,'/team',task.id),'Open documented exception workflow');
 }
 const token=hashValue(wire({version:1,organizationId:ctx.organizationId,actorId:ctx.userId,actorRole,task,files,assessment:assessment?{...assessment,result:undefined}:null,source,participants:people}));
 return {task,actorRole,blockers,evidence:eligible,assessment,source,participants:people,token};
}

/** Only a receipt for this exact current completion can be shown or replayed after a reopen. */
export async function savedCompletion(tx:Prisma.TransactionClient,ctx:AuthorizedContext,task:Task):Promise<Saved|null> {
 if(task.status!=='COMPLETE'||!task.completedAt)return null;
 const event=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType:'Obligation',entityId:task.id,action:ACTION},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,actorId:true,action:true,details:true}});
 const saved=event?verifiedCompletionEvent(ctx,task.id,event):null;
 return saved?.receipt.completedAt===task.completedAt.toISOString()?saved:null;
}
/** Strict receipt verification also supports immutable references to an earlier completion generation. */
export function verifiedCompletionEvent(ctx:AuthorizedContext,taskId:string,event:{id:string;actorId:string;action:string;details:Prisma.JsonValue}):Saved|null {
 if(event.action!==ACTION||!event.details||typeof event.details!=='object'||Array.isArray(event.details))return null;
 const details=event.details as Record<string,Prisma.JsonValue>,parsed=completionReceiptSchema.safeParse(details.receipt);
 if(!parsed.success||typeof details.proofHash!=='string'||typeof details.requestHash!=='string'||hashValue(parsed.data)!==details.proofHash)return null;
 const receipt=parsed.data;
 if(receipt.organizationId!==ctx.organizationId||receipt.task.id!==taskId||receipt.completedById!==event.actorId)return null;
 return {eventId:event.id,requestHash:details.requestHash,actorId:event.actorId,receipt,proofHash:details.proofHash};
}
function result(saved:Saved,reused:boolean):CompletionResult {
 return {taskId:saved.receipt.task.id,status:'COMPLETE',completedAt:saved.receipt.completedAt,eventId:saved.eventId,proofHash:saved.proofHash,evidenceCount:saved.receipt.evidence.length,reused};
}
function assertReady(current:Context,input:WorkCompletionInput) {
 if(current.token!==input.token)throw new IntelligenceError('The task or supporting proof changed. Refresh the completion check and review it again.',409);
 if(current.blockers.length)throw new IntelligenceError(current.blockers[0].message,409);
 return selectedCompletionEvidence(current.evidence,input.evidenceIds,!!current.task.originKey);
}

/** Read-only metadata: no storage fetch, model call, audit write, implicit approval or task mutation. */
export async function workCompletion(ctx:AuthorizedContext,taskId:string):Promise<CompletionReadiness> {
 if(!workUuid(taskId))throw new IntelligenceError('Invalid task identifier',400);
 return db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),task=await completionTaskRecord(tx,ctx,taskId);
  const saved=await savedCompletion(tx,ctx,task);
  const base={organizationId:ctx.organizationId,task:{id:task.id,title:task.title,status:task.status,updatedAt:task.updatedAt.toISOString()},evidenceLimit:COMPLETION_EVIDENCE_LIMIT,scope:COMPLETION_SCOPE};
  if(task.status==='COMPLETE')return {...base,canComplete:false,ready:false,token:null,blockers:saved?[]:[{code:'COMPLETION_RECORD_UNAVAILABLE',message:'This task is marked complete, but a verified evidence completion record is unavailable. Review its activity before relying on the recorded outcome.',href:'',label:''}],evidence:[],assessment:null,completed:saved?{eventId:saved.eventId,completedAt:saved.receipt.completedAt,proofHash:saved.proofHash,evidenceCount:saved.receipt.evidence.length}:null,receipt:saved?.receipt||null};
  const current=await completionContext(tx,ctx,task,actor.role),ready=current.blockers.length===0;
  return {...base,canComplete:WRITER.includes(actor.role)&&!task.changeAction&&!task.auditRequest&&!task.accessItem,ready,token:ready?current.token:null,blockers:current.blockers,
   evidence:current.evidence.map(file=>({id:file.id,filename:file.filename,sha256:file.sha256,reviewVersion:file.reviewVersion,reviewedAt:file.reviewedAt!.toISOString(),required:!!task.originKey})),
   assessment:current.assessment?{id:current.assessment.id,reviewedAt:current.assessment.reviewedAt!.toISOString(),validUntil:current.assessment.validUntil!.toISOString()}:null,completed:null,receipt:null};
 },{isolationLevel:'RepeatableRead',timeout:12000});
}

/** Verify real stored bytes outside the short transaction, then revalidate every bound record atomically. */
export async function completeWork(ctx:AuthorizedContext,taskId:string,raw:unknown,dependencies:{storage?:EvidenceObjectStore}={}):Promise<CompletionResult> {
 if(!workUuid(taskId))throw new IntelligenceError('Invalid task identifier',400);
 const input=parseWorkCompletion(raw),requestHash=hashValue({organizationId:ctx.organizationId,actorId:ctx.userId,taskId,input});
 const preflight=await transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,WRITER),task=await completionTaskRecord(tx,ctx,taskId);
  if(task.status==='COMPLETE'){
   const saved=await savedCompletion(tx,ctx,task);
   if(saved&&saved.requestHash===requestHash&&saved.actorId===ctx.userId)return {saved};
   throw new IntelligenceError('This task has already been completed. Refresh to review its saved outcome.',409);
  }
  const current=await completionContext(tx,ctx,task,actor.role),files=assertReady(current,input);
  return {current,files};
 });
 if(preflight.saved)return result(preflight.saved,true);
 await verifyCompletionFiles(ctx,preflight.files,dependencies.storage);
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,WRITER),task=await completionTaskRecord(tx,ctx,taskId);
  if(task.status==='COMPLETE'){
   const saved=await savedCompletion(tx,ctx,task);
   if(saved&&saved.requestHash===requestHash&&saved.actorId===ctx.userId)return result(saved,true);
   throw new IntelligenceError('This task has already been completed. Refresh to review its saved outcome.',409);
  }
  const current=await completionContext(tx,ctx,task,actor.role),files=assertReady(current,input);
  const completedAt=new Date();
  const receipt:CompletionReceipt={format:'regpilot-work-completion',version:1,organizationId:ctx.organizationId,
   task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate.toISOString().slice(0,10),statusBefore:task.status as 'OPEN'|'IN_PROGRESS',updatedAtBefore:task.updatedAt.toISOString()},
   completedAt:completedAt.toISOString(),completedById:ctx.userId,notes:input.notes,...completionProofSnapshot(current,files),scope:COMPLETION_SCOPE};
  const proofHash=hashValue(receipt);
  const changed=await tx.obligation.updateMany({where:{id:task.id,organizationId:ctx.organizationId,updatedAt:task.updatedAt,status:task.status},data:{status:'COMPLETE',completedAt,completionException:false,completionRationale:''}});
  if(changed.count!==1)throw new IntelligenceError('The task changed during completion. No completion was saved. Refresh and review it again.',409);
  const event=await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:ACTION,entityType:'Obligation',entityId:task.id,details:{requestHash,proofHash,receipt} as Prisma.InputJsonValue},select:{id:true}});
  return result({eventId:event.id,requestHash,actorId:ctx.userId,receipt,proofHash},false);
 });
}
