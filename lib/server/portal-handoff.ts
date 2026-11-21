import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {portalFields,mapPortalFields,type PortalFields} from '../portal-questionnaire';
import {approvedDisclosure,exportQuestionnaire} from './customer-assurance-service';
import {requireMember,ADMIN} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import type {EvidenceObjectStore} from './evidence-storage';
import {db} from './db';
import {IntelligenceError,transaction} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';
const issue=z.object({capture:portalFields,version:z.number().int().positive(),labels:z.array(z.string().min(3).max(600)).min(1).max(100).refine(v=>v.length===new Set(v).size),confirm:z.literal(true)}).strict();
const secretHash=(s:string)=>createHash('sha256').update(s).digest('hex');
const bad=()=>new IntelligenceError('The portal hand-off is unavailable. Return to the approved questionnaire.',404);
const saved=z.object({capture:portalFields,labels:z.array(z.string()).min(1).max(100),approvedHash:z.string().length(64),questionnaireId:z.uuid(),secretHash:z.string().length(64),expiresAt:z.iso.datetime()}).strict();
export async function issuePortalHandoff(ctx:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 const d=issue.parse(raw);
 await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const s=await approvedDisclosure(tx,ctx.organizationId,id);
  if(s.row.reviewerId!==ctx.userId)throw new IntelligenceError('The independent disclosure reviewer must check the portal mapping',403);
 });
 const verified=await exportQuestionnaire(ctx,id,store);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);const s=await approvedDisclosure(tx,ctx.organizationId,id);
  if(s.row.reviewerId!==ctx.userId||s.row.version!==d.version||s.row.approvedHash!==verified.approvedHash)throw new IntelligenceError('The disclosure changed. Review its current version.',409);
  const mapped=mapPortalFields(d.capture,s.disclosure.questions);
  if(d.labels.some(label=>!mapped.some(r=>r.label===label&&r.match)))throw new IntelligenceError('A selected field has no unambiguous supported answer',409);
  const recent=await tx.auditEvent.count({where:{organizationId:ctx.organizationId,action:'portal.issued',createdAt:{gt:new Date(Date.now()-3600000)}}});if(recent>=40)throw new IntelligenceError('Hourly portal hand-off limit reached',429);
  const handoffId=randomUUID(),secret=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+10*60000).toISOString();
  await tx.auditEvent.create({data:{id:handoffId,organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'QuestionnaireHandoff',entityId:id,action:'portal.issued',details:{capture:d.capture,labels:d.labels,approvedHash:s.row.approvedHash!,questionnaireId:id,secretHash:secretHash(secret),expiresAt}}});
  return {format:'regpilot-portal-ticket-v1',handoffId,secret,origin:d.capture.origin,pageHash:d.capture.pageHash,labels:d.labels,expiresAt};
 });
}
export async function redeemPortalHandoff(raw:unknown){
 const d=z.object({handoffId:z.uuid(),secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),capture:portalFields}).strict().parse(raw);
 const issued=await db.auditEvent.findFirst({where:{id:d.handoffId,action:'portal.issued',entityType:'QuestionnaireHandoff'}});
 if(!issued)throw bad();const s=saved.parse(issued.details);
 if(Date.parse(s.expiresAt)<=Date.now()||!timingSafeEqual(Buffer.from(s.secretHash,'hex'),Buffer.from(secretHash(d.secret),'hex'))||hashValue(s.capture)!==hashValue(d.capture))throw bad();
 const ctx:AuthorizedContext={organizationId:issued.organizationId,userId:issued.actorId,role:'ADMIN'};
 return transaction(ctx,async tx=>{
  if(Date.parse(s.expiresAt)<=Date.now())throw bad();
  await requireMember(tx,ctx,ADMIN);
  if(await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,action:'portal.redeemed',entityId:issued.id}}))throw bad();
  const disclosure=await approvedDisclosure(tx,ctx.organizationId,s.questionnaireId);
  if(disclosure.row.approvedHash!==s.approvedHash||disclosure.row.reviewerId!==ctx.userId)throw bad();
  const fields=mapPortalFields(d.capture,disclosure.disclosure.questions).filter(f=>s.labels.includes(f.label));
  if(fields.length!==s.labels.length||fields.some(f=>!f.match))throw bad();
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'QuestionnaireHandoff',entityId:issued.id,action:'portal.redeemed',details:{revision:disclosure.row.version,origin:s.capture.origin,approvedHash:s.approvedHash,fields:fields.length}}});
  return {origin:s.capture.origin,pageHash:s.capture.pageHash,expiresAt:s.expiresAt,fields:fields.map(f=>({label:f.label,...f.match!}))};
 });
}
