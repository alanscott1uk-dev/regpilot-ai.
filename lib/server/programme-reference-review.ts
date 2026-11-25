import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {programmeReferenceContext} from './starter-programme-service';
import {transaction,IntelligenceError} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {STARTER_PACKS} from '../starter-programmes.mjs';
import {hashValue} from '../regulatory/intelligence';

const entity='ProgrammeReferenceScope';
const input=z.object({reference:z.string().min(1).max(120),decision:z.enum(['APPLIES','EXCLUDED','REVIEW_NEEDED']),reason:z.string().trim().min(20).max(800),version:z.number().int().min(0),recordHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const stored=input.extend({programmeId:z.uuid(),version:z.number().int().positive()});
function references(plan:Awaited<ReturnType<typeof programmeReferenceContext>>){
 const index=new Map<string,{reference:string;area:string;taskId:string|null;owner:string;taskStatus:string;reviewedFiles:string[]}>();
 const add=(reference:string,area:string)=>{if(!index.has(reference))index.set(reference,{reference,area,taskId:null,owner:'',taskStatus:'No linked task',reviewedFiles:[]});};
 if(plan.packId==='iso27001-annex-a'&&plan.packVersion===1){
  const pack=STARTER_PACKS.find(p=>p.id===plan.packId)!;
  for(const template of pack.items)for(const ref of template.mappings??[])add(ref,template.title);
 }
 for(const item of plan.items)for(const reference of item.mappings??[]){
  add(reference,item.title);
  const row=index.get(reference)!;
  if(item.task)Object.assign(row,{area:item.title,taskId:item.task.id,owner:item.task.ownerName,taskStatus:item.task.status,reviewedFiles:item.reviewedFiles?.map(file=>file.id+' @ '+file.sha256)??[]});
 }
 return index;
}
const eventId=(programmeId:string,reference:string)=>programmeId+'/'+hashValue(reference);
export async function programmeReferenceStatement(ctx:AuthorizedContext,programmeId:string){
 return transaction(ctx,async tx=>{
  const member=await requireMember(tx,ctx,ADMIN),plan=await programmeReferenceContext(tx,ctx,programmeId),index=references(plan);
  const events=await tx.$queryRaw<{entityId:string;actorId:string;createdAt:Date;details:Prisma.JsonValue}[]>`
   SELECT DISTINCT ON ("entityId") "entityId","actorId","createdAt",details FROM "AuditEvent"
   WHERE "organizationId"=${ctx.organizationId}::uuid AND "entityType"=${entity} AND action='programme.reference_decided'
     AND "entityId" LIKE ${programmeId+'/%'}
   ORDER BY "entityId","createdAt" DESC,id DESC`;
  const latest=new Map(events.map(event=>{
   const d=stored.parse(event.details);
   if(d.programmeId!==programmeId||d.recordHash!==plan.recordHash||eventId(programmeId,d.reference)!==event.entityId||!index.has(d.reference))throw new IntelligenceError('Scope history does not match the saved programme.',409);
   return [d.reference,{decision:d.decision,reason:d.reason,version:d.version,reviewerId:event.actorId,reviewedAt:event.createdAt.toISOString()}] as const;
  }));
  return {programmeId,name:plan.name,recordHash:plan.recordHash,evidenceLimited:plan.evidenceLimited,canDecide:ADMIN.includes(member.role),
   rows:[...index.values()].map(row=>({...row,...(latest.get(row.reference)??{decision:'UNASSESSED' as const,reason:'',version:0,reviewerId:'',reviewedAt:''})}))};
 });
}
export async function decideProgrammeReference(ctx:AuthorizedContext,programmeId:string,raw:unknown){
 const d=input.parse(raw);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);const plan=await programmeReferenceContext(tx,ctx,programmeId);
  if(d.recordHash!==plan.recordHash||!references(plan).has(d.reference))throw new IntelligenceError('The reference does not belong to this programme revision.',409);
  const entityId=eventId(programmeId,d.reference),where={organizationId:ctx.organizationId,entityType:entity,entityId,action:'programme.reference_decided'};
  const prior=await tx.auditEvent.findFirst({where,orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const previous=prior?stored.parse(prior.details):null,version=previous?.version??0;
  if(previous&&(previous.programmeId!==programmeId||previous.recordHash!==plan.recordHash||previous.reference!==d.reference))throw new IntelligenceError('The previous decision has inconsistent scope.',409);
  if(previous&&d.version+1===version&&prior?.actorId===ctx.userId&&previous.reason===d.reason&&previous.decision===d.decision)return {version};
  if(version!==d.version)throw new IntelligenceError('Another reviewer updated this reference. Refresh its decision.',409);
  await tx.auditEvent.create({data:{...where,actorId:ctx.userId,details:{...d,programmeId,version:version+1}}});
  return {version:version+1};
 });
}
