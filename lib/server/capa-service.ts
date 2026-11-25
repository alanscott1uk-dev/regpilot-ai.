import {reviewedDatabaseRecovery} from './customer-api-service';
import {failedMonitor,caseForMonitor,caseMonitoring,monitoringKey} from './quality-monitoring';
import {emailSourceSchema,emailAttachmentSchema,emailSnapshotSchema,type CaseEmailRecord} from '../quality-email';
import {stockCountSchema,stockReviewSchema,reconcileStock,stockBlocker,type StockRecord} from '../stock-reconciliation';
import {qualityTrainingInput,trainingFindingSchema,type CaseTrainingRecord} from '../quality-training';
import {trainingAtTime,issueCaseRetraining} from './training-service';
import {Prisma,type QualityCase,type QualityEffectiveness} from '@prisma/client';
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
import {qualityCreateSchema,qualityInvestigationSchema,qualityActionSchema,qualityEffectivenessSchema,qualityDecisionSchema,qualityReopenSchema,qualityHandoverSchema,qualityQuerySchema,qualityDue,qualityCanClose,QUALITY_LIMIT,QUALITY_PAGE_SIZE,QUALITY_SCOPE,type QualityQuery} from '../capa';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const href=(path:string,org:string,values:Record<string,string>={})=>path+'?'+new URLSearchParams({organizationId:org,...values});
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');
const receiptSchema=z.object({id:z.uuid(),caseId:z.uuid(),version:z.number().int().positive(),caseVersion:z.number().int().positive(),status:z.string(),cycle:z.number().int().positive(),taskId:z.uuid().optional(),training:trainingFindingSchema.optional(),stock:z.object({count:stockCountSchema,files:reviewedFilesSchema}).optional(),stockReview:stockReviewSchema.optional(),mail:emailSnapshotSchema.optional()}).strict();
type Receipt=z.infer<typeof receiptSchema>;
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw new IntelligenceError('Check the required quality case fields, dates and selected records');return result.data;}
function identifier(value:string){if(!z.uuid().safeParse(value).success)throw new IntelligenceError('Invalid quality record identifier');}
function pastDate(value:string){if(!z.iso.date().safeParse(value).success||value>'9999-12-31'||value< '1970-01-01'||value>new Date().toISOString().slice(0,10))throw new IntelligenceError('Choose a valid occurrence or observation date up to today');return new Date(value);}
async function record(tx:Tx,ctx:AuthorizedContext,id:string){identifier(id);const row=await tx.qualityCase.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError('Quality case not found in this organisation',404);return row;}
async function editor(tx:Tx,ctx:AuthorizedContext,row:QualityCase){const person=await requireMember(tx,ctx,WRITER);if(!ADMIN.includes(person.role)&&row.ownerId!==ctx.userId&&row.createdById!==ctx.userId)throw new IntelligenceError('The case owner or an administrator must make this change',403);return person;}
async function owner(tx:Tx,ctx:AuthorizedContext,id:string){const people=await completionParticipants(tx,ctx,[id]);if(!people.some(p=>p.id===id&&p.approved&&WRITER.includes(p.role)))throw new IntelligenceError('Choose a current member who can own this work',409);return (await tx.user.findUniqueOrThrow({where:{id},select:{email:true}})).email;}
function unchanged(row:QualityCase,version:number,closed=false){if(row.version!==version)throw new IntelligenceError('This case changed. Refresh its saved state before continuing.',409);if(!closed&&row.status==='CLOSED')throw new IntelligenceError('Reopen this case before changing its investigation or actions',409);}
function result(row:QualityCase):Receipt{return {id:row.id,caseId:row.id,version:row.version,caseVersion:row.version,status:row.status,cycle:row.cycle};}
const requestHash=(ctx:AuthorizedContext,action:string,caseId:string|null,data:unknown)=>hashValue({actorId:ctx.userId,organizationId:ctx.organizationId,action,caseId,data});
async function replay(tx:Tx,ctx:AuthorizedContext,key:string,action:string,caseId:string|null,hash:string){
 const prior=await tx.qualityOperation.findUnique({where:{organizationId_requestKey:{organizationId:ctx.organizationId,requestKey:key}}});
 if(!prior)return null;
 if(prior.actorId!==ctx.userId||prior.action!==action||caseId&&prior.caseId!==caseId||prior.requestHash!==hash)throw new IntelligenceError('This request identity was already used for different quality case details',409);
 const parsed=receiptSchema.safeParse(prior.result);if(!parsed.success||hashValue(prior.result)!==prior.resultHash||parsed.data.caseId!==prior.caseId)throw new IntelligenceError('The saved operation receipt is unavailable',409);
 return {...parsed.data,reused:true};
}
async function remember(tx:Tx,ctx:AuthorizedContext,key:string,action:string,hash:string,value:Receipt){await tx.qualityOperation.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,requestKey:key,action,caseId:value.caseId,requestHash:hash,result:json(value),resultHash:hashValue(value)}});return {...value,reused:false};}
async function event(tx:Tx,ctx:AuthorizedContext,action:string,id:string,details:unknown){await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:'quality.'+action,entityType:'QualityCase',entityId:id,details:json(details)}});}
async function supersede(tx:Tx,ctx:AuthorizedContext,id:string){await tx.qualityEffectiveness.updateMany({where:{organizationId:ctx.organizationId,caseId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});}
function caseBasis(row:QualityCase){return {id:row.id,createdById:row.createdById,ownerId:row.ownerId,title:row.title,kind:row.kind,classification:row.classification,description:row.description,impact:row.impact,containment:row.containment,occurredAt:row.occurredAt,investigationNotes:row.investigationNotes,rootCause:row.rootCause,effectivenessCriteria:row.effectivenessCriteria,effectivenessDueAt:row.effectivenessDueAt,cycle:row.cycle,recurrenceCount:row.recurrenceCount};}

export async function createQualityCase(ctx:AuthorizedContext,input:unknown){
 const data=parse(qualityCreateSchema,input),occurredAt=pastDate(data.occurredAt),hash=requestHash(ctx,'CREATE',null,data);
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);const prior=await replay(tx,ctx,data.requestKey,'CREATE',null,hash);if(prior)return prior;
  const {requestKey,monitoring,...fields}=data;
  if(monitoring){
   const existing=await caseForMonitor(tx,ctx.organizationId,monitoring);
   if(existing){const saved=await record(tx,ctx,existing.entityId);await caseMonitoring(tx,ctx.organizationId,saved.id);await remember(tx,ctx,requestKey,'CREATE',hash,result(saved));return {...result(saved),reused:true};}
  }
  const source=monitoring?await failedMonitor(tx,ctx.organizationId,monitoring):null;
  if(await tx.qualityCase.count({where:{organizationId:ctx.organizationId,status:{not:'CLOSED'}}})>=QUALITY_LIMIT)throw new IntelligenceError('This workspace has reached its 200-active-case quality pilot limit',409);
  await owner(tx,ctx,data.ownerId);
  const row=await tx.qualityCase.create({data:{...fields,occurredAt,organizationId:ctx.organizationId,createdById:ctx.userId,createKey:requestKey}});
  await event(tx,ctx,'created',row.id,{case:caseBasis(row),version:row.version,scope:QUALITY_SCOPE});
  if(source)await event(tx,ctx,'monitoring_linked',row.id,{key:monitoringKey(ctx.organizationId,source),source,sourceHash:hashValue(source)});
  return remember(tx,ctx,requestKey,'CREATE',hash,result(row));
 });
}
async function qualityEmailRecords(tx:Tx,ctx:AuthorizedContext,id:string):Promise<CaseEmailRecord[]>{
 const operations=await tx.qualityOperation.findMany({where:{organizationId:ctx.organizationId,caseId:id,action:'RECORD_EMAIL'},
  orderBy:[{createdAt:'asc'},{id:'asc'}],take:41});
 if(operations.length>40)throw new IntelligenceError('The email record history exceeds the case limit',409);
 return operations.map(op=>{
  const receipt=receiptSchema.safeParse(op.result);
  if(!receipt.success||receipt.data.caseId!==id||!receipt.data.mail||hashValue(op.result)!==op.resultHash)
   throw new IntelligenceError('A saved email receipt could not be verified',409);
  return {...receipt.data.mail,key:op.requestKey,actor:op.actorId,at:op.createdAt.toISOString(),cycle:receipt.data.cycle};
 });
}

const recordEmailInput=z.object({requestKey:z.uuid(),version:z.number().int().positive(),source:emailSourceSchema,
 taskId:z.uuid().nullable(),files:z.array(emailAttachmentSchema).max(3)}).strict();

export async function recordQualityEmail(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(recordEmailInput,input);
 const mail={source:data.source,taskId:data.taskId,files:data.files};
 if((mail.files.length>0)!==!!mail.taskId||new Set(mail.files.map(f=>f.id)).size!==mail.files.length)
  throw new IntelligenceError('Choose a current case action for the selected attachments');
 const hash=requestHash(ctx,'RECORD_EMAIL',id,data);
 return transaction(ctx,async tx=>{
  const row=await record(tx,ctx,id);await editor(tx,ctx,row);
  const prior=await replay(tx,ctx,data.requestKey,'RECORD_EMAIL',id,hash);
  if(prior)return prior;
  const history=await qualityEmailRecords(tx,ctx,id);
  const existing=history.find(entry=>entry.source.messageId===mail.source.messageId);
  if(existing){
   if(hashValue({source:existing.source,taskId:existing.taskId,files:existing.files})!==hashValue(mail))
    throw new IntelligenceError('This message is already on this case with a different selection. Check the saved record.',409);
   return {...result(row),reused:true};
  }
  unchanged(row,data.version);
  if(history.length>=40)throw new IntelligenceError('This case already has 40 saved email records',409);
  if(mail.taskId){
   const action=await tx.qualityAction.findFirst({where:{organizationId:ctx.organizationId,caseId:id,cycle:row.cycle,obligationId:mail.taskId}});
   if(!action)throw new IntelligenceError('The attachment task is outside this case or cycle',409);
   const files=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId:mail.taskId,
    uploadedById:ctx.userId,scanStatus:'CLEAN',id:{in:mail.files.map(f=>f.id)}}});
   if(!mail.files.every(f=>files.some(stored=>stored.id===f.id&&stored.filename===f.filename&&stored.sha256===f.sha256)))
    throw new IntelligenceError('One or more attachments do not match the scanned files on this case action',409);
  }
  await supersede(tx,ctx,id);
  const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},
   data:{version:{increment:1},...(row.status==='EFFECTIVENESS_DUE'?{status:'ACTIONS_OPEN'}:{})}});
  await event(tx,ctx,'email_recorded',id,{cycle:row.cycle,version:saved.version,attachmentCount:mail.files.length});
  return remember(tx,ctx,data.requestKey,'RECORD_EMAIL',hash,{...result(saved),mail});
 });
}

async function qualityTrainingRecords(tx:Tx,ctx:AuthorizedContext,id:string):Promise<CaseTrainingRecord[]>{
 const operations=await tx.qualityOperation.findMany({where:{organizationId:ctx.organizationId,caseId:id,action:'LINK_TRAINING'},
  orderBy:[{createdAt:'asc'},{id:'asc'}],take:101});
 if(operations.length>100)throw new IntelligenceError('The training history exceeds the case record limit',409);
 return operations.map(op=>{
  const receipt=receiptSchema.safeParse(op.result);
  if(!receipt.success||receipt.data.caseId!==id||!receipt.data.training||hashValue(op.result)!==op.resultHash)
   throw new IntelligenceError('A saved case training record could not be verified',409);
  return {key:op.requestKey,recordedAt:op.createdAt.toISOString(),recordedBy:op.actorId,cycle:receipt.data.cycle,finding:receipt.data.training};
 });
}

export async function linkQualityTraining(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(qualityTrainingInput,input),hash=requestHash(ctx,'LINK_TRAINING',id,data);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await record(tx,ctx,id),prior=await replay(tx,ctx,data.requestKey,'LINK_TRAINING',id,hash);
  if(prior)return prior;
  unchanged(row,data.version);
  let asOf=data.purpose==='INCIDENT'?new Date(data.asOf):new Date();
  if(asOf>new Date()||data.purpose==='INCIDENT'&&asOf.toISOString().slice(0,10)!==row.occurredAt.toISOString().slice(0,10))
   throw new IntelligenceError('Choose a past UTC time on the recorded occurrence date');
  const records=await qualityTrainingRecords(tx,ctx,id);
  if(records.length>=100)throw new IntelligenceError('This case has reached its 100 training record limit',409);
  const parent=data.purpose==='INCIDENT'?null:records.find(entry=>entry.key===data.incidentKey&&entry.cycle===row.cycle&&entry.finding.purpose==='INCIDENT');
  if(data.purpose!=='INCIDENT'&&!parent)throw new IntelligenceError('Choose an incident record from this investigation cycle',409);
  let assignmentId:string;
  if(data.purpose==='ISSUE_RETRAINING'){
   if(records.some(entry=>entry.finding.issuedFromCase&&entry.finding.incidentKey===data.incidentKey))throw new IntelligenceError('Retraining has already been issued for this incident record',409);
   assignmentId=await issueCaseRetraining(tx,ctx,parent!.finding.assignmentId,parent!.finding.asOf,id);
   asOf=new Date();
  }else assignmentId=data.assignmentId;
  const facts=await trainingAtTime(tx,ctx,assignmentId,asOf);
  if(data.purpose!=='INCIDENT'&&(parent!.finding.learnerId!==facts.learnerId||parent!.finding.policyId!==facts.policyId||
    facts.assignmentId===parent!.finding.assignmentId||facts.assignedAt<=parent!.finding.asOf))
    throw new IntelligenceError('Choose a later assignment for the same operator and procedure as the incident record',409);
  await supersede(tx,ctx,id);
  const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{version:{increment:1},
   ...(row.status==='EFFECTIVENESS_DUE'?{status:'ACTIONS_OPEN'}:{})}});
  const training={...facts,purpose:data.purpose==='ISSUE_RETRAINING'?'RETRAINING' as const:data.purpose,
   ...(data.purpose==='ISSUE_RETRAINING'?{issuedFromCase:true}:{}),asOf:asOf.toISOString(),
   incidentKey:data.purpose==='INCIDENT'?null:data.incidentKey,notes:data.notes};
  await event(tx,ctx,'training_linked',id,{cycle:row.cycle,purpose:data.purpose,version:saved.version});
  return remember(tx,ctx,data.requestKey,'LINK_TRAINING',hash,{...result(saved),training});
 });
}

const stockMeta = {requestKey:z.uuid(),version:z.number().int().positive()};
const recordStockInput = z.object({...stockMeta, count:stockCountSchema}).strict();
const reviewStockInput = z.object({...stockMeta, review:stockReviewSchema}).strict();

async function stockRecords(tx:Tx, ctx:AuthorizedContext, id:string):Promise<StockRecord[]> {
 const operations = await tx.qualityOperation.findMany({where:{organizationId:ctx.organizationId,caseId:id,action:{in:['RECORD_STOCK','REVIEW_STOCK']}},
  select:{action:true,requestKey:true,actorId:true,createdAt:true,result:true,resultHash:true}});
 const records = new Map<string,StockRecord>();
 const ordered = operations.map(op=>{
  const receipt=receiptSchema.safeParse(op.result);
  if (!receipt.success || receipt.data.caseId!==id || hashValue(op.result)!==op.resultHash)
   throw new IntelligenceError('A stock reconciliation receipt failed its integrity check.',409);
  return {op, receipt:receipt.data};
 }).sort((a,b)=>a.receipt.version-b.receipt.version);
 for(const {op,receipt} of ordered){
  const at=op.createdAt.toISOString();
  if(op.action==='RECORD_STOCK' && receipt.stock){
   const {count,files}=receipt.stock;
   records.set(op.requestKey,{key:op.requestKey,cycle:receipt.cycle,actor:op.actorId,at,count,files,totals:reconcileStock(count),review:null});
  }else if(op.action==='REVIEW_STOCK' && receipt.stockReview){
   const {countKey,decision,notes}=receipt.stockReview, target=records.get(countKey);
   if(!target || target.review || target.actor===op.actorId) throw new IntelligenceError('The stock review does not match a distinct unreviewed count.',409);
   target.review={actor:op.actorId,at,decision,notes};
  }else throw new IntelligenceError('The saved stock reconciliation is incomplete.',409);
 }
 return Array.from(records.values());
}

export async function saveStockReconciliation(ctx:AuthorizedContext,id:string,action:'RECORD_STOCK'|'REVIEW_STOCK',input:unknown,storage?:EvidenceObjectStore) {
 const parsed=(action==='RECORD_STOCK'?recordStockInput:reviewStockInput).safeParse(input);
 if(!parsed.success)throw new IntelligenceError(parsed.error.issues[0]?.message || 'Check the stock reconciliation fields.');
 const data=parsed.data, hash=requestHash(ctx,action,id,data);
 async function inspect(tx:Tx) {
  const row=await record(tx,ctx,id);
  if ('count' in data) await editor(tx,ctx,row); else await requireMember(tx,ctx,ADMIN);
  const prior=await replay(tx,ctx,data.requestKey,action,id,hash);
  if(prior)return {row,prior,files:[] as ReviewedFile[]};
  unchanged(row,data.version);
  if(row.kind!=='DEVIATION')throw new IntelligenceError('Choose a deviation case for a stock reconciliation.',409);
  const counts=await stockRecords(tx,ctx,id), latest=counts.at(-1);
  if('count' in data){
   const count=data.count;
   if(Date.parse(count.countedAt)>Date.now())throw new IntelligenceError('Choose a physical count time up to now.');
   if(latest){
    if(!latest.review)throw new IntelligenceError('Have the preceding count independently reviewed before recording a recount.',409);
    const old=latest.count;
    if(old.site!==count.site || old.product!==count.product || old.batch!==count.batch || old.unit!==count.unit)
     throw new IntelligenceError('Keep the same site, product, batch and unit for this recount. Open another case for other stock.',409);
    if(Date.parse(count.countedAt)<=Date.parse(old.countedAt) || count.countId===old.countId)
     throw new IntelligenceError('A recount needs a later physical count and its own evidence.',409);
   }
   const files=await reviewedFiles(tx,ctx.organizationId,[count.registerId,count.countId]);
   if(files[0].sha256===files[1].sha256)throw new IntelligenceError('The register extract and physical count must be different records.',409);
   const countHash=files.find(file=>file.id===count.countId)!.sha256;
   if(counts.some(entry=>entry.files.some(file=>file.id===entry.count.countId && file.sha256===countHash)))
    throw new IntelligenceError('Choose a new physical count record for a recount.',409);
   return {row,prior:null,files};
  }
  if(!latest || latest.key!==data.review.countKey || latest.review)throw new IntelligenceError('Choose the latest unreviewed count.',409);
  if(latest.actor===ctx.userId || latest.files.some(file=>file.uploadedById===ctx.userId))
   throw new IntelligenceError('A separate quality administrator must review the reconciliation and its source records.',403);
  if(data.review.decision==='RECOUNT')return {row,prior:null,files:[] as ReviewedFile[]};
  const files=await reviewedFiles(tx,ctx.organizationId,latest.files.map(f=>f.id));
  if(hashValue(files)!==hashValue(latest.files))throw new IntelligenceError('The reviewed stock evidence changed.',409);
  return {row,prior:null,files};
 }
 const before=await transaction(ctx,inspect);
 if(before.prior)return before.prior;
 await verifyReviewedBytes(ctx,before.files,storage);
 return transaction(ctx,async tx=>{
  const current=await inspect(tx);if(current.prior)return current.prior;
  if(hashValue(current.files)!==hashValue(before.files))throw new IntelligenceError('The stock evidence changed during verification.',409);
  const row=current.row;
  await supersede(tx,ctx,id);
  const updated=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId,version:data.version},
   data:{version:{increment:1},...(row.status==='EFFECTIVENESS_DUE'?{status:'ACTIONS_OPEN'}:{})}});
  const detail='count' in data?{stock:{count:data.count,files:current.files}}:{stockReview:data.review};
  await event(tx,ctx,'count' in data?'stock_recorded':'stock_reviewed',id,{cycle:row.cycle,version:updated.version});
  return remember(tx,ctx,data.requestKey,action,hash,{...result(updated),...detail});
 });
}

export async function changeQualityHandover(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(qualityHandoverSchema,input);
 const hash=requestHash(ctx,data.action,id,data);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const row=await record(tx,ctx,id);
  const prior=await replay(tx,ctx,data.requestKey,data.action,id,hash);
  if(prior)return prior;
  unchanged(row,data.version);
  let recipientId=row.handoverRecipientId;
  if(data.action==='OFFER_HANDOVER'){
   await editor(tx,ctx,row);
   if(recipientId)throw new IntelligenceError('Resolve the outstanding handover first',409);
   if(data.recipientId===ctx.userId||data.recipientId===row.ownerId)throw new IntelligenceError('Choose a different person to take responsibility',409);
   recipientId=data.recipientId;
  }else{
   if(!recipientId)throw new IntelligenceError('There is no outstanding handover',409);
   if(data.action==='ACCEPT_HANDOVER'&&recipientId!==ctx.userId)throw new IntelligenceError('Only the named recipient can accept this handover',403);
   if(data.action==='CANCEL_HANDOVER')await editor(tx,ctx,row);
  }
  const offered=data.action==='OFFER_HANDOVER',accepted=data.action==='ACCEPT_HANDOVER';
  if(offered||accepted)await owner(tx,ctx,recipientId);
  await supersede(tx,ctx,id);
  const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{
   handoverRecipientId:offered?recipientId:null,handoverNotes:offered?data.notes:'',
   ...(accepted?{ownerId:recipientId}:{}),
   ...(row.status==='EFFECTIVENESS_DUE'?{status:'ACTIONS_OPEN'}:{}),version:{increment:1}
  }});
  const label=offered?'handover_offered':accepted?'handover_accepted':'handover_cancelled';
  await event(tx,ctx,label,id,{cycle:row.cycle,previousOwnerId:row.ownerId,recipientId,
   outstandingChecks:offered?data.notes:row.handoverNotes,notes:data.notes,version:saved.version});
  return remember(tx,ctx,data.requestKey,data.action,hash,result(saved));
 });
}

export async function investigateQualityCase(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(qualityInvestigationSchema,input),hash=requestHash(ctx,'INVESTIGATE',id,data);
 return transaction(ctx,async tx=>{const row=await record(tx,ctx,id);await editor(tx,ctx,row);const prior=await replay(tx,ctx,data.requestKey,'INVESTIGATE',id,hash);if(prior)return prior;unchanged(row,data.version);if(row.handoverRecipientId&&data.ownerId!==row.ownerId)throw new IntelligenceError('Resolve the outstanding handover before changing the owner',409);await owner(tx,ctx,data.ownerId);
  const {requestKey,version,...fields}=data,effectivenessDueAt=futureDate(data.effectivenessDueAt);await supersede(tx,ctx,id);const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{...fields,effectivenessDueAt,status:'ACTIONS_OPEN',version:{increment:1}}});
  await event(tx,ctx,'investigated',id,{previous:caseBasis(row),current:caseBasis(saved),version:saved.version});return remember(tx,ctx,requestKey,'INVESTIGATE',hash,result(saved));
 });
}
export async function addQualityAction(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(qualityActionSchema,input),hash=requestHash(ctx,'ADD_ACTION',id,data);
 return transaction(ctx,async tx=>{const row=await record(tx,ctx,id);await editor(tx,ctx,row);const prior=await replay(tx,ctx,data.requestKey,'ADD_ACTION',id,hash);if(prior)return prior;unchanged(row,data.version);
  if(await tx.qualityAction.count({where:{organizationId:ctx.organizationId,caseId:id,cycle:row.cycle}})>=10)throw new IntelligenceError('Keep each quality cycle to at most ten owned actions',409);
  const dueDate=data.dueDate?futureDate(data.dueDate):null;let task;
  if(data.taskId){task=await completionTaskRecord(tx,ctx,data.taskId);if(task.changeAction||task.auditRequest||task.accessItem||task.completionException)throw new IntelligenceError('Choose an ordinary task with the standard reviewed-evidence completion workflow',409);if(!task.assigneeId)throw new IntelligenceError('Assign a current task owner before linking an action',409);await owner(tx,ctx,task.assigneeId);}
  else{const ownerName=await owner(tx,ctx,data.ownerId!);task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:data.title!,category:'Quality '+data.kind.toLowerCase(),ownerName,assigneeId:data.ownerId!,dueDate:dueDate!,notes:data.purpose,automationKey:hashValue({kind:'quality-action',caseId:id,requestKey:data.requestKey})}});}
  if(await tx.qualityAction.findFirst({where:{organizationId:ctx.organizationId,caseId:id,cycle:row.cycle,obligationId:task.id}}))throw new IntelligenceError('This task is already linked in the current investigation cycle',409);
  const action=await tx.qualityAction.create({data:{organizationId:ctx.organizationId,caseId:id,cycle:row.cycle,obligationId:task.id,requestKey:data.requestKey,kind:data.kind,purpose:data.purpose,createdById:ctx.userId}});
  await supersede(tx,ctx,id);const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{status:row.rootCause?'ACTIONS_OPEN':row.status,version:{increment:1}}});
  await event(tx,ctx,'action_added',id,{cycle:row.cycle,actionId:action.id,taskId:task.id,kind:data.kind,purpose:data.purpose,version:saved.version});return remember(tx,ctx,data.requestKey,'ADD_ACTION',hash,{...result(saved),id:action.id,taskId:task.id});
 });
}

function stableProof(proof:{source:unknown;control:unknown;assessment:unknown;evidence:unknown}){const source=proof.source as Record<string,unknown>|null;return wire({source:source?{...source,lastCheckedAt:undefined}:null,control:proof.control,assessment:proof.assessment,evidence:proof.evidence});}
async function basis(tx:Tx,ctx:AuthorizedContext,row:QualityCase,evidenceIds:string[],authorId=row.ownerId){
 const blockers:string[]=[],actions=await tx.qualityAction.findMany({where:{organizationId:ctx.organizationId,caseId:row.id,cycle:row.cycle},orderBy:{id:'asc'}});
 if(row.handoverRecipientId)blockers.push('Resolve the outstanding case handover before assessing effectiveness.');
 if(actions.length>10)throw new IntelligenceError('This cycle exceeds the reviewed action limit',409);
 if(!row.rootCause||!row.investigationNotes||!row.effectivenessCriteria||!row.effectivenessDueAt)blockers.push('Complete the investigation, root cause and measurable effectiveness plan first.');
 if(!actions.some(action=>action.kind!=='CONTAINMENT'))blockers.push('Record at least one corrective or preventive action for this cycle.');
 const participants=await completionParticipants(tx,ctx,[row.ownerId,row.createdById,authorId,...actions.map(action=>action.createdById)]);
 if(!participants.some(person=>person.id===row.ownerId&&person.approved&&WRITER.includes(person.role)))blockers.push('The case needs a current owner who can carry out this work.');
 if(!participants.some(person=>person.id===authorId&&person.approved&&WRITER.includes(person.role)))blockers.push('The effectiveness author no longer has the required access.');
 const tasks=[],verification=new Map<string,ReviewedFile>();
 for(const action of actions){
  const task=await completionTaskRecord(tx,ctx,action.obligationId),saved=await savedCompletion(tx,ctx,task),current=await completionContext(tx,ctx,task,'EDITOR',true);
  let reason=task.status!=='COMPLETE'?'Complete this action with reviewed evidence.':task.completionException?'An exception cannot serve as completed corrective or preventive action.':!saved?'This task has no verified completion receipt.':current.blockers[0]?.message||'';
  const files=saved?current.evidence.filter(file=>saved.receipt.evidence.some(proof=>proof.id===file.id&&proof.sha256===file.sha256&&proof.reviewVersion===file.reviewVersion)):[];
  if(saved&&!reason&&files.length!==saved.receipt.evidence.length)reason='The action evidence no longer matches its completion receipt.';
  const proof=saved&&!reason?completionProofSnapshot(current,files):null;
  if(saved&&proof&&!reason){const recorded=saved.receipt,currentTask={id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate.toISOString().slice(0,10)},recordedTask={id:recorded.task.id,title:recorded.task.title,category:recorded.task.category,ownerName:recorded.task.ownerName,assigneeId:recorded.task.assigneeId,dueDate:recorded.task.dueDate};if(hashValue(currentTask)!==hashValue(recordedTask)||hashValue(stableProof(proof))!==hashValue(stableProof(recorded)))reason='The action or reviewed basis changed after completion. Reopen and complete it against current evidence.';}
  if(!task.assigneeId||!(await completionParticipants(tx,ctx,[task.assigneeId])).some(person=>person.id===task.assigneeId&&person.approved&&WRITER.includes(person.role)))reason='The action needs a current eligible owner.';
  if(reason)blockers.push(task.title+': '+reason);else for(const file of await reviewedFiles(tx,ctx.organizationId,files.map(file=>file.id)))verification.set(file.id,file);
  tasks.push({id:action.id,kind:action.kind,purpose:action.purpose,cycle:action.cycle,createdById:action.createdById,task:{id:task.id,title:task.title,status:task.status,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate,completedAt:task.completedAt,updatedAt:task.updatedAt,href:href('/team/work',ctx.organizationId,{taskId:task.id})},completion:{recorded:!!saved,current:!reason,reason:reason||null,eventId:saved?.eventId||null},proof:proof&&!reason?{...stableProof(proof),participants:current.participants}:null});
 }
 let files:ReviewedFile[]=[];try{files=await reviewedFiles(tx,ctx.organizationId,evidenceIds);}catch(error){blockers.push(error instanceof IntelligenceError?error.message:'Selected evidence is unavailable.');}
 for(const file of files)verification.set(file.id,file);
 const counts=row.kind==='DEVIATION'?await stockRecords(tx,ctx,row.id):[], latest=counts.at(-1);
 if(latest){
  const reason=stockBlocker(latest);if(reason)blockers.push(reason);
  try{
   const sources=await reviewedFiles(tx,ctx.organizationId,latest.files.map(f=>f.id));
   if(hashValue(sources)!==hashValue(latest.files))throw new IntelligenceError('The stock evidence has changed since reconciliation.',409);
   for(const source of sources)verification.set(source.id,source);
  }catch(error){if(!(error instanceof IntelligenceError))throw error;blockers.push(error.message);}
 }
 const filePeople=await completionParticipants(tx,ctx,[...verification.values()].flatMap(file=>[file.uploadedById,file.reviewerId]));
 if([...verification.values()].some(file=>!filePeople.some(p=>p.id===file.uploadedById&&p.approved&&WRITER.includes(p.role))||!filePeople.some(p=>p.id===file.reviewerId&&p.approved&&ADMIN.includes(p.role))))blockers.push('A supporting file uploader or reviewer no longer has the required access.');
 if(verification.size>30)blockers.push('This cycle exceeds thirty unique supporting files. Split the action scope before reviewing.');
 const snapshot=wire({format:'regpilot-quality-effectiveness-context',version:1,case:caseBasis(row),actions:tasks,evidence:files,participants,fileParticipants:filePeople,...(latest?{stockReconciliation:latest}:{})});
 return {blockers,stockRecords:counts,actions:tasks,files,verification:[...verification.values()],snapshot,hash:hashValue(snapshot)};
}
function proposalHash(row:QualityEffectiveness){return hashValue({id:row.id,organizationId:row.organizationId,caseId:row.caseId,cycle:row.cycle,requestKey:row.requestKey,authorId:row.authorId,observedAt:row.observedAt.toISOString().slice(0,10),notes:row.notes,evidence:row.evidenceManifest,contextHash:row.contextHash});}
function decisionHash(row:QualityEffectiveness){return hashValue({id:row.id,proposalHash:row.proposalHash,reviewerId:row.reviewerId,status:row.status,reviewNotes:row.reviewNotes,reviewedAt:row.reviewedAt?.toISOString()});}
export function verifiedEffectivenessDecision(row:QualityEffectiveness){
 return ["PASSED","FAILED"].includes(row.status)&&!!row.reviewerId&&row.reviewerId!==row.authorId&&!!row.reviewedAt&&
  hashValue(row.context)===row.contextHash&&proposalHash(row)===row.proposalHash&&decisionHash(row)===row.decisionHash;
}
async function reviewState(tx:Tx,ctx:AuthorizedContext,row:QualityCase,review:QualityEffectiveness){
 const no=(reason:string)=>({current:false,reason});
 if(review.cycle!==row.cycle||review.status==='SUPERSEDED'||review.status==='FAILED')return no('Historical cycle or superseded assessment. A fresh investigation and effectiveness decision are required.');
 if(review.status==='PASSED'&&row.status!=='CLOSED')return no('The case has reopened since this decision.');
 const files=reviewedFilesSchema.safeParse(review.evidenceManifest);if(!files.success||!files.data.length||proposalHash(review)!==review.proposalHash||hashValue(review.context)!==review.contextHash)return no('The recorded assessment did not pass its integrity check.');
 if(review.status==='PASSED'){
  const reviewers=review.reviewerId?await completionParticipants(tx,ctx,[review.reviewerId]):[];
  if(!review.reviewerId||review.reviewerId===review.authorId||!reviewers.some(p=>p.id===review.reviewerId&&p.approved&&ADMIN.includes(p.role))||decisionHash(review)!==review.decisionHash)return no('The recorded decision or the independent reviewer’s current access is unavailable.');
 }
 const current=await basis(tx,ctx,row,files.data.map(file=>file.id),review.authorId);
 if(current.blockers.length)return no(current.blockers[0]);if(current.hash!==review.contextHash)return no('The investigation, action evidence or responsible people changed after this assessment.');
 return {current:true,reason:'The recorded assessment matches the current investigation, actions and reviewed evidence metadata.'};
}
async function independent(tx:Tx,ctx:AuthorizedContext,row:QualityCase,review:QualityEffectiveness,current:Awaited<ReturnType<typeof basis>>){
 if(current.stockRecords.some(entry=>entry.actor===ctx.userId)||[row.ownerId,row.createdById,review.authorId,...current.actions.flatMap(action=>[action.createdById,action.task.assigneeId])].includes(ctx.userId)||current.verification.some(file=>file.uploadedById===ctx.userId))throw new IntelligenceError('A different administrator who did not own or prepare this case, its actions or supporting files must decide effectiveness',403);
 const transfer=await tx.auditEvent.findFirst({where:{
  organizationId:ctx.organizationId,entityType:'QualityCase',entityId:row.id,action:{in:['quality.handover_accepted','quality.training_linked']},
  AND:[{details:{path:['cycle'],equals:row.cycle}},
   {OR:[{actorId:ctx.userId},{details:{path:['previousOwnerId'],equals:ctx.userId}}]}]
 },select:{id:true}});
 if(transfer)throw new IntelligenceError('An administrator who held responsibility or added training evidence during this investigation cycle cannot independently decide effectiveness',403);
}

export async function prepareQualityEffectiveness(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 const data=parse(qualityEffectivenessSchema,input),observedAt=pastDate(data.observedAt),hash=requestHash(ctx,'PREPARE_EFFECTIVENESS',id,data);
 async function inspect(tx:Tx){const row=await record(tx,ctx,id);await editor(tx,ctx,row);const prior=await replay(tx,ctx,data.requestKey,'PREPARE_EFFECTIVENESS',id,hash);if(prior)return {row,prior,current:null};unchanged(row,data.version);
  if(await tx.qualityEffectiveness.count({where:{organizationId:ctx.organizationId,caseId:id}})>=40)throw new IntelligenceError('This case reached its forty-assessment history limit',409);
  if(observedAt<row.occurredAt)throw new IntelligenceError('The effectiveness observation cannot precede the occurrence',409);
  const current=await basis(tx,ctx,row,data.evidenceIds,ctx.userId);if(current.blockers.length)throw new IntelligenceError(current.blockers[0],409);
  if(current.actions.some(action=>action.task.completedAt&&data.observedAt<action.task.completedAt.toISOString().slice(0,10)))throw new IntelligenceError('Observe effectiveness after all action completion dates',409);
  return {row,prior:null,current};
 }
 const before=await transaction(ctx,inspect);if(before.prior)return before.prior;await verifyReviewedBytes(ctx,before.current!.verification,deps.storage);
 return transaction(ctx,async tx=>{const fresh=await inspect(tx);if(fresh.prior)return fresh.prior;if(fresh.current!.hash!==before.current!.hash)throw new IntelligenceError('The case evidence changed during verification. Refresh before submitting.',409);
  await supersede(tx,ctx,id);let review=await tx.qualityEffectiveness.create({data:{organizationId:ctx.organizationId,caseId:id,cycle:fresh.row.cycle,requestKey:data.requestKey,authorId:ctx.userId,observedAt,notes:data.notes,evidenceManifest:json(fresh.current!.files),context:json(fresh.current!.snapshot),contextHash:fresh.current!.hash,proposalHash:'0'.repeat(64)}});
  review=await tx.qualityEffectiveness.update({where:{id:review.id,organizationId:ctx.organizationId},data:{proposalHash:proposalHash(review)}});
  const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{status:'EFFECTIVENESS_DUE',version:{increment:1}}});
  await event(tx,ctx,'effectiveness_prepared',id,{cycle:saved.cycle,reviewId:review.id,observedAt:data.observedAt,notes:data.notes,evidenceIds:data.evidenceIds,version:saved.version});
  return remember(tx,ctx,data.requestKey,'PREPARE_EFFECTIVENESS',hash,{...result(saved),id:review.id,version:review.version,status:review.status});
 });
}
export async function decideQualityEffectiveness(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 identifier(id);const data=parse(qualityDecisionSchema,input);
 async function inspect(tx:Tx){await requireMember(tx,ctx,ADMIN);const review=await tx.qualityEffectiveness.findFirst({where:{id,organizationId:ctx.organizationId}});if(!review)throw new IntelligenceError('Effectiveness assessment not found in this organisation',404);
  const row=await record(tx,ctx,review.caseId),hash=requestHash(ctx,'DECIDE_EFFECTIVENESS',row.id,{...data,reviewId:id}),prior=await replay(tx,ctx,data.requestKey,'DECIDE_EFFECTIVENESS',row.id,hash);if(prior)return {row,review,hash,prior,current:null};
  unchanged(row,data.caseVersion);if(review.status!=='PENDING'||review.version!==data.version||review.cycle!==row.cycle)throw new IntelligenceError('The effectiveness assessment changed or was already decided',409);
  const state=await reviewState(tx,ctx,row,review);if(!state.current)throw new IntelligenceError(state.reason,409);
  const files=reviewedFilesSchema.parse(review.evidenceManifest),current=await basis(tx,ctx,row,files.map(file=>file.id),review.authorId);await independent(tx,ctx,row,review,current);
  if(data.decision==='PASSED'&&!qualityCanClose(review.observedAt.toISOString().slice(0,10),row.effectivenessDueAt?.toISOString()||null))throw new IntelligenceError('The planned effectiveness observation date has not been met. Record a later observation before closing.',409);
  const monitoring=await caseMonitoring(tx,ctx.organizationId,row.id);
  if(data.decision==='PASSED'&&monitoring && (monitoring.latest?.status!=='PASS'||!monitoring.latest.fresh))
   throw new IntelligenceError('A fresh passing observation of the original monitored check is required for a successful effectiveness decision.',409);
  const databaseMonitoring=await reviewedDatabaseRecovery(tx,ctx.organizationId,current.actions.map(action=>action.task.id));
  if(data.decision==='PASSED'&&databaseMonitoring.some(item=>!item.recovered))
   throw new IntelligenceError('A reviewed passing SQL receipt from the same source and rule must confirm every failed check before closure.',409);
  return {row,review,hash,prior:null,current,monitoring,databaseMonitoring};
 }
 const before=await transaction(ctx,inspect);if(before.prior)return before.prior;await verifyReviewedBytes(ctx,before.current!.verification,deps.storage);
 return transaction(ctx,async tx=>{const fresh=await inspect(tx);if(fresh.prior)return fresh.prior;if(fresh.current!.hash!==before.current!.hash||fresh.monitoring?.latest?.runId!==before.monitoring?.latest?.runId||hashValue(fresh.databaseMonitoring)!==hashValue(before.databaseMonitoring))throw new IntelligenceError('Case evidence changed during the decision. Refresh before deciding.',409);
  let review=await tx.qualityEffectiveness.update({where:{id,organizationId:ctx.organizationId},data:{status:data.decision,reviewerId:ctx.userId,reviewedAt:new Date(),reviewNotes:data.notes,version:{increment:1}}});
  review=await tx.qualityEffectiveness.update({where:{id,organizationId:ctx.organizationId},data:{decisionHash:decisionHash(review)}});
  const failed=data.decision==='FAILED',saved=await tx.qualityCase.update({where:{id:fresh.row.id,organizationId:ctx.organizationId},data:{status:failed?'REOPENED':'CLOSED',...(failed?{cycle:{increment:1},investigationNotes:'',rootCause:'',effectivenessCriteria:'',effectivenessDueAt:null}:{}),version:{increment:1}}});
  await event(tx,ctx,'effectiveness_decided',saved.id,{reviewId:id,cycle:review.cycle,nextCycle:saved.cycle,decision:data.decision,notes:data.notes,reviewerId:ctx.userId,...(fresh.monitoring?{monitoringAtDecision:fresh.monitoring}:{}),...(fresh.databaseMonitoring?.length?{sqlReceiptsAtDecision:fresh.databaseMonitoring}:{}),previous:caseBasis(fresh.row),version:saved.version});
  return remember(tx,ctx,data.requestKey,'DECIDE_EFFECTIVENESS',fresh.hash,{...result(saved),id,version:review.version,status:review.status});
 });
}
export async function reopenQualityCase(ctx:AuthorizedContext,id:string,input:unknown){
 const data=parse(qualityReopenSchema,input),occurredAt=pastDate(data.occurredAt),hash=requestHash(ctx,'REOPEN',id,data);
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await record(tx,ctx,id),prior=await replay(tx,ctx,data.requestKey,'REOPEN',id,hash);if(prior)return prior;unchanged(row,data.version,true);
  if(row.handoverRecipientId)throw new IntelligenceError('Resolve the outstanding handover before opening another investigation cycle',409);
  if(row.status!=='CLOSED'&&data.reason==='REASSESSMENT')throw new IntelligenceError('Only a closed case can be reopened for reassessment',409);
  if(row.status==='CLOSED'&&await tx.qualityCase.count({where:{organizationId:ctx.organizationId,status:{not:'CLOSED'}}})>=QUALITY_LIMIT)throw new IntelligenceError('This workspace has reached its 200-active-case quality pilot limit',409);
  if(occurredAt<row.occurredAt)throw new IntelligenceError('The new occurrence cannot precede the recorded occurrence',409);
  if(row.cycle>=40)throw new IntelligenceError('This case reached its forty-cycle history limit',409);
  await supersede(tx,ctx,id);const saved=await tx.qualityCase.update({where:{id,organizationId:ctx.organizationId},data:{status:'REOPENED',cycle:{increment:1},recurrenceCount:{increment:data.reason==='RECURRENCE'?1:0},occurredAt,impact:data.impact,containment:data.containment,investigationNotes:'',rootCause:'',effectivenessCriteria:'',effectivenessDueAt:null,version:{increment:1}}});
  await event(tx,ctx,'reopened',id,{reason:data.reason,notes:data.notes,previous:caseBasis(row),current:caseBasis(saved),version:saved.version});return remember(tx,ctx,data.requestKey,'REOPEN',hash,result(saved));
 });
}

export async function qualityWorkspace(ctx:AuthorizedContext,input:Partial<QualityQuery>={}){
 const query=parse(qualityQuerySchema,input);
 const output=await transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx),base={organizationId:ctx.organizationId},today=new Date(new Date().toISOString().slice(0,10)),where:Prisma.QualityCaseWhereInput={...base};
  if(query.status==='handover')where.handoverRecipientId=ctx.userId;else if(query.status==='closed')where.status='CLOSED';else if(query.status==='reopened')where.status='REOPENED';else if(query.status!=='all'){where.status={not:'CLOSED'};if(query.status==='due')where.effectivenessDueAt={lte:today};if(query.status==='overdue')where.effectivenessDueAt={lt:today};}
  if(query.q)where.OR=[{title:{contains:literal(query.q),mode:'insensitive'}},{description:{contains:literal(query.q),mode:'insensitive'}},{rootCause:{contains:literal(query.q),mode:'insensitive'}}];
  let recovery:null|{requestKey:string;found:boolean;receipt:Receipt|null;action:string|null}=null;
  if(query.requestKey){const operation=await tx.qualityOperation.findUnique({where:{organizationId_requestKey:{organizationId:ctx.organizationId,requestKey:query.requestKey}}});
   if(operation){if(operation.actorId!==ctx.userId)throw new IntelligenceError('This operation receipt belongs to another member',403);if(query.caseId&&query.caseId!==operation.caseId)throw new IntelligenceError('The operation does not match the linked case',409);const row=await record(tx,ctx,operation.caseId);if(['DECIDE_EFFECTIVENESS','REOPEN','LINK_TRAINING','REVIEW_STOCK'].includes(operation.action))await requireMember(tx,ctx,ADMIN);else if(['CREATE','OFFER_HANDOVER','ACCEPT_HANDOVER','CANCEL_HANDOVER'].includes(operation.action))await requireMember(tx,ctx,WRITER);else await editor(tx,ctx,row);const receipt=receiptSchema.safeParse(operation.result);if(!receipt.success||receipt.data.caseId!==operation.caseId||hashValue(operation.result)!==operation.resultHash)throw new IntelligenceError('The exact saved receipt could not be verified',409);recovery={requestKey:query.requestKey,found:true,receipt:receipt.data,action:operation.action};}
   else recovery={requestKey:query.requestKey,found:false,receipt:null,action:null};
  }
  let monitorSelection=null;
  if(query.monitorRunId||query.monitorCheckId){
   if(!query.monitorRunId||!query.monitorCheckId)throw new IntelligenceError('Choose both a monitoring receipt and its check');
   const ref={runId:query.monitorRunId,checkId:query.monitorCheckId};
   const linked=await caseForMonitor(tx,ctx.organizationId,ref);
   monitorSelection=linked?{source:(await caseMonitoring(tx,ctx.organizationId,linked.entityId))!.source,caseId:linked.entityId}:{source:await failedMonitor(tx,ctx.organizationId,ref),caseId:null};
  }
  const [total,groups,due,overdue,recurrences,memberRows,fileRows]=await Promise.all([tx.qualityCase.count({where}),tx.qualityCase.groupBy({by:['status'],where:base,_count:{_all:true}}),tx.qualityCase.count({where:{...base,status:{not:'CLOSED'},effectivenessDueAt:{lte:today}}}),tx.qualityCase.count({where:{...base,status:{not:'CLOSED'},effectivenessDueAt:{lt:today}}}),tx.qualityCase.count({where:{...base,recurrenceCount:{gt:0}}}),tx.membership.findMany({where:{...base,role:{in:['OWNER','ADMIN','EDITOR']}},orderBy:{userId:'asc'},take:201,select:{role:true,user:{select:{id:true,email:true}}}}),tx.evidence.findMany({where:{...base,scanStatus:'CLEAN',reviewStatus:'APPROVED'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:121,select:{id:true,filename:true,sha256:true,reviewVersion:true}})]);
  const pages=Math.max(1,Math.ceil(total/QUALITY_PAGE_SIZE)),page=Math.min(query.page,pages),rows=await tx.qualityCase.findMany({where,orderBy:[{effectivenessDueAt:'asc'},{updatedAt:'desc'},{id:'asc'}],skip:(page-1)*QUALITY_PAGE_SIZE,take:QUALITY_PAGE_SIZE,include:{owner:{select:{email:true}},_count:{select:{actions:true}}}}),summary={all:0,open:0,closed:0,reopened:0,due,overdue,recurrences};
  for(const group of groups){summary.all+=group._count._all;if(group.status==='CLOSED')summary.closed+=group._count._all;else summary.open+=group._count._all;if(group.status==='REOPENED')summary.reopened+=group._count._all;}
  const selectedId=query.caseId||recovery?.receipt?.caseId;let selected=null;
  if(selectedId){
   const row=await record(tx,ctx,selectedId),current=await basis(tx,ctx,row,[]),reviews=await tx.qualityEffectiveness.findMany({where:{...base,caseId:selectedId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:41}),reviewViews=[];
   for(const [index,review] of reviews.slice(0,40).entries()){const state=index===0?await reviewState(tx,ctx,row,review):{current:false,reason:'Historical assessment; a newer assessment is recorded.'},files=reviewedFilesSchema.safeParse(review.evidenceManifest);reviewViews.push({id:review.id,cycle:review.cycle,version:review.version,status:review.status,authorId:review.authorId,reviewerId:review.reviewerId,reviewedAt:review.reviewedAt,reviewNotes:review.reviewNotes,observedAt:review.observedAt,notes:review.notes,createdAt:review.createdAt,evidence:files.success?files.data:[],...state});}
   const latest=reviewViews[0],canEdit=WRITER.includes(actor.role)&&(ADMIN.includes(actor.role)||row.ownerId===ctx.userId||row.createdById===ctx.userId);let canReview=false;
   if(latest?.status==='PENDING'&&latest.current&&ADMIN.includes(actor.role)){try{const candidate=await basis(tx,ctx,row,latest.evidence.map(file=>file.id),latest.authorId);await independent(tx,ctx,row,reviews[0],candidate);canReview=true;}catch{canReview=false;}}
   const previousActions=await tx.qualityAction.findMany({where:{...base,caseId:row.id,cycle:{lt:row.cycle}},orderBy:[{cycle:'desc'},{createdAt:'asc'}],take:400,select:{id:true,cycle:true,kind:true,purpose:true,obligation:{select:{id:true,title:true,status:true,ownerName:true}}}});
   const history=await tx.auditEvent.findMany({where:{...base,entityType:'QualityCase',entityId:row.id},orderBy:[{createdAt:'asc'},{id:'asc'}],take:1001,select:{id:true,action:true,actorId:true,createdAt:true,details:true}});
   const monitoring=await caseMonitoring(tx,ctx.organizationId,row.id);
   const databaseMonitoring=await reviewedDatabaseRecovery(tx,ctx.organizationId,current.actions.map(action=>action.task.id));
   const canReadTrace=canEdit||ADMIN.includes(actor.role);
   const visibleHistory=history.slice(0,1000).map(item=>{
    if(canReadTrace||!item.details||typeof item.details!=='object'||Array.isArray(item.details)||!('sqlReceiptsAtDecision' in item.details))return item;
    const {sqlReceiptsAtDecision,...details}=item.details;
    return {...item,details};
   });
   selected={monitoring,databaseMonitoring:canReadTrace?databaseMonitoring:[],emailRecords:canEdit||ADMIN.includes(actor.role)?await qualityEmailRecords(tx,ctx,row.id):null,stockRecords:canEdit||ADMIN.includes(actor.role)?current.stockRecords:null,trainingRecords:ADMIN.includes(actor.role)?await qualityTrainingRecords(tx,ctx,row.id):null,canAcceptHandover:row.handoverRecipientId===ctx.userId&&WRITER.includes(actor.role),case:{...row,ownerName:(await tx.user.findUnique({where:{id:row.ownerId},select:{email:true}}))?.email||'Owner unavailable',href:href('/team/quality',ctx.organizationId,{caseId:row.id}),due:qualityDue(row.effectivenessDueAt?.toISOString()||null,row.status)},actions:current.actions.map(({proof,...action})=>action),previousActions:previousActions.map(({obligation,...action})=>({...action,task:{...obligation,href:href('/team/work',ctx.organizationId,{taskId:obligation.id})}})),reviews:reviewViews,latestReview:latest||null,canEdit:canEdit&&row.status!=='CLOSED',canReview,canReopen:ADMIN.includes(actor.role),closureCurrent:row.status==='CLOSED'&&latest?.status==='PASSED'&&latest.current&&databaseMonitoring.every(item=>item.recovered)&&(!monitoring||monitoring.latest?.status==='PASS'&&monitoring.latest.fresh),blockers:current.blockers,history:visibleHistory,historyLimited:history.length>1000,reviewsLimited:reviews.length>40};
  }
  const taskWhere:Prisma.ObligationWhereInput={...base,completionException:false,changeAction:null,auditRequest:null,accessItem:null};if(query.taskQ)taskWhere.OR=[{title:{contains:literal(query.taskQ),mode:'insensitive'}},{ownerName:{contains:literal(query.taskQ),mode:'insensitive'}}];
  if(selectedId&&selected)taskWhere.qualityActions={none:{caseId:selectedId,cycle:selected.case.cycle,organizationId:ctx.organizationId}};
  const taskTotal=await tx.obligation.count({where:taskWhere}),taskPages=Math.max(1,Math.ceil(taskTotal/QUALITY_PAGE_SIZE)),taskPage=Math.min(query.taskPage,taskPages),tasks=await tx.obligation.findMany({where:taskWhere,orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(taskPage-1)*QUALITY_PAGE_SIZE,take:QUALITY_PAGE_SIZE,select:{id:true,title:true,status:true,ownerName:true}});
  return {monitorSelection,organizationId:ctx.organizationId,userId:ctx.userId,role:actor.role,canWrite:WRITER.includes(actor.role),members:memberRows.slice(0,200).filter(member=>allowedEmail(member.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(member=>({...member.user,role:member.role})),membersLimited:memberRows.length>200,evidence:fileRows.slice(0,120),evidenceLimited:fileRows.length>120,items:rows.map(({owner,_count,...row})=>({...row,ownerName:owner.email,actionCount:_count.actions,href:href('/team/quality',ctx.organizationId,{caseId:row.id}),due:qualityDue(row.effectivenessDueAt?.toISOString()||null,row.status)})),total,page,pages,summary,selected,tasks:{items:tasks,total:taskTotal,page:taskPage,pages:taskPages},operationLookup:recovery,scope:QUALITY_SCOPE};
 });
 const latest=await db.$transaction(tx=>requireMember(tx,ctx));if(latest.role!==output.role)throw new IntelligenceError('Your workspace access changed. Reload the quality queue.',409);return output;
}
export async function exportQualityCase(ctx:AuthorizedContext,id:string){identifier(id);const workspace=await qualityWorkspace(ctx,{caseId:id});return {format:'regpilot-quality-case',version:1,exportedAt:new Date().toISOString(),organizationId:ctx.organizationId,scope:QUALITY_SCOPE,...workspace.selected};}
