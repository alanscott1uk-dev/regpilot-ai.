import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import {ADMIN,requireMember} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {loadTrial} from './capability-trial-service';
import {softwareValidation} from './software-validation';

export const maxValidationArchive=256*1024;
const record=z.object({revision:z.string().regex(/^[a-f0-9]{40}$/),digest:z.string().regex(/^sha256:[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(maxValidationArchive),encoded:z.string().max(4*Math.ceil(maxValidationArchive/3)),runUrl:z.url(),downloadUrl:z.url()}).strict();
const digest=(bytes:Uint8Array)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function context(tx:Prisma.TransactionClient,ctx:AuthorizedContext,trialId:string){
 await requireMember(tx,ctx,ADMIN);
 const trial=await loadTrial(tx,ctx,trialId);
 if(trial.plan.track!=='site_qualification'||!trial.plan.siteProtocol)throw new IntelligenceError('A site qualification protocol is required.',404);
 const revision=trial.plan.release,where={organizationId:ctx.organizationId,entityType:'SupplierValidationArchive',entityId:revision,action:'validation.archive_retained'};
 const prior=await tx.auditEvent.findFirst({where,select:{id:true,createdAt:true,details:true}});
 if(!prior)return {revision,where,saved:null};
 const item=record.parse(prior.details),bytes=Buffer.from(item.encoded,'base64');
 if(item.revision!==revision||item.bytes!==bytes.length||digest(bytes)!==item.digest)throw new IntelligenceError('Retained software evidence failed its identity or integrity check.',409);
 return {revision,where,saved:{meta:{revision,digest:item.digest,size:bytes.length,runUrl:item.runUrl,retainedAt:prior.createdAt.toISOString(),receiptId:prior.id},bytes}};
}
export async function retainedValidation(ctx:AuthorizedContext,trialId:string){
 return transaction(ctx,async tx=>{const r=await context(tx,ctx,trialId);return {revision:r.revision,saved:r.saved};});
}
export async function retainValidation(ctx:AuthorizedContext,trialId:string,bytes:Buffer,verify=softwareValidation){
 const initial=await retainedValidation(ctx,trialId);
 if(!bytes.length||bytes.length>maxValidationArchive)throw new IntelligenceError('The validation archive must fit within 256 KiB.',413);
 const supplied=digest(bytes);
 if(initial.saved){if(initial.saved.meta.digest!==supplied)throw new IntelligenceError('This release already has a different retained archive.',409);return initial.saved.meta;}
 const source=await verify(initial.revision);
 if(source.state!=='AVAILABLE'||source.revision!==initial.revision||source.digest!==supplied)throw new IntelligenceError('This file does not match the available GitHub validation archive for the protocol release.',409);
 return transaction(ctx,async tx=>{
  const r=await context(tx,ctx,trialId);
  if(r.revision!==source.revision||r.saved&&r.saved.meta.digest!==supplied)throw new IntelligenceError('The retained release changed during verification.',409);
  if(r.saved)return r.saved.meta;
  const details=record.parse({revision:r.revision,digest:supplied,bytes:bytes.length,encoded:bytes.toString('base64'),runUrl:source.runUrl,downloadUrl:source.downloadUrl});
  const receipt=await tx.auditEvent.create({data:{...r.where,actorId:ctx.userId,details},select:{id:true,createdAt:true}});
  return {revision:r.revision,digest:supplied,size:bytes.length,runUrl:source.runUrl,retainedAt:receipt.createdAt.toISOString(),receiptId:receipt.id};
 });
}
