import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN} from './workspace-member';
import {IntelligenceError,transaction} from './intelligence-service';
import {assertReviewedFiles,reviewedFileSchema,reviewedFiles,verifyReviewedBytes} from './reviewed-files';
import type {EvidenceObjectStore} from './evidence-storage';
import {monthStart} from './paid-budget';
import {aiDailyLimits} from './ai-meter';
import {aiConfigured} from './ai-auth';
import {positiveInt} from '../services/config';

export const costKinds=['Hosting and database','AI and document processing','Connected services','Support and operations'] as const;
const period=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const line=z.object({kind:z.enum(costKinds),pence:z.number().int().min(0).max(1000000000),basis:z.enum(['INVOICED','ALLOCATED']),evidenceId:z.uuid()}).strict();
const report=z.object({month:period,lines:z.array(line).min(1).max(4).refine(lines=>new Set(lines.map(l=>l.kind)).size===lines.length),notes:z.string().trim().min(15).max(600),requestKey:z.uuid()}).strict();
const saved=z.object({input:report,files:z.array(reviewedFileSchema)});
const entityType='TenantCostStatement';
type Tx=Prisma.TransactionClient;
async function read(tx:Tx,c:AuthorizedContext,month:string){
 const found=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,entityId:month,action:'cost.submitted'},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 if(!found)return null;
 const s=saved.parse(found.details);let current=true;try{await assertReviewedFiles(tx,c.organizationId,s.files);await requireMember(tx,{...c,userId:found.actorId},ADMIN);}catch(e){if(!(e instanceof IntelligenceError))throw e;current=false;}
 const reviews=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,entityId:found.id,action:'cost.reviewed'},orderBy:{createdAt:'desc'},take:1});
 let reviewed=!!reviews[0]&&reviews[0].actorId!==found.actorId;
 if(reviewed)try{await requireMember(tx,{...c,userId:reviews[0].actorId},ADMIN);}catch(e){if(!(e instanceof IntelligenceError))throw e;reviewed=false;}
 const totalPence=current&&reviewed&&s.input.lines.length===costKinds.length?s.input.lines.reduce((n,l)=>n+l.pence,0):null;
 return {id:found.id,authorId:found.actorId,current,reviewed,totalPence,input:s.input,files:s.files};
}
export async function tenantCosts(c:AuthorizedContext,month:string){
 period.parse(month);return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const from=new Date(month+'-01T00:00:00Z'),to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1));
  const [statement,org,first,evidence,groups,budget,billing]=await Promise.all([read(tx,c,month),tx.organization.findUniqueOrThrow({where:{id:c.organizationId},select:{createdAt:true}}),tx.evidence.findFirst({where:{organizationId:c.organizationId,reviewStatus:'APPROVED',scanStatus:'CLEAN',reviewedAt:{not:null}},orderBy:{reviewedAt:'asc'},select:{reviewedAt:true}}),tx.evidence.findMany({where:{organizationId:c.organizationId,reviewStatus:'APPROVED',scanStatus:'CLEAN'},select:{id:true,filename:true},orderBy:{reviewedAt:'desc'},take:100}),tx.paidReservation.groupBy({by:['service'],where:{organizationId:c.organizationId,month:{gte:from,lt:to}},_sum:{reservedMicros:true,units:true}}),tx.paidBudget.findUnique({where:{organizationId:c.organizationId}}),tx.billingAccount.findUnique({where:{organizationId:c.organizationId},select:{status:true}})]);
  const cap=positiveInt(process.env.REGPILOT_PAID_ORG_MONTHLY_MICROS);
  return {statement,evidence,kinds:costKinds,aiActivated:aiConfigured(),aiDailyAllowances:aiDailyLimits(),subscriptionStatus:billing?.status??null,usage:groups.map(g=>({service:g.service,units:g._sum.units||0,reservedUsdMicros:g._sum.reservedMicros||0})),monthlyBudgetUsdMicros:month===monthStart().toISOString().slice(0,7)&&cap?Math.min(budget?.monthlyLimitMicros??cap,cap):null,firstCurrentEvidenceMinutes:first?.reviewedAt?Math.max(0,Math.round((first.reviewedAt.getTime()-org.createdAt.getTime())/60000)):null};
 });
}
export async function changeCosts(c:AuthorizedContext,raw:unknown,store?:EvidenceObjectStore){
 const d=z.discriminatedUnion('action',[z.object({action:z.literal('SUBMIT'),report}).strict(),z.object({action:z.literal('REVIEW'),month:period,id:z.uuid(),confirm:z.literal(true)}).strict()]).parse(raw);
 const month=d.action==='SUBMIT'?d.report.month:d.month;
 if(month>monthStart().toISOString().slice(0,7))throw new IntelligenceError('Choose an elapsed or current billing period',400);
 const capture=async(tx:Tx)=>{
  await requireMember(tx,c,ADMIN);
  if(d.action==='REVIEW'){const s=await read(tx,c,month);if(!s||!s.current||s.id!==d.id)throw new IntelligenceError('The cost statement changed',409);if(s.authorId===c.userId)throw new IntelligenceError('A different finance reviewer must approve the costs',403);return {files:s.files,exists:s.reviewed};}
  const old=await tx.auditEvent.findUnique({where:{id:d.report.requestKey}});
  if(old){if(old.organizationId!==c.organizationId||old.actorId!==c.userId||old.action!=='cost.submitted'||hashValue(saved.parse(old.details).input)!==hashValue(d.report))throw new IntelligenceError('This request key is unavailable',409);return {files:[],exists:true};}
  return {files:await reviewedFiles(tx,c.organizationId,[...new Set(d.report.lines.map(l=>l.evidenceId))]),exists:false};
 };
 const pre=await transaction(c,capture);if(pre.exists)return {saved:true};
 await verifyReviewedBytes(c,pre.files,store);
 return transaction(c,async tx=>{const next=await capture(tx);if(next.exists)return {saved:true};if(hashValue(next.files)!==hashValue(pre.files))throw new IntelligenceError('Evidence changed during verification',409);
  const data=d.action==='SUBMIT'?{id:d.report.requestKey,action:'cost.submitted',entityId:month,details:{input:d.report,files:next.files}}:{action:'cost.reviewed',entityId:d.id,details:{month}};
  await tx.auditEvent.create({data:{...data,organizationId:c.organizationId,actorId:c.userId,entityType,details:JSON.parse(JSON.stringify(data.details))}});return {saved:true};});
}
