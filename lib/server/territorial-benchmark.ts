import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {factsSchema,evaluateDatedRule} from '../library/applicability';
import {TERRITORIES} from '../regulatory/source-coverage';
import {hashValue} from '../regulatory/intelligence';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {revisionContext} from './library-service';
import {IntelligenceError,transaction} from './intelligence-service';
import type {AuthorizedContext} from './authorization';

const outcome=z.enum(['MATCH','NO_MATCH','UNKNOWN']);
const spec=z.object({revisionId:z.uuid(),nation:z.enum(TERRITORIES),activity:z.string().trim().min(4).max(150),on:z.iso.date(),facts:factsSchema,expected:outcome,rationale:z.string().trim().min(20).max(500)}).strict();
const action=z.discriminatedUnion('action',[z.object({action:z.literal('PROPOSE'),id:z.uuid(),spec}).strict(),z.object({action:z.literal('VALIDATE'),id:z.uuid(),decision:z.enum(['ACCEPT','REJECT'])}).strict()]);
const frozen=z.object({spec,sourceHash:z.string().length(64),contentHash:z.string().length(64),sourceName:z.string(),ref:z.string(),edition:z.number().int().positive()});
const entityType='TerritorialReference';
async function contextFor(tx:Prisma.TransactionClient,c:AuthorizedContext,id:string){
 const r=await revisionContext(tx,c,id);
 if(!r.current||!r.content?.rule||r.provenance?.type!=='PUBLICATION')throw new IntelligenceError('Choose a current approved rule backed by an official publication',409);
 return {content:r.content,sourceHash:r.revision.provenanceHash,contentHash:r.revision.contentHash,sourceName:r.provenance.name,ref:r.revision.requirement.reference,edition:r.revision.number};
}
export async function changeTerritorialCase(c:AuthorizedContext,raw:unknown){
 const d=action.parse(raw);
 return transaction(c,async tx=>{
  await requireMember(tx,c,d.action==='PROPOSE'?WRITER:ADMIN);
  const where={organizationId:c.organizationId,entityType,entityId:d.id},prior=await tx.auditEvent.findFirst({where:{...where,action:'territory.proposed'}});
  if(d.action==='PROPOSE'){
   if(prior){if(prior.actorId!==c.userId||hashValue(frozen.parse(prior.details).spec)!==hashValue(d.spec))throw new IntelligenceError('Reference identifier is already in use',409);return {id:d.id};}
   if(await tx.auditEvent.count({where:{organizationId:c.organizationId,entityType,action:'territory.proposed'}})>=200)throw new IntelligenceError('The workspace supports 200 held-out references',429);
   const {content:_,...basis}=await contextFor(tx,c,d.spec.revisionId);
   await tx.auditEvent.create({data:{...where,actorId:c.userId,action:'territory.proposed',details:{spec:d.spec,...basis}}});return {id:d.id};
  }
  if(!prior)throw new IntelligenceError('Reference case unavailable',404);
  if(prior.actorId===c.userId)throw new IntelligenceError('A different administrator must validate the expected outcome',403);
  const existing=await tx.auditEvent.findFirst({where:{...where,action:'territory.reviewed'}});
  if(existing){if(existing.actorId!==c.userId||(existing.details as {decision:string}).decision!==d.decision)throw new IntelligenceError('This reference has already been decided',409);return {id:d.id};}
  const s=frozen.parse(prior.details),r=await contextFor(tx,c,s.spec.revisionId);
  if(r.sourceHash!==s.sourceHash||r.contentHash!==s.contentHash)throw new IntelligenceError('The source edition or rule changed',409);
  await tx.auditEvent.create({data:{...where,actorId:c.userId,action:'territory.reviewed',details:{decision:d.decision}}});return {id:d.id};
 });
}
export async function territorialReport(c:AuthorizedContext){
 return transaction(c,async tx=>{
  const actor=await requireMember(tx,c),where={organizationId:c.organizationId,entityType};
  const [events,revisions]=await Promise.all([tx.auditEvent.findMany({where,orderBy:{createdAt:'desc'},take:400}),tx.libraryRevision.findMany({where:{organizationId:c.organizationId,status:'ACCEPTED'},orderBy:{reviewedAt:'desc'},select:{id:true,number:true,provenance:true,requirement:{select:{reference:true,currentRevision:true}}},take:100})]);
  const cases=[];const metrics={scored:0,correct:0,missedApplicable:0,falseAlerts:0,unknown:0,stale:0};
  for(const e of events.filter(e=>e.action==='territory.proposed')){
   const s=frozen.parse(e.details),review=events.find(v=>v.entityId===e.entityId&&v.action==='territory.reviewed'),recorded=(review?.details as {decision?:string}|null)?.decision;
   let predicted:'MATCH'|'NO_MATCH'|'UNKNOWN'|null=null,status=recorded??'PENDING';
   if(review&&recorded==='ACCEPT')try{
    await requireMember(tx,{...c,userId:review.actorId},ADMIN);const r=await contextFor(tx,c,s.spec.revisionId);
    if(r.sourceHash!==s.sourceHash||r.contentHash!==s.contentHash)throw new IntelligenceError('Source edition changed',409);
    predicted=evaluateDatedRule(r.content.rule,s.spec.facts,[s.spec.nation],s.spec.on,r.content.effectivity).state;
    metrics.scored++;if(predicted===s.spec.expected)metrics.correct++;if(s.spec.expected==='MATCH'&&predicted!=='MATCH')metrics.missedApplicable++;if(s.spec.expected!=='MATCH'&&predicted==='MATCH')metrics.falseAlerts++;if(predicted==='UNKNOWN')metrics.unknown++;
   }catch(err){if(!(err instanceof IntelligenceError))throw err;status='STALE';metrics.stale++;}
   cases.push({id:e.entityId,...s,status,predicted,canReview:status==='PENDING'&&ADMIN.includes(actor.role)&&e.actorId!==c.userId});
  }
  return {canPropose:WRITER.includes(actor.role),revisions:revisions.filter(r=>r.number===r.requirement.currentRevision&&(r.provenance as {type?:string})?.type==='PUBLICATION').map(r=>({id:r.id,reference:r.requirement.reference,edition:r.number})),cases,metrics};
 });
}
