import {z} from 'zod';
import {Prisma,type QualityCase} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import {ADMIN,WRITER,requireMember} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';
import {verifiedObservation} from './connector-observation';
import {calibrationStillCurrent} from './logger-calibration';
import {readRecordKeys} from '../connectors/operational-records';
import {reviewedFiles,reviewedFilesSchema,assertReviewedFiles,verifyReviewedBytes} from './reviewed-files';
import type {EvidenceObjectStore} from './evidence-storage';

const text=z.string().trim().min(2).max(140);
const base={requestKey:z.uuid(),version:z.number().int().positive()};
const link=z.object({...base,action:z.literal('LINK'),runId:z.uuid(),site:text,stock:z.array(text).min(1).max(50).refine(a=>new Set(a).size===a.length),stockEvidenceId:z.uuid()}).strict();
const decide=z.object({...base,action:z.literal('DECIDE'),disposition:z.enum(['QUARANTINE','RETURN','REJECT','RELEASE']),sourceRef:text,signatory:text,
 decidedAt:z.iso.datetime(),rationale:z.string().trim().min(20).max(1500),decisionEvidenceId:z.uuid(),authorityEvidenceId:z.uuid(),confirmed:z.literal(true)}).strict();
const retrieve=z.object({...base,action:z.literal('RETRIEVE')}).strict();
export const excursionInput=z.discriminatedUnion('action',[link,decide,retrieve]);
const entityType='QualityExcursion';
const pack=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
type Tx=Prisma.TransactionClient;
const problem=(message:string)=>new IntelligenceError(message,409);
const basis=(r:QualityCase)=>({caseId:r.id,cycle:r.cycle,occurredOn:r.occurredAt.toISOString().slice(0,10),impact:r.impact,containment:r.containment,investigation:r.investigationNotes,rootCause:r.rootCause});
const attachment=z.object({runId:z.uuid(),connectorId:z.uuid(),resultHash:z.string(),signalHash:z.string(),channel:z.string(),serial:z.string(),sampleAt:z.iso.datetime(),temperature:z.string(),
 calibration:z.string(),calibrationApprovalId:z.uuid().optional(),calibrationApproverId:z.uuid().optional(),site:text,stock:z.array(text),stockEvidenceId:z.uuid(),files:reviewedFilesSchema});
const decision=z.object({disposition:decide.shape.disposition,sourceRef:text,signatory:text,decidedAt:z.iso.datetime(),rationale:z.string(),decisionEvidenceId:z.uuid(),authorityEvidenceId:z.uuid(),
 files:reviewedFilesSchema,basisHash:z.string(),attachmentHash:z.string(),investigation:z.string(),rootCause:z.string()});
const envelope=z.object({cycle:z.number(),requestHash:z.string(),body:z.unknown(),digest:z.string()});
async function caseRow(tx:Tx,c:AuthorizedContext,id:string){
 const row=await tx.qualityCase.findFirst({where:{organizationId:c.organizationId,id}});
 if(!row)throw new IntelligenceError('Quality case unavailable',404);
 return row;
}
async function records(tx:Tx,row:QualityCase){
 const where={organizationId:row.organizationId,entityType,entityId:row.id,details:{path:['cycle'],equals:row.cycle}};
 const events=await tx.auditEvent.findMany({where,orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,action:true,actorId:true,createdAt:true,details:true},take:103});
 function validated<S extends z.ZodType>(name:string,schema:S){
  const e=events.find(e=>e.action===name);if(!e)return null;
  const p=envelope.safeParse(e.details);if(!p.success||p.data.digest!==hashValue(p.data.body))throw problem('Stored excursion evidence failed its integrity check.');
  return {id:e.id,actorId:e.actorId,at:e.createdAt.toISOString(),hash:p.data.digest,data:schema.parse(p.data.body) as z.infer<S>};
 }
 return {reading:validated('excursion.link',attachment),disposition:validated('excursion.decide',decision),
  retrieved:events.filter(e=>e.action==='excursion.retrieve').map(e=>({id:e.id,actorId:e.actorId,at:e.createdAt.toISOString()}))};
}
async function checkSource(tx:Tx,row:QualityCase,reading:z.infer<typeof attachment>){
 const run=await tx.connectorRun.findFirst({where:{organizationId:row.organizationId,connectorId:reading.connectorId,id:reading.runId}});
 if(!run||run.resultHash!==reading.resultHash||run.signalHash!==reading.signalHash||!verifiedObservation(run))throw problem('The linked logger reading could not be verified.');
 await assertReviewedFiles(tx,row.organizationId,reading.files);
}
export async function excursionWorkspace(c:AuthorizedContext,id:string){
 return transaction(c,async tx=>{
  const actor=await requireMember(tx,c),row=await caseRow(tx,c,id);
  if(!ADMIN.includes(actor.role)&&row.ownerId!==c.userId&&row.createdById!==c.userId)throw new IntelligenceError('Excursion evidence is restricted to the case team.',403);
  const chain=await records(tx,row);
  let issue:string|null=null;
  try{if(chain.reading)await checkSource(tx,row,chain.reading.data);
   if(chain.disposition){await assertReviewedFiles(tx,c.organizationId,chain.disposition.data.files);
    if(chain.disposition.data.attachmentHash!==chain.reading?.hash||chain.disposition.data.basisHash!==hashValue(basis(row)))throw problem('The investigation has changed since disposition. Review the signed source record.');}
  }catch(e){if(!(e instanceof IntelligenceError))throw e;issue=e.message;}
  return {caseId:id,version:row.version,cycle:row.cycle,...chain,issue};
 });
}
export async function excursionCommand(c:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 const d=excursionInput.parse(raw),action='excursion.'+d.action.toLowerCase(),requestHash=hashValue({id,input:d});
 const prepare=async(tx:Tx)=>{
  const member=await requireMember(tx,c,d.action==='LINK'?WRITER:ADMIN),row=await caseRow(tx,c,id);
  if(!ADMIN.includes(member.role)&&row.ownerId!==c.userId&&row.createdById!==c.userId)throw new IntelligenceError('The investigator must link this reading.',403);
  const prior=await tx.auditEvent.findUnique({where:{id:d.requestKey}});
  if(prior&&(prior.organizationId!==c.organizationId||prior.actorId!==c.userId||prior.entityType!==entityType||prior.entityId!==id||prior.action!==action||envelope.safeParse(prior.details).data?.requestHash!==requestHash))throw problem('This request reference is already in use.');
  if(!prior&&row.version!==d.version)throw problem('The investigation changed. Refresh this case.');
  const chain=await records(tx,row);
  if(row.kind!=='DEVIATION'||(d.action!=='RETRIEVE'&&row.status==='CLOSED'&&!prior))throw problem('Select an open deviation for this investigation.');
  if(d.action==='LINK'){
   if(prior&&chain.reading?.id===prior.id)return {row,prior,body:chain.reading.data,files:chain.reading.data.files};
   if(chain.reading||prior)throw problem('An excursion has already been linked in this investigation cycle.');
   const run=await tx.connectorRun.findFirst({where:{id:d.runId,organizationId:c.organizationId,connector:{provider:'UBIBOT'}},include:{connector:true}});
   const obs=verifiedObservation(run);const sample=obs?.checks.find(x=>x.id==='logger-fresh'&&x.status==='PASS');
   const temp=obs?.checks.find(x=>x.id==='logger-temperature'&&x.status==='FAIL'),cert=obs?.checks.find(x=>x.id==='logger-calibration'&&x.status==='PASS');
   if(!run||!obs||!sample||!temp||!cert||run.configVersion!==run.connector.version||!await calibrationStillCurrent(tx,run.connector,obs))throw problem('Select an out-of-range reading with a verified instrument and reviewed calibration.');
   const {scope,record,reference}=readRecordKeys('UBIBOT',run.connector.repository,run.connector.branch),certId=reference!.split('/')[0];
   const approvalId=cert.observed.split(' · instrument review ').at(-1);
   const approval=z.uuid().safeParse(approvalId);
   const instrument=approval.success?await tx.auditEvent.findFirst({where:{id:approval.data,organizationId:c.organizationId,entityType:'EvidenceConnector',entityId:run.connectorId,action:'logger.calibration-approved'},select:{actorId:true}}):null;
   if(!instrument?.actorId)throw problem('A verified instrument review is required for this reading.');
   const sampleDate=new Date(sample.observed);
   const ukDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(sampleDate);
   if(ukDay!==basis(row).occurredOn)throw problem('Choose a reading from the UK occurrence date recorded on this deviation.');
   if(certId===d.stockEvidenceId)throw problem('Select separate evidence identifying the affected stock.');
   const files=await reviewedFiles(tx,c.organizationId,[certId,d.stockEvidenceId]);
   const body=attachment.parse({runId:run.id,connectorId:run.connectorId,resultHash:run.resultHash,signalHash:run.signalHash,channel:scope,serial:record,sampleAt:sample.observed,
    temperature:temp.observed,calibration:cert.observed,calibrationApprovalId:approvalId,calibrationApproverId:instrument.actorId,site:d.site,stock:d.stock,stockEvidenceId:d.stockEvidenceId,files});
   return {row,prior,body,files};
  }
  if(!chain.reading)throw problem('Link the calibrated reading and affected stock first.');
  await checkSource(tx,row,chain.reading.data);
  if(d.action==='DECIDE'){
   if(prior&&chain.disposition?.id===prior.id)return {row,prior,body:chain.disposition.data,files:chain.disposition.data.files};
   if(chain.disposition||prior)throw problem('This cycle already has a disposition.');
   if(chain.reading.actorId===c.userId||!row.investigationNotes.trim()||!row.rootCause.trim())throw problem('Complete the investigation and have a separate quality administrator verify the authorised disposition.');
   if(Date.parse(d.decidedAt)<Date.parse(chain.reading.data.sampleAt)||Date.parse(d.decidedAt)>Date.now())throw problem('The signed decision time must fall between the reading and now.');
   const docIds=[d.decisionEvidenceId,d.authorityEvidenceId];if(new Set([...docIds,...chain.reading.data.files.map(f=>f.id)]).size!==docIds.length+chain.reading.data.files.length)throw problem('Choose separate signed decision and delegation records.');
   const files=await reviewedFiles(tx,c.organizationId,docIds);
   const body=decision.parse({...d,files,basisHash:hashValue(basis(row)),attachmentHash:chain.reading.hash,investigation:row.investigationNotes,rootCause:row.rootCause});
   return {row,prior,body,files:[...chain.reading.data.files,...files]};
  }
  const decided=chain.disposition;
  if(!decided||decided.data.basisHash!==hashValue(basis(row))||decided.data.attachmentHash!==chain.reading.hash)throw problem('A current, verified disposition is required for independent retrieval.');
  if(!chain.reading.data.calibrationApproverId)throw problem('The independent instrument reviewer is missing from this record.');
  if([row.createdById,row.ownerId,decided.actorId,chain.reading.actorId,chain.reading.data.calibrationApproverId,...chain.reading.data.files.flatMap(f=>[f.uploadedById,f.reviewerId]),...decided.data.files.flatMap(f=>[f.uploadedById,f.reviewerId])].includes(c.userId))throw new IntelligenceError('A separate assessor must retrieve the investigation.',403);
  await assertReviewedFiles(tx,c.organizationId,decided.data.files);
  return {row,prior,body:{reading:chain.reading,disposition:decided,investigation:basis(row)},files:[...chain.reading.data.files,...decided.data.files]};
 };
 const first=await transaction(c,prepare);
 await verifyReviewedBytes(c,first.files,store);
 return transaction(c,async tx=>{
  const checked=await prepare(tx);
  if(hashValue(checked.body)!==hashValue(first.body))throw problem('The evidence changed during verification.');
  const digest=hashValue(checked.body);
  if(!checked.prior){
   if(d.action==='RETRIEVE'){
    const existing=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,entityId:id,actorId:c.userId,action,details:{path:['digest'],equals:digest}},select:{id:true}});
    if(existing)return {receiptId:existing.id,caseId:id,cycle:checked.row.cycle,digest,record:checked.body};
   }else{
    const saved=await tx.qualityCase.updateMany({where:{organizationId:c.organizationId,id,version:d.version},data:{version:{increment:1}}});
    if(saved.count!==1)throw problem('Refresh the investigation before recording this change.');
    await tx.qualityEffectiveness.updateMany({where:{organizationId:c.organizationId,caseId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
   }
   await tx.auditEvent.create({data:{id:d.requestKey,organizationId:c.organizationId,entityId:id,entityType,actorId:c.userId,action,details:pack({requestHash,cycle:checked.row.cycle,digest,body:checked.body})}});
  }
  return {receiptId:d.requestKey,caseId:id,cycle:checked.row.cycle,digest,record:checked.body};
 });
}
