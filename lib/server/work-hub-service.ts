import type {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';
import {WORK_PAGE_SIZE,parseWorkPlan,parseWorkStart,parseWorkCreate,planningBlock,taskWorkflow,workUuid,type WorkQuery} from '../work-hub.mjs';

const taskSelect=(organizationId:string)=>({id:true,title:true,category:true,ownerName:true,assigneeId:true,dueDate:true,status:true,updatedAt:true,originKey:true,controlId:true,connectorId:true,
 assignee:{select:{id:true,email:true}},managedControl:{select:{id:true,title:true,enabled:true}},
 changeAction:{select:{id:true,responseId:true,status:true}},auditRequest:{select:{id:true}},accessItem:{select:{id:true}},
 _count:{select:{evidence:{where:{organizationId}}}},evidence:{where:{organizationId,scanStatus:'CLEAN',reviewStatus:'PENDING_REVIEW'},take:1,select:{id:true}}
} satisfies Prisma.ObligationSelect);
function dayWindow(now:Date){const day=new Date(now.toISOString().slice(0,10)+'T00:00:00.000Z');return {day,week:new Date(day.getTime()+7*86400000)};}
function inboxWhere(ctx:AuthorizedContext,query:WorkQuery,now:Date):Prisma.ObligationWhereInput {
 const {day}=dayWindow(now);
 const base:Prisma.ObligationWhereInput={organizationId:ctx.organizationId,status:query.view==='complete'?'COMPLETE':{not:'COMPLETE'}};
 if(query.view==='mine')base.assigneeId=ctx.userId;
 if(query.view==='unassigned')base.assigneeId=null;
 if(query.view==='overdue')base.dueDate={lt:day};
 if(query.view==='review')base.evidence={some:{organizationId:ctx.organizationId,scanStatus:'CLEAN',reviewStatus:'PENDING_REVIEW'}};
 if(query.q)base.OR=[{title:{contains:query.q,mode:'insensitive'}},{category:{contains:query.q,mode:'insensitive'}},{ownerName:{contains:query.q,mode:'insensitive'}}];
 return base;
}
/** Full-list counts and server pagination; no first-100-record approximation. */
export async function workInbox(ctx:AuthorizedContext,query:WorkQuery,now=new Date()) {
 return db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),{day}=dayWindow(now),where=inboxWhere(ctx,query,now);
  const scope={organizationId:ctx.organizationId},open={...scope,status:{not:'COMPLETE' as const}};
  const [total,allOpen,mine,overdue,unassigned,review,complete,members]=await Promise.all([
   tx.obligation.count({where}),tx.obligation.count({where:open}),tx.obligation.count({where:{...open,assigneeId:ctx.userId}}),
   tx.obligation.count({where:{...open,dueDate:{lt:day}}}),tx.obligation.count({where:{...open,assigneeId:null}}),
   tx.obligation.count({where:{...open,evidence:{some:{...scope,scanStatus:'CLEAN',reviewStatus:'PENDING_REVIEW'}}}}),
   tx.obligation.count({where:{...scope,status:'COMPLETE'}}),
   tx.membership.findMany({where:{...scope,role:{in:['OWNER','ADMIN','EDITOR']}},orderBy:{userId:'asc'},take:201,select:{role:true,user:{select:{id:true,email:true}}}})
  ]);
  const pages=Math.max(1,Math.ceil(total/WORK_PAGE_SIZE)),page=Math.min(query.page,pages);
  const rows=await tx.obligation.findMany({where,orderBy:[{dueDate:'asc'},{id:'asc'}],skip:(page-1)*WORK_PAGE_SIZE,take:WORK_PAGE_SIZE,select:taskSelect(ctx.organizationId)});
  const isAdmin=ADMIN.includes(actor.role);
  const items=rows.map(({evidence,...task})=>{
   const safeTask={...task,changeAction:isAdmin||task.assigneeId===ctx.userId?task.changeAction:null};
   return {...safeTask,evidenceToReview:evidence.length>0,planningBlocked:planningBlock(task),canPlan:isAdmin&&!planningBlock(task),workflow:taskWorkflow(safeTask,ctx.organizationId)};
  });
  return {organizationId:ctx.organizationId,actorId:ctx.userId,role:actor.role,items,total,page,pages,pageSize:WORK_PAGE_SIZE,query:{...query,page},
   counts:{open:allOpen,mine,overdue,unassigned,review,complete},members:members.slice(0,200),membersLimited:members.length>200,generatedAt:now.toISOString()};
 },{isolationLevel:'RepeatableRead',timeout:12000});
}
/** Select metadata explicitly: storage keys, bytes, raw AI output and provider secrets never enter this response. */
export async function workTask(ctx:AuthorizedContext,id:string) {
 if(!workUuid(id))throw new IntelligenceError('Invalid task identifier',400);
 return db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx);
  const record=await tx.obligation.findFirst({where:{id,organizationId:ctx.organizationId},select:{...taskSelect(ctx.organizationId),notes:true,sourceUrl:true,sourceCheckedAt:true,createdAt:true,completedAt:true,completionException:true,completionRationale:true,
   evidence:{where:{organizationId:ctx.organizationId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,select:{id:true,filename:true,scanStatus:true,reviewStatus:true,createdAt:true,reviewedAt:true}},
   assuranceAssessments:{where:{organizationId:ctx.organizationId},orderBy:{createdAt:'desc'},take:10,select:{id:true,status:true,validUntil:true,createdAt:true}},
   intelligenceDecisions:{where:{organizationId:ctx.organizationId},orderBy:{createdAt:'desc'},take:10,select:{id:true,decision:true,createdAt:true,run:{select:{snapshot:{select:{id:true,title:true,url:true,sourceId:true,lastCheckedAt:true,version:true}}}}}}
  }});
  if(!record)throw new IntelligenceError('Task not found',404);
  const history=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:'Obligation',entityId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:31,select:{id:true,action:true,createdAt:true}});
  const isAdmin=ADMIN.includes(actor.role),{evidence,...task}=record;
  const safeTask={...task,changeAction:isAdmin||task.assigneeId===ctx.userId?task.changeAction:null};
  return {organizationId:ctx.organizationId,task:{...safeTask,evidence:evidence.slice(0,50)},evidenceLimited:evidence.length>50,history:history.slice(0,30),historyLimited:history.length>30,
   planningBlocked:planningBlock(task),canPlan:isAdmin&&!planningBlock(task),canStart:WRITER.includes(actor.role)&&task.status==='OPEN'&&!planningBlock(task),workflow:taskWorkflow(safeTask,ctx.organizationId)};
 },{isolationLevel:'RepeatableRead',timeout:12000});
}
/** Preview and apply use the same revalidated plan. Apply is atomic and never changes approval/completion. */
export async function planWork(ctx:AuthorizedContext,input:unknown,apply=false) {
 const plan=parseWorkPlan(input);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const tasks=await tx.obligation.findMany({where:{organizationId:ctx.organizationId,id:{in:plan.items.map(x=>x.id)}},orderBy:{id:'asc'},select:taskSelect(ctx.organizationId)});
  if(tasks.length!==plan.items.length)throw new IntelligenceError('Some selected tasks are no longer available. Refresh the list.',409);
  for(const task of tasks){
   if(task.updatedAt.toISOString()!==plan.items.find(x=>x.id===task.id)?.updatedAt)throw new IntelligenceError('A selected task changed. Refresh the list and preview again.',409);
   const blocked=planningBlock(task);if(blocked)throw new IntelligenceError(blocked,409);
  }
  let assigneeEmail:string|null=null;
  if(plan.changes.assigneeId){
   try{assigneeEmail=(await requireMember(tx,{...ctx,userId:plan.changes.assigneeId},WRITER)).email;}
   catch(error){if(error instanceof IntelligenceError)throw new IntelligenceError('The assignee must still be an approved editor or administrator in this organisation.',409);throw error;}
  }
  const items=tasks.map(task=>({id:task.id,title:task.title,updatedAt:task.updatedAt.toISOString(),
   before:{assigneeId:task.assigneeId,ownerName:task.ownerName,dueDate:task.dueDate.toISOString().slice(0,10)},
   after:{assigneeId:plan.changes.assigneeId===undefined?task.assigneeId:plan.changes.assigneeId,ownerName:plan.changes.assigneeId===undefined?task.ownerName:assigneeEmail||'Unassigned',dueDate:plan.changes.dueDate||task.dueDate.toISOString().slice(0,10)}
  }));
  const token=hashValue({organizationId:ctx.organizationId,actorId:ctx.userId,items,changes:plan.changes,reason:plan.reason});
  if(!apply)return {token,items,reason:plan.reason,applied:0,batchId:null as string|null};
  if(plan.token!==token)throw new IntelligenceError('The change preview is stale or belongs to another session. Preview again.',409);
  const batchId=randomUUID();
  for(const item of items){
   const updated=await tx.obligation.updateMany({where:{id:item.id,organizationId:ctx.organizationId,updatedAt:new Date(item.updatedAt)},data:{
    ...(plan.changes.assigneeId!==undefined?{assigneeId:item.after.assigneeId,ownerName:item.after.ownerName}:{}),
    ...(plan.changes.dueDate?{dueDate:new Date(item.after.dueDate+'T00:00:00.000Z')}:{})
   }});
   if(updated.count!==1)throw new IntelligenceError('A task changed during planning. No changes were saved; refresh and preview again.',409);
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:item.id,action:'work.plan_applied',details:{batchId,reason:plan.reason,before:item.before,after:item.after}}});
  }
  return {token,items,reason:plan.reason,applied:items.length,batchId};
 });
}

export async function startWork(ctx:AuthorizedContext,input:unknown) {
 const requested=parseWorkStart(input);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const task=await tx.obligation.findFirst({where:{id:requested.id,organizationId:ctx.organizationId},select:taskSelect(ctx.organizationId)});
  if(!task)throw new IntelligenceError('Task not found',404);
  if(task.updatedAt.toISOString()!==requested.updatedAt||task.status!=='OPEN')throw new IntelligenceError('The task changed. Refresh its context before starting it.',409);
  const blocked=planningBlock(task);if(blocked)throw new IntelligenceError(blocked,409);
  const result=await tx.obligation.updateMany({where:{id:task.id,organizationId:ctx.organizationId,updatedAt:task.updatedAt,status:'OPEN'},data:{status:'IN_PROGRESS'}});
  if(result.count!==1)throw new IntelligenceError('The task changed. No update was saved.',409);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:task.id,action:'obligation.status_changed',details:{from:'OPEN',to:'IN_PROGRESS',via:'work_hub'}}});
  return {id:task.id,status:'IN_PROGRESS'};
 });
}

export async function createWork(ctx:AuthorizedContext,input:unknown) {
 const task=parseWorkCreate(input);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  let assignee;
  try{assignee=await requireMember(tx,{...ctx,userId:task.assigneeId},WRITER);}
  catch(error){if(error instanceof IntelligenceError)throw new IntelligenceError('Choose a current approved workspace assignee.',409);throw error;}
  const created=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:task.title,category:task.category,notes:task.notes,assigneeId:task.assigneeId,ownerName:assignee.email,dueDate:new Date(task.dueDate+'T00:00:00.000Z')},select:{id:true,title:true}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:created.id,action:'obligation.created',details:{title:task.title,assigneeId:task.assigneeId,dueDate:task.dueDate,via:'work_hub'}}});
  return created;
 });
}
