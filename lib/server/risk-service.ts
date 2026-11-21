import {Prisma,type RiskRecord,type RiskReview} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {IntelligenceError,transaction} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {allowedEmail} from '../ai/security.mjs';
import {hashValue} from '../regulatory/intelligence';
import {reviewedFiles,reviewedFilesSchema,verifyReviewedBytes,futureDate,type ReviewedFile} from './reviewed-files';
import type {EvidenceObjectStore} from './evidence-storage';
import {completionTaskRecord,completionContext,savedCompletion,completionProofSnapshot,completionParticipants} from './work-completion-service';
import {createRiskSchema,updateRiskSchema,treatmentSchema,riskReviewSchema,riskDecisionSchema,riskArchiveSchema,riskQuerySchema,riskRating,RISK_LIMIT,RISK_PAGE_SIZE,RISK_SCOPE,type RiskQuery} from '../risk-register';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const href=(path:string,org:string,values:Record<string,string>={})=>path+'?'+new URLSearchParams({organizationId:org,...values});
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw new IntelligenceError('Check the required risk fields, dates and selected records');return result.data;}
function identifier(value:string){if(!z.uuid().safeParse(value).success)throw new IntelligenceError('Invalid risk record identifier');}
async function record(tx:Tx,ctx:AuthorizedContext,id:string){identifier(id);const row=await tx.riskRecord.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError('Risk not found in this organisation',404);return row;}
async function editor(tx:Tx,ctx:AuthorizedContext,row:RiskRecord){const person=await requireMember(tx,ctx,WRITER);if(!ADMIN.includes(person.role)&&row.ownerId!==ctx.userId&&row.createdById!==ctx.userId)throw new IntelligenceError('The risk owner or an administrator must make this change',403);return person;}
async function owner(tx:Tx,ctx:AuthorizedContext,id:string){const rows=await completionParticipants(tx,ctx,[id]);const person=rows.find(row=>row.id===id&&row.approved&&WRITER.includes(row.role));if(!person)throw new IntelligenceError('Choose a current member who can own this work',409);const user=await tx.user.findUniqueOrThrow({where:{id},select:{email:true}});return user.email;}
function unchanged(row:RiskRecord,version:number){if(row.version!==version)throw new IntelligenceError('This risk changed. Refresh its saved state before continuing.',409);if(row.status==='ARCHIVED')throw new IntelligenceError('Reopen this risk before changing its treatment or review',409);}
async function controlsFor(tx:Tx,org:string,ids:string[]){const rows=await tx.managedControl.findMany({where:{organizationId:org,id:{in:ids}},orderBy:{id:'asc'},select:{id:true,title:true,version:true,enabled:true,ownerId:true,nextReviewAt:true}});if(rows.length!==ids.length||rows.some(row=>!row.enabled))throw new IntelligenceError('Choose active controls from this organisation',409);return rows;}
async function event(tx:Tx,ctx:AuthorizedContext,action:string,entityId:string,details:unknown){await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action,entityType:'RiskRecord',entityId,details:json(details)}});}
function result(row:RiskRecord,reused=false){return {id:row.id,riskId:row.id,version:row.version,status:row.status,reused};}
function riskValues(row:RiskRecord){return {id:row.id,createdById:row.createdById,title:row.title,description:row.description,category:row.category,ownerId:row.ownerId,likelihood:row.likelihood,impact:row.impact,ratingRationale:row.ratingRationale,strategy:row.strategy};}

export async function createRisk(ctx:AuthorizedContext,input:unknown){
 const data=parse(createRiskSchema,input),reviewDueAt=futureDate(data.reviewDueAt),requestHash=hashValue({actor:ctx.userId,data});
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const existing=await tx.riskRecord.findUnique({where:{organizationId_createKey:{organizationId:ctx.organizationId,createKey:data.requestKey}}});
  if(existing){const saved=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityId:existing.id,action:'risk.created',actorId:ctx.userId},select:{details:true}});if((saved?.details as {requestHash?:string}|null)?.requestHash!==requestHash)throw new IntelligenceError('This creation request was already used for different risk details',409);return result(existing,true);}
  if(await tx.riskRecord.count({where:{organizationId:ctx.organizationId}})>=RISK_LIMIT)throw new IntelligenceError('This workspace has reached its 200-risk pilot limit',409);
  await owner(tx,ctx,data.ownerId);await controlsFor(tx,ctx.organizationId,data.controlIds);
  const {requestKey,controlIds,...fields}=data;
  const row=await tx.riskRecord.create({data:{...fields,reviewDueAt,createKey:requestKey,organizationId:ctx.organizationId,createdById:ctx.userId}});
  if(controlIds.length)await tx.riskControl.createMany({data:controlIds.map(controlId=>({organizationId:ctx.organizationId,riskId:row.id,controlId}))});
  await event(tx,ctx,'risk.created',row.id,{requestHash,fields,controlIds,scope:RISK_SCOPE});return result(row);
 });
}
export async function updateRisk(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(updateRiskSchema,input),reviewDueAt=futureDate(data.reviewDueAt);
 return transaction(ctx,async tx=>{
  const row=await record(tx,ctx,id);await editor(tx,ctx,row);unchanged(row,data.version);await owner(tx,ctx,data.ownerId);await controlsFor(tx,ctx.organizationId,data.controlIds);
  const {version,controlIds,...fields}=data;
  await tx.riskControl.deleteMany({where:{organizationId:ctx.organizationId,riskId:id}});
  if(controlIds.length)await tx.riskControl.createMany({data:controlIds.map(controlId=>({organizationId:ctx.organizationId,riskId:id,controlId}))});
  await tx.riskReview.updateMany({where:{organizationId:ctx.organizationId,riskId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
  const saved=await tx.riskRecord.update({where:{id},data:{...fields,reviewDueAt,status:'OPEN',version:{increment:1}}});
  await event(tx,ctx,'risk.updated',id,{previous:riskValues(row),current:riskValues(saved),controlIds,version:saved.version});return result(saved);
 });
}
export async function addRiskTreatment(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(treatmentSchema,input),requestHash=hashValue({actor:ctx.userId,riskId:id,...data,version:undefined});
 const date=data.dueDate?futureDate(data.dueDate):null;
 return transaction(ctx,async tx=>{
  const row=await record(tx,ctx,id);await editor(tx,ctx,row);
  const prior=await tx.riskTreatment.findUnique({where:{riskId_requestKey:{riskId:id,requestKey:data.requestKey}}});
  if(prior){const saved=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityId:id,action:'risk.treatment_added',details:{path:['treatmentId'],equals:prior.id}},select:{details:true}});if((saved?.details as {requestHash?:string}|null)?.requestHash!==requestHash)throw new IntelligenceError('This treatment request was already used for different work',409);return {id:prior.id,riskId:id,taskId:prior.obligationId,version:row.version,reused:true};}
  unchanged(row,data.version);
  if(await tx.riskTreatment.count({where:{organizationId:ctx.organizationId,riskId:id}})>=10)throw new IntelligenceError('Keep this risk to at most ten treatment actions',409);
  let task;
  if(data.taskId){task=await completionTaskRecord(tx,ctx,data.taskId);if(task.changeAction||task.auditRequest||task.accessItem)throw new IntelligenceError('Choose an ordinary task with the standard evidence completion workflow',409);if(task.completionException)throw new IntelligenceError('A documented exception cannot serve as completed risk treatment',409);if(!task.assigneeId)throw new IntelligenceError('Assign a current task owner before linking this treatment',409);await owner(tx,ctx,task.assigneeId);}
  else{const ownerName=await owner(tx,ctx,data.ownerId!);task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:data.title!,category:'Risk treatment',ownerName,assigneeId:data.ownerId!,dueDate:date!,notes:data.purpose,automationKey:hashValue({kind:'risk-treatment',riskId:id,requestKey:data.requestKey})}});}
  if(await tx.riskTreatment.findUnique({where:{riskId_obligationId:{riskId:id,obligationId:task.id}}}))throw new IntelligenceError('This task is already linked to the risk',409);
  const treatment=await tx.riskTreatment.create({data:{organizationId:ctx.organizationId,riskId:id,obligationId:task.id,requestKey:data.requestKey,purpose:data.purpose}});
  await tx.riskReview.updateMany({where:{organizationId:ctx.organizationId,riskId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
  const saved=await tx.riskRecord.update({where:{id},data:{status:'OPEN',version:{increment:1}}});
  await event(tx,ctx,'risk.treatment_added',id,{treatmentId:treatment.id,taskId:task.id,purpose:data.purpose,requestHash,version:saved.version});
  return {id:treatment.id,riskId:id,taskId:task.id,version:saved.version,reused:false};
 });
}

// Routine polling of an unchanged source is not a new treatment outcome.
function stableProof(proof:{source:unknown;control:unknown;assessment:unknown;evidence:unknown}){
 const source=proof.source as Record<string,unknown>|null;
 return wire({source:source?{...source,lastCheckedAt:undefined}:null,control:proof.control,assessment:proof.assessment,evidence:proof.evidence});
}
function sameProposal(review:RiskReview,actorId:string,data:z.infer<typeof riskReviewSchema>){
 const files=reviewedFilesSchema.safeParse(review.evidenceManifest);
 if(review.authorId!==actorId||review.residualLikelihood!==data.residualLikelihood||review.residualImpact!==data.residualImpact||review.rationale!==data.rationale||review.validUntil.toISOString().slice(0,10)!==data.validUntil||!files.success||hashValue(files.data.map(file=>file.id).sort())!==hashValue([...data.evidenceIds].sort())||proposalHash(review)!==review.proposalHash||hashValue(review.context)!==review.contextHash)throw new IntelligenceError('This review request was already used for different details or its saved record is unavailable',409);
}

async function basis(tx:Tx,ctx:AuthorizedContext,row:RiskRecord,evidenceIds:string[]){
 const blockers:string[]=[],links=await tx.riskControl.findMany({where:{organizationId:ctx.organizationId,riskId:row.id},orderBy:{controlId:'asc'},include:{control:{select:{id:true,title:true,version:true,enabled:true,ownerId:true,nextReviewAt:true}}}});
 const controls=links.map(link=>link.control),treatments=await tx.riskTreatment.findMany({where:{organizationId:ctx.organizationId,riskId:row.id},orderBy:{id:'asc'}});
 if(controls.length>10||treatments.length>10)throw new IntelligenceError('Risk context exceeds the reviewed pilot limits',409);
 const participants=await completionParticipants(tx,ctx,[row.ownerId,...controls.map(control=>control.ownerId)]);
 const eligible=(id:string,roles=WRITER)=>participants.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
 if(!eligible(row.ownerId))blockers.push('The risk needs a current owner who can work on tasks.');
 for(const control of controls){if(!control.enabled||!eligible(control.ownerId))blockers.push('Linked control “'+control.title+'” needs an active control and eligible owner.');if(control.nextReviewAt.toISOString().slice(0,10)<new Date().toISOString().slice(0,10))blockers.push('Linked control “'+control.title+'” is due for review.');}
 if(row.strategy!=='ACCEPT'&&!treatments.length)blockers.push('Record at least one treatment action for this strategy before assessing the remaining risk.');
 const tasks=[],verification=new Map<string,ReviewedFile>();
 for(const treatment of treatments){
  const task=await completionTaskRecord(tx,ctx,treatment.obligationId),saved=await savedCompletion(tx,ctx,task);
  const current=await completionContext(tx,ctx,task,'EDITOR',true);
  let reason=task.status!=='COMPLETE'?'Complete this treatment task with reviewed evidence.':task.completionException?'A documented exception is not verified treatment completion.':!saved?'This task has no verified completion receipt.':current.blockers[0]?.message||'';
  const files=saved?current.evidence.filter(file=>saved.receipt.evidence.some(proof=>proof.id===file.id&&proof.sha256===file.sha256&&proof.reviewVersion===file.reviewVersion)):[];
  if(saved&&!reason&&files.length!==saved.receipt.evidence.length)reason='The treatment evidence no longer matches its completion receipt.';
  const proof=saved&&!reason?completionProofSnapshot(current,files):null;
  if(saved&&proof&&!reason){
   const recorded=saved.receipt;
   const currentTask={id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate.toISOString().slice(0,10)};
   const recordedTask={id:recorded.task.id,title:recorded.task.title,category:recorded.task.category,ownerName:recorded.task.ownerName,assigneeId:recorded.task.assigneeId,dueDate:recorded.task.dueDate};
   if(hashValue(currentTask)!==hashValue(recordedTask)||hashValue(stableProof(proof))!==hashValue(stableProof(recorded)))reason='The treatment task or its reviewed basis changed after completion. Reopen and complete the task against the current evidence.';
  }
  if(!task.assigneeId||!(await completionParticipants(tx,ctx,[task.assigneeId])).some(p=>p.id===task.assigneeId&&p.approved&&WRITER.includes(p.role)))reason='The treatment task needs a current eligible owner.';
  if(reason)blockers.push(task.title+': '+reason);
  if(!reason&&saved){for(const file of await reviewedFiles(tx,ctx.organizationId,files.map(file=>file.id)))verification.set(file.id,file);}
  tasks.push({id:treatment.id,requestKey:treatment.requestKey,purpose:treatment.purpose,task:{id:task.id,title:task.title,status:task.status,ownerName:task.ownerName,assigneeId:task.assigneeId,updatedAt:task.updatedAt,href:href('/team/work',ctx.organizationId,{taskId:task.id})},completion:{recorded:!!saved,current:!reason,reason:reason||'The saved completion receipt and current supporting metadata match.',eventId:saved?.eventId||null,proofHash:saved?.proofHash||null},proof:proof&&!reason?{...stableProof(proof),participants:current.participants}:null});
 }
 let files:ReviewedFile[]=[];
 try{files=await reviewedFiles(tx,ctx.organizationId,evidenceIds);}catch(error){blockers.push(error instanceof IntelligenceError?error.message:'Selected evidence is unavailable.');}
 const filePeople=await completionParticipants(tx,ctx,files.flatMap(file=>[file.uploadedById,file.reviewerId]));
 if(files.some(file=>!filePeople.some(p=>p.id===file.uploadedById&&p.approved&&WRITER.includes(p.role))||!filePeople.some(p=>p.id===file.reviewerId&&p.approved&&ADMIN.includes(p.role))))blockers.push('A selected file uploader or reviewer no longer has the required access.');
 for(const file of files)verification.set(file.id,file);
 if(verification.size>30)blockers.push('This review exceeds thirty unique supporting files. Split the treatment scope before reviewing.');
 const snapshot=wire({format:'regpilot-risk-context',version:1,risk:riskValues(row),controls,treatments:tasks,evidence:files,participants,fileParticipants:filePeople});
 return {blockers,controls,treatments:tasks,files,verification:[...verification.values()],snapshot,hash:hashValue(snapshot)};
}
function proposalHash(row:{riskId:string;authorId:string;requestKey:string;residualLikelihood:number;residualImpact:number;rationale:string;validUntil:Date;evidenceManifest:unknown;contextHash:string}){return hashValue(wire({riskId:row.riskId,authorId:row.authorId,requestKey:row.requestKey,residualLikelihood:row.residualLikelihood,residualImpact:row.residualImpact,rationale:row.rationale,validUntil:row.validUntil,evidenceManifest:row.evidenceManifest,contextHash:row.contextHash}));}
function decisionHash(row:RiskReview){return hashValue(wire({id:row.id,riskId:row.riskId,proposalHash:row.proposalHash,status:row.status,reviewerId:row.reviewerId,reviewedAt:row.reviewedAt,reviewNotes:row.reviewNotes,version:row.version}));}
async function reviewState(tx:Tx,ctx:AuthorizedContext,risk:RiskRecord,review:RiskReview){
 const files=reviewedFilesSchema.safeParse(review.evidenceManifest);
 if(!files.success||!files.data.length||hashValue(review.context)!==review.contextHash||proposalHash(review)!==review.proposalHash)return {current:false,reason:'The saved risk review failed its integrity check.'};
 if(risk.status==='ARCHIVED'||review.status==='SUPERSEDED')return {current:false,reason:'This review is retained as history.'};
 if(review.status==='ACCEPTED'&&risk.status!=='ACCEPTED'||review.status==='PENDING'&&risk.status!=='UNDER_REVIEW')return {current:false,reason:'The risk was changed or reopened. Prepare a fresh review before relying on an accepted rating.'};
 if(review.validUntil.toISOString().slice(0,10)<new Date().toISOString().slice(0,10))return {current:false,reason:'The risk review period has expired.'};
 const people=await completionParticipants(tx,ctx,[review.authorId,review.reviewerId]);
 if(!people.some(p=>p.id===review.authorId&&p.approved&&WRITER.includes(p.role)))return {current:false,reason:'The risk assessment author no longer has the required access.'};
 if(review.status==='ACCEPTED'&&(!review.reviewerId||review.reviewerId===review.authorId||files.data.some(file=>file.uploadedById===review.reviewerId)||!people.some(p=>p.id===review.reviewerId&&p.approved&&ADMIN.includes(p.role))||decisionHash(review)!==review.decisionHash))return {current:false,reason:'The independent risk decision is unavailable or no longer valid.'};
 const current=await basis(tx,ctx,risk,files.data.map(file=>file.id));
 if(current.blockers.length)return {current:false,reason:current.blockers[0]};
 if(review.status==='ACCEPTED'&&current.verification.some(file=>file.uploadedById===review.reviewerId))return {current:false,reason:'The risk reviewer must be independent of all supporting treatment and review files.'};
 if(current.hash!==review.contextHash)return {current:false,reason:'The risk, controls, treatment work, evidence or permissions changed. Prepare a fresh review.'};
 return {current:true,reason:'The saved risk, treatment receipts and supporting metadata still match.'};
}
export async function prepareRiskReview(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 const data=parse(riskReviewSchema,input),validUntil=futureDate(data.validUntil);
 const before=await transaction(ctx,async tx=>{
  const row=await record(tx,ctx,id);await editor(tx,ctx,row);
  const existing=await tx.riskReview.findUnique({where:{riskId_requestKey:{riskId:id,requestKey:data.requestKey}}});
  if(existing){sameProposal(existing,ctx.userId,data);return {row,existing,current:null};}
  unchanged(row,data.version);if(await tx.riskReview.count({where:{organizationId:ctx.organizationId,riskId:id}})>=30)throw new IntelligenceError('This risk reached its thirty-review history limit',409);
  const current=await basis(tx,ctx,row,data.evidenceIds);if(current.blockers.length)throw new IntelligenceError(current.blockers[0],409);return {row,existing:null,current};
 });
 if(before.existing)return {id:before.existing.id,riskId:id,version:before.existing.version,riskVersion:before.row.version,status:before.existing.status,reused:true};
 await verifyReviewedBytes(ctx,before.current!.verification,deps.storage);
 return transaction(ctx,async tx=>{
  const row=await record(tx,ctx,id);await editor(tx,ctx,row);
  const repeated=await tx.riskReview.findUnique({where:{riskId_requestKey:{riskId:id,requestKey:data.requestKey}}});
  if(repeated){sameProposal(repeated,ctx.userId,data);return {id:repeated.id,riskId:id,version:repeated.version,riskVersion:row.version,status:repeated.status,reused:true};}
  unchanged(row,data.version);const current=await basis(tx,ctx,row,data.evidenceIds);if(current.blockers.length||current.hash!==before.current!.hash)throw new IntelligenceError('Risk context changed during file verification. Refresh before preparing.',409);
  await tx.riskReview.updateMany({where:{organizationId:ctx.organizationId,riskId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
  const proposal={organizationId:ctx.organizationId,riskId:id,requestKey:data.requestKey,authorId:ctx.userId,residualLikelihood:data.residualLikelihood,residualImpact:data.residualImpact,rationale:data.rationale,validUntil,evidenceManifest:json(current.files),context:json(current.snapshot),contextHash:current.hash};
  const review=await tx.riskReview.create({data:{...proposal,proposalHash:proposalHash(proposal)}});
  const saved=await tx.riskRecord.update({where:{id},data:{status:'UNDER_REVIEW',version:{increment:1}}});
  await event(tx,ctx,'risk.review_prepared',id,{reviewId:review.id,contextHash:review.contextHash,proposalHash:review.proposalHash,files:current.files.map(file=>file.id),version:saved.version});
  return {id:review.id,riskId:id,version:review.version,riskVersion:saved.version,status:review.status,reused:false};
 });
}
export async function decideRiskReview(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 identifier(id);const data=parse(riskDecisionSchema,input);
 async function inspect(tx:Tx){
  await requireMember(tx,ctx,ADMIN);const review=await tx.riskReview.findFirst({where:{id,organizationId:ctx.organizationId}});if(!review)throw new IntelligenceError('Risk review unavailable',404);
  const risk=await record(tx,ctx,review.riskId),files=reviewedFilesSchema.safeParse(review.evidenceManifest);
  if(!files.success||!files.data.length||proposalHash(review)!==review.proposalHash||hashValue(review.context)!==review.contextHash)throw new IntelligenceError('The saved review failed its integrity check',409);
  if(review.authorId===ctx.userId||files.data.some(file=>file.uploadedById===ctx.userId))throw new IntelligenceError('A different administrator who did not prepare this review or upload its files must decide',403);
  if(review.status===data.decision&&review.version===data.version+1&&review.reviewerId===ctx.userId&&review.reviewNotes===data.notes&&decisionHash(review)===review.decisionHash)return {review,risk,files:files.data,current:null,reused:true};
  unchanged(risk,data.riskVersion);if(review.status!=='PENDING'||review.version!==data.version)throw new IntelligenceError('The risk review changed or was already decided',409);
  const latest=await tx.riskReview.findFirst({where:{organizationId:ctx.organizationId,riskId:risk.id},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});if(latest?.id!==id)throw new IntelligenceError('A newer risk assessment needs review',409);
  const current=await basis(tx,ctx,risk,files.data.map(file=>file.id));
  if(current.verification.some(file=>file.uploadedById===ctx.userId))throw new IntelligenceError('A different administrator who did not upload any supporting treatment or review files must decide',403);
  if(data.decision==='RETURNED')return {review,risk,files:files.data,current:null,reused:false};
  const state=await reviewState(tx,ctx,risk,review);if(!state.current)throw new IntelligenceError(state.reason,409);
  return {review,risk,files:files.data,current,reused:false};
 }
 const before=await transaction(ctx,inspect);
 if(before.reused)return {id,riskId:before.risk.id,version:before.review.version,riskVersion:before.risk.version,status:before.review.status,reused:true};
 if(before.current)await verifyReviewedBytes(ctx,before.current.verification,deps.storage);
 return transaction(ctx,async tx=>{
  const fresh=await inspect(tx);if(fresh.reused)return {id,riskId:fresh.risk.id,version:fresh.review.version,riskVersion:fresh.risk.version,status:fresh.review.status,reused:true};
  if(before.current&&fresh.current?.hash!==before.current.hash)throw new IntelligenceError('Risk context changed during review. Refresh before deciding.',409);
  const updated=await tx.riskReview.update({where:{id},data:{status:data.decision,reviewerId:ctx.userId,reviewedAt:new Date(),reviewNotes:data.notes,version:{increment:1}}});
  const savedReview=await tx.riskReview.update({where:{id},data:{decisionHash:decisionHash(updated)}});
  const risk=await tx.riskRecord.update({where:{id:fresh.risk.id},data:{status:data.decision==='ACCEPTED'?'ACCEPTED':'OPEN',...(data.decision==='ACCEPTED'?{reviewDueAt:updated.validUntil}:{}),version:{increment:1}}});
  await event(tx,ctx,'risk.review_decided',risk.id,{reviewId:id,decision:data.decision,notes:data.notes,decisionHash:savedReview.decisionHash,contextHash:savedReview.contextHash,proposalHash:savedReview.proposalHash,version:risk.version});
  return {id,riskId:risk.id,version:savedReview.version,riskVersion:risk.version,status:savedReview.status,reused:false};
 });
}
export async function archiveRisk(ctx:AuthorizedContext,id:string,input:unknown,reopen=false){
 const data=parse(riskArchiveSchema,input);
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await record(tx,ctx,id);if(row.version!==data.version||reopen&&row.status!=='ARCHIVED'||!reopen&&row.status==='ARCHIVED')throw new IntelligenceError('The saved risk state changed. Refresh before continuing.',409);
  await tx.riskReview.updateMany({where:{organizationId:ctx.organizationId,riskId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
  const saved=await tx.riskRecord.update({where:{id},data:{status:reopen?'OPEN':'ARCHIVED',version:{increment:1}}});await event(tx,ctx,reopen?'risk.reopened':'risk.archived',id,{notes:data.notes,version:saved.version,treatmentTasksRemainUnchanged:true});return result(saved);
 });
}

export async function riskWorkspace(ctx:AuthorizedContext,input:Partial<RiskQuery>={}){
 const query=parse(riskQuerySchema,input);
 const output=await transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx),base={organizationId:ctx.organizationId},where:Prisma.RiskRecordWhereInput={...base};
  if(query.status!=='all')where.status=query.status.toUpperCase();if(query.q)where.OR=[{title:{contains:literal(query.q),mode:'insensitive'}},{description:{contains:literal(query.q),mode:'insensitive'}}];
  const [total,groups,overdue,memberRows,controlRows,fileRows]=await Promise.all([
   tx.riskRecord.count({where}),tx.riskRecord.groupBy({by:['status'],where:base,_count:{_all:true}}),tx.riskRecord.count({where:{...base,status:{not:'ARCHIVED'},reviewDueAt:{lt:new Date(new Date().toISOString().slice(0,10))}}}),
   tx.membership.findMany({where:{...base,role:{in:['OWNER','ADMIN','EDITOR']}},orderBy:{userId:'asc'},take:201,select:{role:true,user:{select:{id:true,email:true}}}}),
   tx.managedControl.findMany({where:{...base,enabled:true},orderBy:[{title:'asc'},{id:'asc'}],take:101,select:{id:true,title:true,enabled:true,version:true}}),
   tx.evidence.findMany({where:{...base,scanStatus:'CLEAN',reviewStatus:'APPROVED'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:121,select:{id:true,filename:true,sha256:true,uploadedById:true,reviewerId:true}})
  ]);
  const pages=Math.max(1,Math.ceil(total/RISK_PAGE_SIZE)),page=Math.min(query.page,pages),rows=await tx.riskRecord.findMany({where,orderBy:[{reviewDueAt:'asc'},{id:'asc'}],skip:(page-1)*RISK_PAGE_SIZE,take:RISK_PAGE_SIZE,include:{owner:{select:{email:true}},_count:{select:{treatments:true}}}});
  const summary={all:0,open:0,underReview:0,accepted:0,archived:0,overdue};for(const group of groups){summary.all+=group._count._all;const key={OPEN:'open',UNDER_REVIEW:'underReview',ACCEPTED:'accepted',ARCHIVED:'archived'}[group.status] as 'open'|'underReview'|'accepted'|'archived'|undefined;if(key)summary[key]+=group._count._all;}
  const creation=query.requestKey?await tx.riskRecord.findUnique({where:{organizationId_createKey:{organizationId:ctx.organizationId,createKey:query.requestKey}},select:{id:true}}):null;
  if(query.riskId&&creation&&query.riskId!==creation.id)throw new IntelligenceError('Creation request does not match the linked risk',409);
  const selectedId=query.riskId||creation?.id;
  let selected=null;
  if(selectedId){
   const row=await record(tx,ctx,selectedId),current=await basis(tx,ctx,row,[]),reviews=await tx.riskReview.findMany({where:{...base,riskId:selectedId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:30});
   const reviewViews=[];
   // Only the latest proposal can be relied on; older decisions remain visible as history.
   for(const [index,review] of reviews.entries()){
    const state=index===0?await reviewState(tx,ctx,row,review):{current:false,reason:'Historical review; a newer assessment is recorded.'};
    const files=reviewedFilesSchema.safeParse(review.evidenceManifest);
    reviewViews.push({id:review.id,requestKey:review.requestKey,version:review.version,status:review.status,authorId:review.authorId,reviewerId:review.reviewerId,reviewedAt:review.reviewedAt,reviewNotes:review.reviewNotes,residualLikelihood:review.residualLikelihood,residualImpact:review.residualImpact,...riskRating(review.residualLikelihood,review.residualImpact),rationale:review.rationale,validUntil:review.validUntil,createdAt:review.createdAt,evidence:files.success?files.data:[],...state});
   }
   const canEdit=WRITER.includes(actor.role)&&(ADMIN.includes(actor.role)||row.ownerId===ctx.userId||row.createdById===ctx.userId),latest=reviewViews[0];
   selected={risk:{...row,...riskRating(row.likelihood,row.impact),ownerName:(await tx.user.findUnique({where:{id:row.ownerId},select:{email:true}}))?.email||'Owner unavailable'},controls:current.controls,treatments:current.treatments.map(({proof,...task})=>task),reviews:reviewViews,latestReview:latest||null,canEdit,canReview:!!latest&&latest.status==='PENDING'&&ADMIN.includes(actor.role)&&latest.authorId!==ctx.userId&&!latest.evidence.some(file=>file.uploadedById===ctx.userId)&&!current.verification.some(file=>file.uploadedById===ctx.userId),blockers:current.blockers};
  }
  const taskWhere:Prisma.ObligationWhereInput={...base,completionException:false,changeAction:null,auditRequest:null,accessItem:null};if(query.taskQ)taskWhere.OR=[{title:{contains:literal(query.taskQ),mode:'insensitive'}},{ownerName:{contains:literal(query.taskQ),mode:'insensitive'}}];
  if(selectedId)taskWhere.riskTreatments={none:{organizationId:ctx.organizationId,riskId:selectedId}};
  const taskTotal=await tx.obligation.count({where:taskWhere}),taskPages=Math.max(1,Math.ceil(taskTotal/RISK_PAGE_SIZE)),taskPage=Math.min(query.taskPage,taskPages),tasks=await tx.obligation.findMany({where:taskWhere,orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(taskPage-1)*RISK_PAGE_SIZE,take:RISK_PAGE_SIZE,select:{id:true,title:true,status:true,ownerName:true}});
  return {organizationId:ctx.organizationId,role:actor.role,canWrite:WRITER.includes(actor.role),members:memberRows.slice(0,200).filter(m=>allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(m=>({...m.user,role:m.role})),membersLimited:memberRows.length>200,controls:controlRows.slice(0,100),controlsLimited:controlRows.length>100,evidence:fileRows.slice(0,120),evidenceLimited:fileRows.length>120,items:rows.map(({owner,_count,...row})=>({...row,...riskRating(row.likelihood,row.impact),ownerName:owner.email,treatmentCount:_count.treatments})),total,page,pages,pageSize:RISK_PAGE_SIZE,summary,selected,tasks:{items:tasks,total:taskTotal,page:taskPage,pages:taskPages,pageSize:RISK_PAGE_SIZE},creationLookup:query.requestKey?{requestKey:query.requestKey,riskId:creation?.id||null,found:!!creation}:null,scope:RISK_SCOPE};
 });
 const latest=await db.$transaction(tx=>requireMember(tx,ctx));if(latest.role!==output.role)throw new IntelligenceError('Your workspace access changed. Reload the risk register.',409);return output;
}
export async function exportRisk(ctx:AuthorizedContext,id:string){
 identifier(id);const workspace=await riskWorkspace(ctx,{riskId:id});
 return {format:'regpilot-risk-record',version:1,exportedAt:new Date().toISOString(),organizationId:ctx.organizationId,scope:RISK_SCOPE,...workspace.selected};
}
