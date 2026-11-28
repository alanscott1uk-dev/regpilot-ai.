import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import type {AuthorizedContext} from './authorization';
import {ADMIN,WRITER,requireMember} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {coverageSample,measureCoverage} from '../horizon/coverage-sample';
import {hashValue} from '../regulatory/intelligence';
import {readPublicHorizon} from './horizon-service';

const entityType='PublicationCoverageSample';
const input=z.discriminatedUnion('action',[z.object({action:z.literal('SEAL'),id:z.uuid(),sample:coverageSample}).strict(),z.object({action:z.literal('SCORE'),id:z.uuid(),confirmed:z.literal(true)}).strict()]);
type Result=ReturnType<typeof measureCoverage>;
const query=(ctx:AuthorizedContext,id:string)=>({organizationId:ctx.organizationId,entityType,entityId:id});
export async function recordPublicationSample(ctx:AuthorizedContext,raw:unknown,load=readPublicHorizon){
 const action=input.parse(raw),where=query(ctx,action.id);
 if(action.action==='SEAL')return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const prior=await tx.auditEvent.findFirst({where:{...where,action:'sample.sealed'}});
  if(prior){if(prior.actorId!==ctx.userId||hashValue(prior.details)!==hashValue(action.sample))throw new IntelligenceError('The sealed sample cannot be edited.',409);return {id:action.id};}
  if(await tx.auditEvent.count({where:{organizationId:ctx.organizationId,entityType,action:'sample.sealed'}})>=100)throw new IntelligenceError('The workspace already has 100 sampled sets.',429);
  await tx.auditEvent.create({data:{...where,actorId:ctx.userId,action:'sample.sealed',details:action.sample}});return {id:action.id};
 });
 async function check(tx:Prisma.TransactionClient){
  await requireMember(tx,ctx,ADMIN);const prior=await tx.auditEvent.findFirst({where:{...where,action:'sample.sealed'}});
  if(!prior)throw new IntelligenceError('Sample unavailable.',404);
  if(prior.actorId===ctx.userId)throw new IntelligenceError('Another administrator must check the source list.',403);
  const scored=await tx.auditEvent.findFirst({where:{...where,action:'sample.scored'}});return {prior,scored};
 }
 const before=await transaction(ctx,check);if(before.scored)return {id:action.id};
 const report=await load();const result=measureCoverage(coverageSample.parse(before.prior.details),report);
 return transaction(ctx,async tx=>{const {prior,scored}=await check(tx);if(scored)return {id:action.id};
  if(hashValue(prior.details)!==hashValue(before.prior.details))throw new IntelligenceError('The sample changed.',409);
  await tx.auditEvent.create({data:{...where,actorId:ctx.userId,action:'sample.scored',details:{sampleHash:hashValue(prior.details),result}}});return {id:action.id};
 });
}
export async function publicationSamples(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx),events=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType},orderBy:[{createdAt:'desc'},{id:'desc'}],take:200});
  return {canSeal:WRITER.includes(actor.role),samples:events.filter(e=>e.action==='sample.sealed').map(e=>{
   const decision=events.find(r=>r.entityId===e.entityId&&r.action==='sample.scored');
   const data=decision?.details as {sampleHash?:string;result?:Result}|undefined;
   if(decision&&(!data?.result||data.sampleHash!==hashValue(e.details)))throw new IntelligenceError('The scored sample does not match the sealed source list.',409);
   return {id:e.entityId,sample:coverageSample.parse(e.details),sealedAt:e.createdAt.toISOString(),scoredAt:decision?.createdAt.toISOString()??null,result:data?.result??null,canScore:!decision&&e.actorId!==ctx.userId&&ADMIN.includes(actor.role)};
  })};
 });
}
