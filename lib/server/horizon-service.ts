import {createHash} from 'node:crypto';
import {z} from 'zod';
import {PUBLIC_HORIZON_URL,MAX_REPORT_BYTES,validateReport,reportState,type HorizonReport} from '../horizon/model';
import {boundedJson} from '../horizon/collector';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,WRITER} from './workspace-member';
import type {AuthorizedContext} from './authorization';
export async function readPublicHorizon():Promise<HorizonReport>{
 const raw=await boundedJson(PUBLIC_HORIZON_URL,(url,init)=>fetch(url,{...init,next:{revalidate:300}}),MAX_REPORT_BYTES,'force-cache');
 return validateReport(raw);
}
const hash=z.string().regex(/^[a-f0-9]{32}$/);
const inputSchema=z.object({itemId:hash,revision:hash,action:z.enum(['queue','dismiss']),notes:z.string().trim().min(20).max(800),ownerId:z.uuid().optional(),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),reviewAcknowledged:z.literal(true)}).strict();
export async function horizonWorkspace(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 const member=await requireMember(tx,ctx);
 const [events,members,profile]=await Promise.all([
  tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,action:{in:['horizon.review_queued','horizon.dismissed']}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:501,select:{entityId:true,details:true,createdAt:true}}),
  tx.membership.findMany({where:{organizationId:ctx.organizationId,role:{in:['OWNER','ADMIN','EDITOR']}},take:100,select:{user:{select:{id:true,email:true}}}}),
  tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId},select:{activities:true}})
 ]);
 const states=new Map<string,unknown>();for(const e of events.slice(0,500))if(!states.has(e.entityId))states.set(e.entityId,{...e.details as object,decidedAt:e.createdAt.toISOString()});
 return {role:member.role,members:members.map(m=>m.user),activities:profile?.activities||[],decisions:[...states.values()],limited:events.length>500};
});}
export async function triageHorizon(ctx:AuthorizedContext,input:unknown,load:()=>Promise<HorizonReport>=readPublicHorizon){
 const v=inputSchema.parse(input);
 await transaction(ctx,tx=>requireMember(tx,ctx,WRITER));
 const report=validateReport(await load()),item=report.items.find(i=>i.id===v.itemId&&i.revision===v.revision);
 if(!item||reportState(report)==='stale'||Date.now()-Date.parse(item.observedAt)>12*3600000)throw new IntelligenceError('This publication observation is stale or changed. Refresh and inspect the official source.',409);
 if(item.publisherIds.every(id=>report.feeds.find(f=>f.id===id)?.state==='unavailable'))throw new IntelligenceError('The publishing feed is unavailable. Inspect the source and retry after verification.',409);
 const entityId=item.id+':'+item.revision,key='horizon:'+createHash('sha256').update(entityId).digest('hex').slice(0,56);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const existing=await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey:key}}});
  if(existing){if(v.action==='dismiss')throw new IntelligenceError('This revision already has review work. Manage that task instead of dismissing it.',409);return {taskId:existing.id,reused:true,state:'queued',itemId:item.id,revision:item.revision};}
  const earlier=await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityId,action:'horizon.dismissed'},orderBy:{createdAt:'desc'}});
  if(v.action==='dismiss'&&earlier)return {state:'dismissed',reused:true,itemId:item.id,revision:item.revision};
  let taskId:string|null=null;
  if(v.action==='queue'){
   if(!v.ownerId||!v.dueDate)throw new IntelligenceError('Choose an owner and an operational review date');
   const date=new Date(v.dueDate+'T00:00:00Z'),today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
   if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v.dueDate||date<today||date.getTime()>today.getTime()+365*86400000)throw new IntelligenceError('Choose a real review date within the next year');
   const owner=await tx.membership.findFirst({where:{organizationId:ctx.organizationId,userId:v.ownerId,role:{in:['OWNER','ADMIN','EDITOR']}},include:{user:{select:{email:true}}}});
   if(!owner)throw new IntelligenceError('Choose an active owner in this workspace',409);
   const task=await tx.obligation.create({data:{organizationId:ctx.organizationId,automationKey:key,title:('Assess publication: '+item.title).slice(0,160),category:'Horizon scanning review',ownerName:owner.user.email,assigneeId:v.ownerId,dueDate:date,sourceUrl:item.url,status:'OPEN',notes:'Discovery metadata, not a verified legal obligation. Read the official publication and attachments, assess jurisdiction, applicability and effective dates, and record the decision. The due date is an internal review target.\n\nReviewer context: '+v.notes}});taskId=task.id;
  }
  const state=taskId?'queued':'dismissed';
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:taskId?'horizon.review_queued':'horizon.dismissed',entityType:'HorizonItem',entityId,details:{itemId:item.id,revision:item.revision,state,taskId,notes:v.notes,url:item.url,feedGeneratedAt:report.generatedAt,observedAt:item.observedAt}}});
  return {itemId:item.id,revision:item.revision,state,taskId,reused:false};
 });
}
