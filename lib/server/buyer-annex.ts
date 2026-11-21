import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {buyerPartnerReceipt} from './customer-api-service';
import {requireMember,ADMIN} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {activeRoom,issuerActive} from './audit-disclosure';
type Tx=Prisma.TransactionClient;
const input=z.object({grantId:z.uuid(),observationId:z.uuid(),receiptHash:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)}).strict();
const entityType='BuyerPartnerAnnex';
export async function buyerAnnexOptions(c:AuthorizedContext,roomId:string,grantId:string){
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const grant=await tx.auditGrant.findFirst({where:{id:grantId,organizationId:c.organizationId,roomId,status:{in:['ACCEPTED','PENDING']}},include:{room:true}});
  if(!grant||!activeRoom(grant.room))throw new IntelligenceError('Named buyer invitation unavailable',404);
  const rows=await tx.customerApiObservation.findMany({where:{organizationId:c.organizationId,partnerKey:{not:null},supersededAt:null,status:'ACKNOWLEDGED',validUntil:{gt:new Date()},payload:{path:['partnerRecord','record','permittedBuyers'],array_contains:[grant.email]}},select:{id:true},orderBy:{receivedAt:'desc'},take:30});
  const receipts=await Promise.all(rows.map(r=>buyerPartnerReceipt(tx,c.organizationId,r.id,grant.email)));
  return {buyer:grant.email,receipts:receipts.filter(r=>r!==null)};
 });
}
export async function attachBuyerAnnex(c:AuthorizedContext,roomId:string,raw:unknown){
 const d=input.parse(raw);return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const g=await tx.auditGrant.findFirst({where:{id:d.grantId,organizationId:c.organizationId,roomId,status:{in:['ACCEPTED','PENDING']}},include:{room:true}});
  if(!g||!activeRoom(g.room)||!await issuerActive(tx,g.room))throw new IntelligenceError('Named buyer invitation unavailable',404);
  const r=await buyerPartnerReceipt(tx,c.organizationId,d.observationId,g.email);if(!r||r.receiptHash!==d.receiptHash)throw new IntelligenceError('Current source consent and an independently reviewed receipt are required for this buyer',409);
  const where={organizationId:c.organizationId,entityType,entityId:g.id,action:'buyer.annex_shared'};
  const existing=await tx.auditEvent.findFirst({where:{...where,details:{path:['receiptHash'],equals:r.receiptHash}}});if(existing)return {shared:true};
  if(await tx.auditEvent.count({where})>=30)throw new IntelligenceError('The invitation has reached its annex limit',429);
  await tx.auditEvent.create({data:{...where,actorId:c.userId,details:{observationId:r.id,receiptHash:r.receiptHash,roomId,buyer:g.email,grantPublicRevision:g.publicRevision}}});return {shared:true};
 });
}
export async function liveBuyerAnnex(tx:Tx,g:{id:string;organizationId:string;email:string;publicRevision:number|null}){
 const rows=await tx.auditEvent.findMany({where:{organizationId:g.organizationId,entityType,entityId:g.id,action:'buyer.annex_shared'},orderBy:{createdAt:'desc'},take:30});
 const live=[];
 for(const row of rows){
  const d=row.details as {observationId:string;receiptHash:string;buyer:string;grantPublicRevision:number|null};
  if(d.buyer!==g.email||d.grantPublicRevision!==g.publicRevision||!await issuerActive(tx,{organizationId:g.organizationId,createdById:row.actorId}))continue;
  const r=await buyerPartnerReceipt(tx,g.organizationId,d.observationId,g.email);if(r&&r.receiptHash===d.receiptHash)live.push(r);
 }
 return live;
}
