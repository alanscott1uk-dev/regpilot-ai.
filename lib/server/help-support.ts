import {z} from 'zod';
import {helpArticles} from '../help-centre';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {futureDate} from './reviewed-files';
import {activeOwner} from './library-service';
import {allowedEmail} from '../ai/security.mjs';
const guide=z.string().refine(id=>helpArticles.some(a=>a.id===id));
const update=z.discriminatedUnion('action',[
 z.object({action:z.literal('OPEN'),guide}).strict(),
 z.object({action:z.literal('ASSIGN'),guide,ownerId:z.uuid(),reviewDate:z.iso.date()}).strict(),
 z.object({action:z.literal('ESCALATE'),guide,issue:z.enum(['FAILED_CONNECTION','MISSING_SOURCE','ACCESS','OTHER']),requestKey:z.uuid()}).strict()
]);
const ownerSchema=z.object({ownerId:z.uuid(),reviewDate:z.iso.date()});
const entityType='HelpGuide';
export async function helpMaintenance(c:AuthorizedContext){
 return transaction(c,async tx=>{
  const member=await requireMember(tx,c),where={organizationId:c.organizationId,entityType};
  const roles=await tx.membership.findMany({where:{organizationId:c.organizationId,role:{in:['ADMIN','OWNER','EDITOR']}},select:{userId:true,user:{select:{email:true}}},take:200});
  const members=roles.filter(v=>allowedEmail(v.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(v=>({id:v.userId,email:v.user.email}));
  const owners=await tx.auditEvent.findMany({where:{...where,action:'help.assigned'},distinct:['entityId'],orderBy:[{entityId:'asc'},{createdAt:'desc'},{id:'desc'}],select:{entityId:true,details:true}});
  const opens=await tx.auditEvent.groupBy({by:['entityId'],where:{...where,action:'help.opened',createdAt:{gte:new Date(Date.now()-30*86400000)}},_count:true});
  const guides=helpArticles.map(a=>{const rec=owners.find(o=>o.entityId===a.id),v=rec?ownerSchema.parse(rec.details):null;return {id:a.id,title:a.title,owner:v?members.find(m=>m.id===v.ownerId)??null:null,reviewDate:v?.reviewDate??null,readerDays:opens.find(n=>n.entityId===a.id)?._count||0};}).sort((a,b)=>b.readerDays-a.readerDays||a.title.localeCompare(b.title));
  return {guides,members:ADMIN.includes(member.role)?members:[],canManage:ADMIN.includes(member.role)};
 });
}
export async function changeHelp(c:AuthorizedContext,raw:unknown){
 const d=update.parse(raw);
 return transaction(c,async tx=>{
  await requireMember(tx,c,d.action==='ASSIGN'?ADMIN:undefined);
  const where={organizationId:c.organizationId,entityType,entityId:d.guide};
  if(d.action==='OPEN'){
   const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
   if(!await tx.auditEvent.findFirst({where:{...where,actorId:c.userId,action:'help.opened',createdAt:{gte:today}}}))await tx.auditEvent.create({data:{...where,actorId:c.userId,action:'help.opened',details:{}}});
   return {saved:true};
  }
  if(d.action==='ASSIGN'){
   await activeOwner(tx,c,d.ownerId);futureDate(d.reviewDate);
   await tx.auditEvent.create({data:{...where,actorId:c.userId,action:'help.assigned',details:{ownerId:d.ownerId,reviewDate:d.reviewDate}}});return {saved:true};
  }
  const originKey=hashValue({guide:d.guide,user:c.userId,request:d.requestKey,issue:d.issue});
  const old=await tx.obligation.findFirst({where:{organizationId:c.organizationId,originKey},select:{id:true}});if(old)return {taskId:old.id};
  const assignment=await tx.auditEvent.findFirst({where:{...where,action:'help.assigned'},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  if(!assignment)throw new IntelligenceError('A workspace administrator must assign a guide owner before routing support',409);
  const owner=await activeOwner(tx,c,ownerSchema.parse(assignment.details).ownerId);
  const cutoff=new Date(Date.now()-86400000);
  if(await tx.auditEvent.count({where:{organizationId:c.organizationId,actorId:c.userId,action:'help.escalated',createdAt:{gt:cutoff}}})>=10)throw new IntelligenceError('Daily support request limit reached',429);
  const title=helpArticles.find(a=>a.id===d.guide)!.title;
  const task=await tx.obligation.create({data:{organizationId:c.organizationId,originKey,title:('Support: '+title).slice(0,160),category:'Operator support',ownerName:owner.user.email,assigneeId:owner.userId,status:'OPEN',dueDate:new Date(Date.now()+86400000),notes:'Operator requested help with '+d.issue.toLowerCase().replaceAll('_',' ')+'. Guide: /help#'+d.guide}});
  await tx.auditEvent.create({data:{...where,actorId:c.userId,action:'help.escalated',details:{taskId:task.id,issue:d.issue}}});return {taskId:task.id};
 });
}
