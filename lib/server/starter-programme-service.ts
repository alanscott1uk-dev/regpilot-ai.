import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {allowedEmail} from '../ai/security.mjs';
import {hashValue} from '../regulatory/intelligence';
import {STARTER_PACKS,STARTER_PROGRAMME_SCOPE,STARTER_PROGRAMME_LIMIT,parseStarterProgramme,type StarterPlan} from '../starter-programmes.mjs';

type Tx=Prisma.TransactionClient;
const ACTION='starter_programme.created',ENTITY='StarterProgramme';
const id=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),date=z.iso.date();
const itemSchema=z.object({key:z.string(),title:z.string().min(8).max(160),description:z.string().min(20).max(1000),why:z.string().min(20).max(600),evidenceHint:z.string(),sourceUrl:z.url({protocol:/^https$/}).optional(),mappings:z.array(z.string().min(1).max(120)).min(1).max(64).optional(),assigneeId:id,ownerName:z.string(),dueDate:date,taskId:id,automationKey:sha});
const recordSchema=z.object({format:z.literal('regpilot-starter-programme'),version:z.literal(1),organizationId:id,packId:z.string(),packVersion:z.number().int().positive(),packHash:sha,previewToken:sha,name:z.string().min(8).max(160),scopeRationale:z.string().min(20).max(1200),createdById:id,createdAt:z.iso.datetime(),items:z.array(itemSchema).min(1).max(24),scope:z.string()});
type ProgrammeRecord=z.infer<typeof recordSchema>;
type EventRow={id:string;entityId:string;actorId:string;createdAt:Date;details:Prisma.JsonValue};
const eventSelect={id:true,entityId:true,actorId:true,createdAt:true,details:true} as const;
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const programmeKey=(org:string,packId:string)=>hashValue({kind:'starter-programme',organizationId:org,packId});
const taskKey=(org:string,packId:string,packVersion:number,key:string)=>hashValue({kind:'starter-programme-task',organizationId:org,packId,packVersion,key});
const link=(path:string,org:string,values:Record<string,string>)=>path+'?'+new URLSearchParams({organizationId:org,...values});
function readRecord(ctx:AuthorizedContext,event:EventRow){
 const payload=event.details&&typeof event.details==='object'&&!Array.isArray(event.details)?event.details as Record<string,Prisma.JsonValue>:{};
 const parsed=recordSchema.safeParse(payload.record);
 if(!parsed.success||!sha.safeParse(payload.recordHash).success||!sha.safeParse(payload.requestHash).success||!sha.safeParse(payload.previewToken).success||hashValue(parsed.data)!==payload.recordHash)throw new IntelligenceError('A saved starter programme failed its record integrity check. Review its history before creating more work.',409);
 const record=parsed.data;
 const expectedRequest=hashValue({packId:record.packId,packVersion:record.packVersion,packHash:record.packHash,name:record.name,scopeRationale:record.scopeRationale,items:record.items.map(({key,title,description,why,assigneeId,dueDate})=>({key,title,description,why,assigneeId,dueDate}))});
 if(payload.requestHash!==expectedRequest||payload.previewToken!==record.previewToken)throw new IntelligenceError('The saved programme request does not match its recorded tasks.',409);
 if(record.organizationId!==ctx.organizationId||record.createdById!==event.actorId||record.createdAt!==event.createdAt.toISOString()||event.entityId!==programmeKey(ctx.organizationId,record.packId)||new Set(record.items.map(item=>item.key)).size!==record.items.length||new Set(record.items.map(item=>item.taskId)).size!==record.items.length||record.items.some(item=>item.automationKey!==taskKey(ctx.organizationId,record.packId,record.packVersion,item.key)))throw new IntelligenceError('The saved programme does not match its company or task identities.',409);
 return {id:event.id,record,recordHash:payload.recordHash as string,requestHash:payload.requestHash as string,previewToken:payload.previewToken as string};
}
async function savedForPack(tx:Tx,ctx:AuthorizedContext,packId:string){
 const rows=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:ENTITY,action:ACTION,entityId:programmeKey(ctx.organizationId,packId)},select:eventSelect,take:2});
 if(rows.length>1)throw new IntelligenceError('Multiple saved records exist for this starter programme. An administrator must reconcile its history.',409);
 return rows[0]?readRecord(ctx,rows[0]):null;
}
const requestShape=(plan:StarterPlan,packHash:string)=>({packId:plan.packId,packVersion:plan.packVersion,packHash,name:plan.name,scopeRationale:plan.scopeRationale,items:plan.items});
async function preview(tx:Tx,ctx:AuthorizedContext,plan:StarterPlan,role:string,saved:Awaited<ReturnType<typeof savedForPack>>){
 const pack=STARTER_PACKS.find(pack=>pack.id===plan.packId)!,packHash=hashValue(pack),items=[],participants=[];
 for(const item of plan.items){let member;try{member=await requireMember(tx,{...ctx,userId:item.assigneeId},WRITER);}catch(error){if(error instanceof IntelligenceError)throw new IntelligenceError('Every selected owner must remain an approved editor or administrator in this company.',409);throw error;}
  const template=pack.items.find(candidate=>candidate.key===item.key)!;
  items.push({...item,evidenceHint:template.evidenceHint,...(template.sourceUrl?{sourceUrl:template.sourceUrl}:{}),...(template.mappings?{mappings:[...template.mappings]}:{}),ownerName:member.email});participants.push({id:item.assigneeId,role:member.role,email:member.email});
 }
 const requestHash=hashValue(requestShape(plan,packHash)),token=hashValue({kind:'starter-programme-preview',organizationId:ctx.organizationId,actorId:ctx.userId,role,requestHash,participants,existingProgrammeId:saved?.id||null});
 return {organizationId:ctx.organizationId,packId:pack.id,packVersion:pack.version,name:plan.name,scopeRationale:plan.scopeRationale,items,token,requestHash,existingProgrammeId:saved?.id||null,total:items.length,scope:STARTER_PROGRAMME_SCOPE};
}
/** Preview writes nothing. Confirmation adopts one canonical task set for this pack and company. */
export async function planStarterProgramme(ctx:AuthorizedContext,input:unknown,apply=false){
 const plan=parseStarterProgramme(input,new Date(),{allowPastDates:apply});if(apply&&(!plan.confirm||!plan.token))throw new IntelligenceError('Preview the programme and explicitly confirm its tasks before creating work');
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN),saved=await savedForPack(tx,ctx,plan.packId),pack=STARTER_PACKS.find(pack=>pack.id===plan.packId)!,packHash=hashValue(pack),requestHash=hashValue(requestShape(plan,packHash));
  if(apply&&saved){
   if(saved.requestHash!==requestHash)throw new IntelligenceError('This starter programme already has saved tasks. Open the saved programme to continue; existing work was not changed.',409);
   // The original confirmed request remains an idempotent read even if its tasks have since been reassigned or completed.
   if(saved.previewToken===plan.token)return {organizationId:ctx.organizationId,id:saved.id,packId:plan.packId,reused:true,taskIds:saved.record.items.map(item=>item.taskId),href:link('/team/programmes',ctx.organizationId,{programmeId:saved.id})};
  }
  // Only a verified exact replay may retain a target date that has since passed.
  parseStarterProgramme(input);
  const proposed=await preview(tx,ctx,plan,actor.role,saved);
  if(!apply)return proposed;
  if(plan.token!==proposed.token)throw new IntelligenceError('The programme preview changed. Check the owners and details, then preview again.',409);
  if(saved)return {organizationId:ctx.organizationId,id:saved.id,packId:plan.packId,reused:true,taskIds:saved.record.items.map(item=>item.taskId),href:link('/team/programmes',ctx.organizationId,{programmeId:saved.id})};
  if(await tx.auditEvent.count({where:{organizationId:ctx.organizationId,entityType:ENTITY,action:ACTION}})>=STARTER_PROGRAMME_LIMIT)throw new IntelligenceError('The starter programme history needs administrator review before more work can be created.',409);
  const keys=proposed.items.map(item=>taskKey(ctx.organizationId,plan.packId,plan.packVersion,item.key));
  if(await tx.obligation.count({where:{organizationId:ctx.organizationId,automationKey:{in:keys}}}))throw new IntelligenceError('A starter task exists without its programme record. Review the saved work before trying again.',409);
  const createdAt=new Date(),items:ProgrammeRecord['items']=[];
  for(const item of proposed.items){
   const automationKey=taskKey(ctx.organizationId,plan.packId,plan.packVersion,item.key),task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:item.title,category:'Starter programme',ownerName:item.ownerName,assigneeId:item.assigneeId,dueDate:new Date(item.dueDate+'T00:00:00.000Z'),automationKey,...(item.sourceUrl?{sourceUrl:item.sourceUrl}:{}),notes:item.description+'\n\nWhy this is relevant: '+item.why+'\n\nEvidence to collect: '+item.evidenceHint+(item.mappings?'\n\nFramework references: '+item.mappings.join(' | '):'')+'\n\nProgramme: '+plan.name},select:{id:true}});
   items.push({...item,taskId:task.id,automationKey});
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:task.id,action:'obligation.created',details:{title:item.title,assigneeId:item.assigneeId,dueDate:item.dueDate,via:'starter_programme',packId:plan.packId,itemKey:item.key}}});
  }
  const record:ProgrammeRecord={format:'regpilot-starter-programme',version:1,organizationId:ctx.organizationId,packId:plan.packId,packVersion:plan.packVersion,packHash,previewToken:proposed.token,name:plan.name,scopeRationale:plan.scopeRationale,createdById:ctx.userId,createdAt:createdAt.toISOString(),items,scope:STARTER_PROGRAMME_SCOPE};
  const event=await tx.auditEvent.create({data:{id:randomUUID(),organizationId:ctx.organizationId,actorId:ctx.userId,entityType:ENTITY,entityId:programmeKey(ctx.organizationId,plan.packId),action:ACTION,createdAt,details:json({record,recordHash:hashValue(record),requestHash,previewToken:proposed.token})},select:{id:true}});
  return {organizationId:ctx.organizationId,id:event.id,packId:plan.packId,reused:false,taskIds:items.map(item=>item.taskId),href:link('/team/programmes',ctx.organizationId,{programmeId:event.id})};
 });
}
async function programmeView(tx:Tx,ctx:AuthorizedContext,saved:ReturnType<typeof readRecord>,includeReviewedFiles:boolean){
 const record=saved.record,tasks=await tx.obligation.findMany({where:{organizationId:ctx.organizationId,id:{in:record.items.map(item=>item.taskId)}},select:{id:true,title:true,status:true,assigneeId:true,ownerName:true,dueDate:true,automationKey:true}}),ownerIds=[...new Set(tasks.flatMap(task=>task.assigneeId?[task.assigneeId]:[]))];
 const people=await tx.membership.findMany({where:{organizationId:ctx.organizationId,userId:{in:ownerIds}},select:{userId:true,role:true,user:{select:{email:true}}}}),today=new Date().toISOString().slice(0,10);
 const files=includeReviewedFiles?await tx.evidence.findMany({where:{organizationId:ctx.organizationId,obligationId:{in:tasks.map(t=>t.id)},reviewStatus:'APPROVED',scanStatus:'CLEAN',reviewedAt:{not:null}},orderBy:[{obligationId:'asc'},{id:'asc'}],take:1001,select:{id:true,obligationId:true,sha256:true,reviewVersion:true,reviewedAt:true,uploadedById:true,reviewerId:true}}):[];
 const visible=files.slice(0,1000).filter(f=>f.reviewedAt&&f.uploadedById&&f.reviewerId&&f.uploadedById!==f.reviewerId&&sha.safeParse(f.sha256).success);
 const items=record.items.map(item=>{
  const found=tasks.find(task=>task.id===item.taskId),task=found?.automationKey===item.automationKey?found:null,attention:string[]=[];
  if(!task)attention.push('The saved task is unavailable or no longer matches this programme.');
  else if(task.status!=='COMPLETE'){
   if(!task.assigneeId||!people.some(person=>person.userId===task.assigneeId&&WRITER.includes(person.role)&&allowedEmail(person.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)))attention.push('Choose a current eligible owner in Tasks.');
   if(task.dueDate.toISOString().slice(0,10)<today)attention.push('The working target date has passed.');
  }
  return {...(includeReviewedFiles?{reviewedFiles:visible.filter(f=>f.obligationId===task?.id).map(f=>({id:f.id,sha256:f.sha256,version:f.reviewVersion,reviewedAt:f.reviewedAt!.toISOString()}))}:{}),key:item.key,title:item.title,description:item.description,why:item.why,evidenceHint:item.evidenceHint,...(item.sourceUrl?{sourceUrl:item.sourceUrl}:{}),...(item.mappings?{mappings:item.mappings}:{}),assigneeId:item.assigneeId,ownerName:item.ownerName,dueDate:item.dueDate,task:task?{id:task.id,title:task.title,status:task.status,assigneeId:task.assigneeId,ownerName:task.ownerName,dueDate:task.dueDate.toISOString().slice(0,10),href:link('/team/work',ctx.organizationId,{taskId:task.id})}:null,attention};
 });
 return {evidenceLimited:files.length>1000,id:saved.id,packId:record.packId,packVersion:record.packVersion,name:record.name,createdAt:record.createdAt,total:items.length,completed:items.filter(item=>item.task?.status==='COMPLETE').length,needsAttention:items.filter(item=>item.attention.length).length,href:link('/team/programmes',ctx.organizationId,{programmeId:saved.id}),scopeRationale:record.scopeRationale,recordHash:saved.recordHash,items,scope:record.scope};
}
export async function programmeReferenceContext(tx:Tx,ctx:AuthorizedContext,programmeId:string){
 const event=await tx.auditEvent.findFirst({where:{id:programmeId,organizationId:ctx.organizationId,entityType:ENTITY,action:ACTION},select:eventSelect});
 if(!event)throw new IntelligenceError('Starter programme unavailable.',404);
 return programmeView(tx,ctx,readRecord(ctx,event),true);
}
export async function starterProgrammeWorkspace(ctx:AuthorizedContext,programmeId?:string){
 if(programmeId&&!id.safeParse(programmeId).success)throw new IntelligenceError('Invalid starter programme identifier');
 const result=await db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),canCreate=ADMIN.includes(actor.role),events=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:ENTITY,action:ACTION},orderBy:[{createdAt:'desc'},{id:'desc'}],take:STARTER_PROGRAMME_LIMIT+1,select:eventSelect});
  if(events.length>STARTER_PROGRAMME_LIMIT)throw new IntelligenceError('The starter programme history exceeds the supported review window. An administrator must reconcile it before continuing.',409);
  const saved=events.map(event=>readRecord(ctx,event));if(new Set(saved.map(item=>item.record.packId)).size!==saved.length)throw new IntelligenceError('The starter programme history contains duplicate pack records. An administrator must reconcile it.',409);
  if(programmeId&&!saved.some(item=>item.id===programmeId))throw new IntelligenceError('Starter programme not found in this company',404);
  const views=await Promise.all(saved.map(item=>programmeView(tx,ctx,item,canCreate&&item.id===programmeId))),allMembers=canCreate?await tx.membership.findMany({where:{organizationId:ctx.organizationId,role:{in:['OWNER','ADMIN','EDITOR']}},orderBy:{userId:'asc'},take:101,select:{userId:true,user:{select:{email:true}}}}):[];
  return {organizationId:ctx.organizationId,role:actor.role,canCreate,packs:STARTER_PACKS,members:allMembers.slice(0,100).filter(member=>allowedEmail(member.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(member=>({id:member.userId,email:member.user.email})),membersLimited:allMembers.length>100,programmes:views.map(({scopeRationale:_,recordHash:__,items:___,scope:____,...summary})=>summary),programmesLimited:false as const,selected:programmeId?views.find(item=>item.id===programmeId)!:null};
 },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:12000});
 const latest=await db.$transaction(tx=>requireMember(tx,ctx));if(latest.role!==result.role)throw new IntelligenceError('Your workspace role changed. Refresh the starter programmes.',409);
 return result;
}
