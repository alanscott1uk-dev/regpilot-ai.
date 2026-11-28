import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {brokerId} from '../connectors/hosted-oauth';
import {accountingConfig,readAccountingBill,type BillObservation} from '../connectors/accounting-oauth';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';

const ledger=z.enum(['xero','quickbooks']);
const billKey=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('xero'),business:z.uuid().toLowerCase(),externalId:z.uuid().toLowerCase()}),
 z.object({provider:z.literal('quickbooks'),business:z.string().regex(/^\d{1,30}$/),externalId:z.string().regex(/^\d{1,30}$/)})
]);
const input=z.object({riskId:z.uuid(),riskVersion:z.number().int().positive(),requestKey:z.uuid(),provider:ledger,connectionId:brokerId,business:z.string(),externalId:z.string()}).strict();
const observation=z.union([z.object({issuedOn:z.iso.date(),grossPence:z.number().int().positive().max(99999999999)}),z.object({reason:z.string().min(1).max(160)})]);
const saved=z.object({provider:ledger,business:z.string(),externalId:z.string(),connectionId:brokerId,bindingId:z.uuid(),riskId:z.uuid(),riskVersion:z.number().int().positive(),checkedAt:z.iso.datetime(),observation,requestHash:z.string(),digest:z.string()});
const type='RiskTreatmentBill',action='risk.bill-checked';
const identity=(provider:string,business:string,externalId:string)=>hashValue({provider,business,externalId});
const latest=[{createdAt:'desc'},{id:'desc'}] satisfies Prisma.AuditEventOrderByWithRelationInput[];
function readReceipt(raw:unknown,org:string,entityId:string){
 const parsed=saved.safeParse(raw);
 if(!parsed.success)return null;
 const {digest,...basis}=parsed.data;
 if(identity(basis.provider,basis.business,basis.externalId)!==entityId||hashValue({organizationId:org,...basis})!==digest)return null;
 return parsed.data;
}
export async function checkRiskBill(ctx:AuthorizedContext,raw:unknown,fetcher:typeof fetch=fetch){
 const fields=input.parse(raw),d={...fields,...billKey.parse(fields)},org=ctx.organizationId;
 const entityId=identity(d.provider,d.business,d.externalId),requestHash=hashValue({...d,actor:ctx.userId});
 async function state(tx:Prisma.TransactionClient){
  await requireMember(tx,ctx,ADMIN);
  const company=await tx.organization.findUniqueOrThrow({where:{id:org},select:{accountShortcuts:true}});
  if(!company.accountShortcuts.includes(d.provider))throw new IntelligenceError('Add the accounting package to this workspace first.',409);
  const risk=await tx.riskRecord.findFirst({where:{organizationId:org,id:d.riskId},select:{version:true,status:true}});
  if(!risk||risk.version!==d.riskVersion||risk.status==='ARCHIVED')throw new IntelligenceError('Open the current active risk before linking a bill.',409);
  const binding=await tx.auditEvent.findFirst({where:{organizationId:org,entityType:'AccountingConnection',entityId:d.provider+':'+d.connectionId},orderBy:latest,select:{id:true,action:true,details:true}});
  const reference=z.object({reference:z.string()}).safeParse(binding?.details).data?.reference;
  if(binding?.action!=='workspace.accounting_business_checked'||(d.provider==='xero'?reference?.toLowerCase():reference)!==d.business)
   throw new IntelligenceError('Verify this business on the accounting connection first.',409);
  const previous=await tx.auditEvent.findFirst({where:{organizationId:org,entityType:type,entityId,action},orderBy:latest,select:{id:true,details:true}});
  if(previous&&readReceipt(previous.details,org,entityId)?.riskId!==d.riskId)throw new IntelligenceError('This bill already has a different risk allocation or an unverifiable history.',409);
  const existing=await tx.auditEvent.findUnique({where:{id:d.requestKey}});
  const receipt=existing?.organizationId===org&&existing.entityType===type&&existing.entityId===entityId?readReceipt(existing.details,org,entityId):null;
  if(existing&&(receipt?.requestHash!==requestHash||receipt.bindingId!==binding.id||previous?.id!==existing.id))throw new IntelligenceError('This check has changed. Start a fresh bill check.',409);
  return {bindingId:binding.id,previous:previous?.id,receipt};
 }
 const before=await transaction(ctx,state);
 if(before.receipt)return before.receipt;
 const config=accountingConfig(d.provider);
 if(!config)throw new IntelligenceError('Accounting reads await provider configuration.',503);
 let result:BillObservation;
 try{result=await readAccountingBill(org,d.provider,d.connectionId,d.business,d.externalId,config,fetcher);}
 catch{
  if(!before.previous)throw new IntelligenceError('The provider could not confirm this bill for the selected business.',502);
  result={reason:'The latest provider check could not confirm this bill'};
 }
 const basis={provider:d.provider,business:d.business,externalId:d.externalId,connectionId:d.connectionId,bindingId:before.bindingId,
  riskId:d.riskId,riskVersion:d.riskVersion,requestHash,checkedAt:new Date().toISOString(),observation:result};
 const receipt={...basis,digest:hashValue({organizationId:org,...basis})};
 return transaction(ctx,async tx=>{
  const current=await state(tx);
  if(current.receipt)return current.receipt;
  if(current.bindingId!==before.bindingId||current.previous!==before.previous)throw new IntelligenceError('A newer check was saved. Recheck the bill against the current record.',409);
  await tx.auditEvent.create({data:{id:d.requestKey,actorId:ctx.userId,organizationId:org,action,entityType:type,entityId,details:receipt}});
  return receipt;
 });
}

export const reportMonth=z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/);
export function previousMonth(month:string){
 const at=new Date(reportMonth.parse(month)+'-01T00:00:00Z');
 at.setUTCMonth(at.getUTCMonth()-1);
 return at.toISOString().slice(0,7);
}
type SourceRow={id:string;entityId:string;details:unknown;bindingId:string|null;bindingAction:string|null};
export async function riskBillSample(tx:Prisma.TransactionClient,organizationId:string,packages:string[],risks:{id:string;version:number;title:string}[],month:string){
 const prior=previousMonth(month);
 // Choose the most recent check for each source bill before applying either period.
 const records=await tx.$queryRaw<SourceRow[]>`
  WITH bills AS (SELECT DISTINCT ON ("entityId") id,"entityId",details FROM "AuditEvent" WHERE "organizationId"=${organizationId}::uuid
    AND "entityType"=${type} AND action=${action} ORDER BY "entityId","createdAt" DESC,id DESC LIMIT 201)
  SELECT b.*,c.id AS "bindingId",c.action AS "bindingAction" FROM bills b LEFT JOIN LATERAL
    (SELECT id,action FROM "AuditEvent" WHERE "organizationId"=${organizationId}::uuid AND "entityType"='AccountingConnection'
     AND "entityId"=concat(b.details->>'provider',':',b.details->>'connectionId') ORDER BY "createdAt" DESC,id DESC LIMIT 1) c ON true ORDER BY b."entityId"`;
 const riskMap=new Map(risks.map(r=>[r.id,r])),exceptions=[] as {receiptId:string;reason:string;bill:string|null}[];
 const lines=[] as {receiptId:string;sourceKey:string;provider:string;business:string;externalId:string;riskId:string;riskVersion:number;riskTitle:string;issuedOn:string;grossPence:number;checkedAt:string;digest:string}[];
 for(const record of records.slice(0,200)){
  const r=readReceipt(record.details,organizationId,record.entityId),risk=r&&riskMap.get(r.riskId);
  const invalid=!r?'Receipt integrity could not be verified':!packages.includes(r.provider)||r.bindingId!==record.bindingId||record.bindingAction!=='workspace.accounting_business_checked'?'The accounting connection requires a fresh bill check':risk?.version!==r.riskVersion?'The risk allocation requires review':'';
  if(!r||!risk||invalid||'reason' in r.observation){exceptions.push({receiptId:record.id,reason:invalid||(r&&'reason' in r.observation?r.observation.reason:'Unverified allocation'),bill:r?r.provider+' '+r.externalId:null});continue;}
  const {issuedOn,grossPence}=r.observation;
  if(![month,prior].includes(issuedOn.slice(0,7)))continue;
  lines.push({receiptId:record.id,sourceKey:record.entityId,provider:r.provider,business:r.business,externalId:r.externalId,riskId:r.riskId,riskVersion:r.riskVersion,riskTitle:risk.title,issuedOn,grossPence,checkedAt:r.checkedAt,digest:r.digest});
 }
 const limited=records.length>200;
 function subtotal(period:string){
  const selected=lines.filter(r=>r.issuedOn.startsWith(period+'-'));
  return selected.length&&!limited?selected.reduce((sum,r)=>sum+r.grossPence,0):null;
 }
 const currentPence=subtotal(month),priorPence=subtotal(prior);
 return {month,prior,limited,lines,exceptions,currentPence,priorPence,changePence:!exceptions.length&&currentPence!==null&&priorPence!==null?currentPence-priorPence:null};
}
