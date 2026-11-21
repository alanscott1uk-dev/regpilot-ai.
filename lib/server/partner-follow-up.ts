import {z} from 'zod';
import type {Prisma,CustomerApiObservation} from '@prisma/client';
import {customerObservationInput} from '../customer-api';
import {internalPartnerView} from './customer-api-service';
import {hashValue} from '../regulatory/intelligence';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import type {AuthorizedContext} from './authorization';
type Tx=Prisma.TransactionClient;
const entityType='PartnerModelBinding';
const binding=z.object({systemId:z.uuid(),systemRef:z.string(),vendorRef:z.string(),vendorId:z.uuid(),credentialId:z.uuid(),controlId:z.uuid()});
const series=(row:CustomerApiObservation)=>hashValue([row.credentialId,row.controlId,row.partnerKey]);
const bindAction=z.object({systemId:z.uuid(),systemVersion:z.number().int().positive(),receiptHash:z.string().length(64),confirm:z.literal(true)}).strict();
function modelRecord(row:CustomerApiObservation){
 const parsed=customerObservationInput.safeParse(row.payload);if(!parsed.success||hashValue(parsed.data)!==row.payloadHash)return null;
 const source=parsed.data.partnerRecord;
 return source&&source.record.kind==='MODEL_CHANGE'?{source,r:source.record}:null;
}
export async function advanceBoundModel(tx:Tx,row:CustomerApiObservation){
 const model=modelRecord(row);if(!model||!row.partnerKey)return;
 const mapped=await tx.auditEvent.findFirst({where:{organizationId:row.organizationId,entityType,entityId:series(row),action:'model.bound'}});
 if(!mapped)return;const b=binding.parse(mapped.details);
 const system=await tx.aiSystem.findFirst({where:{id:b.systemId,organizationId:row.organizationId,controlId:b.controlId,vendorId:b.vendorId},include:{vendor:true,control:true}});
 if(!system||!system.vendor?.active||!system.control?.enabled)return;
 try{await requireMember(tx,{organizationId:row.organizationId,userId:mapped.actorId,role:'ADMIN'},ADMIN);}catch(e){if(e instanceof IntelligenceError)return;throw e;}
 const where={organizationId:row.organizationId,entityType:'AiSystem',entityId:system.id,action:'ai-system.partner-reassessment'};
 if(await tx.auditEvent.findFirst({where:{...where,details:{path:['receiptHash'],equals:row.payloadHash}}}))return;
 const consistent=b.vendorRef===model.r.vendorRef&&b.systemRef===model.r.systemRef;
 const changed=await tx.aiSystem.update({where:{id:system.id},data:{version:{increment:1},...(consistent&&!system.bomSerial?{componentVersion:model.r.modelVersion}:{})}});
 // The binding administrator approved this automation. The event identifies the machine source separately.
 await tx.auditEvent.create({data:{...where,actorId:mapped.actorId,details:{observationId:row.id,credentialId:row.credentialId,receiptHash:row.payloadHash,previousVersion:system.version,version:changed.version,reportedModel:model.r.modelRef,reportedVersion:model.r.modelVersion,state:model.source.state,controlId:b.controlId,vendorId:b.vendorId,consistent,trigger:'PARTNER_RECORD'}}});
}
export async function bindPartnerModel(ctx:AuthorizedContext,id:string,raw:unknown){
 const d=bindAction.parse(raw);return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.customerApiObservation.findFirst({where:{id,organizationId:ctx.organizationId,partnerKey:{not:null}}});
  const model=row&&modelRecord(row);
  const reviewed=row&&await internalPartnerView(tx,ctx.organizationId,id);
  if(!row||!model||!reviewed?.current||reviewed.receiptHash!==d.receiptHash||!['ACKNOWLEDGED','FOLLOW_UP'].includes(reviewed.status)){
   throw new IntelligenceError('Current reviewed model source required',409);
  }
  const system=await tx.aiSystem.findFirst({where:{id:d.systemId,organizationId:ctx.organizationId,controlId:row.controlId,vendorId:{not:null},vendor:{active:true},control:{enabled:true}}});
  if(!system)throw new IntelligenceError('Choose a system and active vendor governed by this source control',409);
  const where={organizationId:ctx.organizationId,entityType,entityId:series(row),action:'model.bound'},existing=await tx.auditEvent.findFirst({where});
  if(existing){if(binding.parse(existing.details).systemId!==system.id)throw new IntelligenceError('This source series is already bound to another system',409);return {id:system.id};}
  const otherSource=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType,action:'model.bound',details:{path:['systemId'],equals:system.id}}});
  if(otherSource)throw new IntelligenceError('This system already has an authoritative model source',409);
  if(system.version!==d.systemVersion)throw new IntelligenceError('The AI system changed. Refresh the inventory.',409);
  await tx.auditEvent.create({data:{...where,actorId:ctx.userId,details:{systemId:system.id,vendorId:system.vendorId!,systemRef:model.r.systemRef,vendorRef:model.r.vendorRef,credentialId:row.credentialId,controlId:row.controlId}}});
  await advanceBoundModel(tx,row);return {id:system.id};
 });
}
export async function partnerFollowUp(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const r=await tx.customerApiObservation.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!r)throw new IntelligenceError('Partner observation unavailable',404);
  const model=modelRecord(r),map=model?await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType,entityId:series(r),action:'model.bound'}}):null;
  const systems=model?await tx.aiSystem.findMany({where:{organizationId:ctx.organizationId,controlId:r.controlId,vendor:{active:true}},select:{id:true,name:true,version:true,vendor:{select:{name:true}}},take:100}):[];
  const qualityActions=r.followUpTaskId?await tx.qualityAction.findMany({where:{organizationId:ctx.organizationId,obligationId:r.followUpTaskId},select:{id:true,qualityCase:{select:{id:true,title:true,version:true,status:true}},cycle:true},take:20}):[];
  const cases=r.followUpTaskId?await tx.qualityCase.findMany({where:{organizationId:ctx.organizationId,status:{not:'CLOSED'}},select:{id:true,title:true,version:true},orderBy:{updatedAt:'desc'},take:100}):[];
  return {boundSystemId:map?binding.parse(map.details).systemId:null,systems,cases,qualityActions};
 });
}

export const modelChangeReceipt=z.object({observationId:z.uuid(),receiptHash:z.string().length(64),reportedModel:z.string(),reportedVersion:z.string(),version:z.number(),controlId:z.uuid(),vendorId:z.uuid(),state:z.string(),consistent:z.boolean()});
export async function modelReceiptCurrent(tx:Tx,org:string,raw:unknown,system:{controlId:string|null;vendorId:string|null}){
 const detail=modelChangeReceipt.safeParse(raw);
 if(!detail.success||!detail.data.consistent||detail.data.state!=='CURRENT')return false;
 if(detail.data.controlId!==system.controlId||detail.data.vendorId!==system.vendorId)return false;
 const r=await internalPartnerView(tx,org,detail.data.observationId);
 return !!r?.current&&r.receiptHash===detail.data.receiptHash&&r.status==='ACKNOWLEDGED'&&r.reportedOutcome==='REPORTED_PASS';
}
