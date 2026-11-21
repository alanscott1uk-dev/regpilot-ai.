import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {accountingConfig,readAccountingSupplier} from '../connectors/accounting-oauth';
import {brokerId} from '../connectors/hosted-oauth';
import {CollectionError} from '../connectors/collection-error';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {hashValue} from '../regulatory/intelligence';

export const supplierLedgerInput=z.object({vendorId:z.uuid(),version:z.number().int().positive(),requestKey:z.uuid(),
 provider:z.enum(['xero','quickbooks']),connectionId:brokerId,business:z.string().trim().min(1).max(100),externalId:z.string().trim().min(1).max(100)}).strict();
const receipt=z.object({provider:z.enum(['xero','quickbooks']),business:z.string(),externalId:z.string(),name:z.string(),checkedAt:z.iso.datetime(),
 vendorName:z.string(),vendorVersion:z.number(),connectionId:brokerId,businessCheckId:z.uuid(),sourceActive:z.boolean(),sourceSupplier:z.boolean(),comparisonHash:z.string().regex(/^[a-f0-9]{64}$/),issues:z.array(z.string()),taskId:z.uuid().nullable(),requestHash:z.string()});
const action='vendor.accounting_supplier_checked';
export async function supplierLedgerHistory(tx:Prisma.TransactionClient,organizationId:string,vendorId:string){
 const rows=await tx.auditEvent.findMany({where:{organizationId,entityType:'Vendor',entityId:vendorId,action},
  orderBy:[{createdAt:'desc'},{id:'desc'}],take:10,select:{details:true}});
 return rows.map(row=>receipt.parse(row.details));
}
export async function checkSupplierLedger(ctx:AuthorizedContext,input:unknown,fetcher:typeof fetch=fetch){
 const d=supplierLedgerInput.parse(input),requestHash=hashValue({...d,actor:ctx.userId});
 const config=accountingConfig(d.provider);
 if(!config)throw new IntelligenceError('This accounting connection awaits configuration.',503);
 async function state(tx:Prisma.TransactionClient){
  await requireMember(tx,ctx,ADMIN);
  const org=await tx.organization.findUniqueOrThrow({where:{id:ctx.organizationId},select:{accountShortcuts:true}});
  if(!org.accountShortcuts.includes(d.provider))throw new IntelligenceError('Add the accounting package to this workspace first.',409);
  const vendor=await tx.vendor.findFirst({where:{id:d.vendorId,organizationId:ctx.organizationId},select:{id:true,name:true,version:true,active:true,ownerId:true}});
  if(!vendor)throw new IntelligenceError('Supplier unavailable in this workspace.',404);
  if(!vendor.active||vendor.version!==d.version)throw new IntelligenceError('Refresh the supplier before checking its accounting record.',409);
  const binding=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType:'AccountingConnection',entityId:d.provider+':'+d.connectionId},
   orderBy:[{createdAt:'desc'},{id:'desc'}],select:{action:true,details:true,id:true}});
  if(binding?.action!=='workspace.accounting_business_checked'||z.object({reference:z.string()}).safeParse(binding.details).data?.reference!==d.business)
    throw new IntelligenceError('Verify this business on the selected connection first.',409);
  const saved=await tx.auditEvent.findUnique({where:{id:d.requestKey}});
  if(saved&&(saved.organizationId!==ctx.organizationId||saved.entityId!==vendor.id||saved.action!==action||receipt.parse(saved.details).requestHash!==requestHash))
   throw new IntelligenceError('This request identifier belongs to a different check.',409);
  const head=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType:'Vendor',entityId:vendor.id,action},
   orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  return {binding:binding.id,vendor,previous:head?.id,saved:saved?receipt.parse(saved.details):null};
 }
 const before=await transaction(ctx,state);
 if(before.saved)return before.saved;
 let observed:Awaited<ReturnType<typeof readAccountingSupplier>>;
 try{observed=await readAccountingSupplier(ctx.organizationId,d.provider,d.connectionId,d.business,d.externalId,config,fetcher);}
 catch(e){if(e instanceof z.ZodError)throw e;if(e instanceof CollectionError&&e.code==='TARGET_MISMATCH')throw new IntelligenceError('The connection, business or supplier identifier did not match.',409);
  throw new IntelligenceError('The accounting provider could not verify the supplier. Check the identifier and read permission.',502);}
 const checkedAt=new Date().toISOString();
 return transaction(ctx,async tx=>{
  const current=await state(tx);if(current.saved)return current.saved;
  if(current.binding!==before.binding||current.previous!==before.previous)throw new IntelligenceError('A newer check was saved. Refresh before comparing again.',409);
  const {vendor}=current;
  const normalize=(s:string)=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
  const issues:string[]=[];
  if(!observed.active)issues.push('Accounting record is inactive');
  if(!observed.supplier)issues.push('Accounting contact is not marked as a supplier');
  if(normalize(observed.name)!==normalize(vendor.name))issues.push('Supplier names differ');
  let taskId:string|null=null;
  if(issues.length){
   const owner=await requireMember(tx,{...ctx,userId:vendor.ownerId},WRITER);
   const prefix=hashValue({vendor:vendor.id,provider:d.provider,business:d.business,external:observed.externalId}).slice(0,32);
   const open=await tx.obligation.findFirst({where:{organizationId:ctx.organizationId,automationKey:{startsWith:prefix+':'},status:{not:'COMPLETE'}},select:{id:true}});
   const task=open||await tx.obligation.create({data:{organizationId:ctx.organizationId,automationKey:prefix+':'+d.requestKey.replaceAll('-','').slice(0,30),
    vendorSignalId:vendor.id,assigneeId:vendor.ownerId,ownerName:owner.email,dueDate:new Date(),category:'Accounting supplier reconciliation',
    title:('Reconcile accounting record for '+vendor.name).slice(0,160),notes:issues.join('. ')+'. Confirm the supplier identity against the named accounting business and record the outcome.'}});
   taskId=task.id;
  }
  const result={provider:d.provider,business:d.business,externalId:observed.externalId,name:observed.name,checkedAt,vendorName:vendor.name,vendorVersion:vendor.version,
   connectionId:d.connectionId,businessCheckId:current.binding,sourceActive:observed.active,sourceSupplier:observed.supplier,
   comparisonHash:hashValue({organizationId:ctx.organizationId,business:d.business,vendorId:vendor.id,vendorName:vendor.name,vendorVersion:vendor.version,provider:d.provider,businessCheckId:current.binding,observed,checkedAt}),issues,taskId,requestHash};
  await tx.auditEvent.create({data:{id:d.requestKey,organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Vendor',entityId:vendor.id,action,details:result}});
  return result;
 });
}
