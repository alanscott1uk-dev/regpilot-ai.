import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {AuditRoom,Prisma} from '@prisma/client';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import type {VerifiedWorkspaceIdentity} from './ai-auth';
import {allowedEmail} from '../ai/security.mjs';
import {verifiedLocalUser} from './team-service';
import {IntelligenceError,transaction} from './intelligence-service';
import {activeRoom,clearedAuditKey,currentAssurance,event,filesWithAvailability,issuerActive,manifest} from './audit-disclosure';
import {ADMIN,requireMember} from './workspace-member';
import {AUDIT_LIMITS} from '../auditor-policy';

type Tx=Prisma.TransactionClient;
const rev=z.number().int().min(0);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('PUBLISH'),revision:rev,title:z.string().trim().min(4).max(120),summary:z.string().trim().min(20).max(600),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)}).strict(),
 z.object({action:z.literal('WITHDRAW'),revision:rev,confirm:z.literal(true)}).strict(),
 z.object({action:z.enum(['APPROVE','DENY']),revision:rev,grantId:z.uuid(),grantVersion:z.number().int().positive()}).strict()
]);
const missing=()=>new IntelligenceError('This public disclosure is unavailable',404);
const editFields={publicKey:true,publicTitle:true,publicSummary:true,publicRevision:true} as const;

async function ready(tx:Tx,room:AuditRoom){
 if(!activeRoom(room)||!await issuerActive(tx,room))return false;
 if(room.publicPublishedBy&&!await issuerActive(tx,{organizationId:room.organizationId,createdById:room.publicPublishedBy}))return false;
 try{await currentAssurance(tx,room);const files=await filesWithAvailability(tx,room.organizationId,manifest(room));return files.length>0&&files.every(f=>f.available);}
 catch(e){if(e instanceof IntelligenceError||e instanceof z.ZodError)return false;throw e;}
}
export async function assertPublicGrant(tx:Tx,room:AuditRoom,grant:{publicRevision:number|null}){
 if(grant.publicRevision!==null&&(!room.publicTitle||room.publicRevision!==grant.publicRevision||!await ready(tx,room)))throw missing();
}
export async function trustPublicationAdmin(ctx:AuthorizedContext,roomId:string){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const room=await tx.auditRoom.findFirst({where:{id:roomId,organizationId:ctx.organizationId},select:editFields});
  if(!room)throw missing();
  const requests=await tx.auditGrant.findMany({where:{organizationId:ctx.organizationId,roomId,status:'REQUESTED',publicRevision:room.publicRevision},select:{id:true,email:true,version:true,createdAt:true},orderBy:{createdAt:'asc'}});
  return {...room,requests};
 });
}

export async function manageTrustPublication(ctx:AuthorizedContext,roomId:string,raw:unknown){
 const d=input.parse(raw);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const room=await tx.auditRoom.findFirst({where:{id:roomId,organizationId:ctx.organizationId}});
  if(!room)throw missing();
  if(d.revision!==room.publicRevision)throw new IntelligenceError('The public summary changed. Refresh before continuing.',409);
  if(d.action==='PUBLISH'||d.action==='WITHDRAW'){
   if(d.action==='PUBLISH'&&(d.manifestHash!==room.manifestHash||!await ready(tx,{...room,publicPublishedBy:ctx.userId})))throw new IntelligenceError('Publishing requires a current room and reviewed evidence',409);
   if(d.action==='WITHDRAW'&&!room.publicTitle)throw new IntelligenceError('This summary has already been withdrawn',409);
   await tx.auditGrant.updateMany({where:{organizationId:ctx.organizationId,roomId,publicRevision:{not:null},status:{in:['REQUESTED','ACCEPTED','PENDING']}},data:{status:'REVOKED',version:{increment:1},...clearedAuditKey}});
   const next=await tx.auditRoom.update({where:{id:roomId},data:{publicKey:room.publicKey??randomUUID(),publicRevision:{increment:1},publicTitle:d.action==='PUBLISH'?d.title:null,publicSummary:d.action==='PUBLISH'?d.summary:null,publicPublishedBy:d.action==='PUBLISH'?ctx.userId:null},select:editFields});
   await event(tx,ctx.organizationId,ctx.userId,'public_summary_'+(d.action==='PUBLISH'?'published':'withdrawn'),roomId,{revision:next.publicRevision,manifestHash:room.manifestHash,...(d.action==='PUBLISH'?{title:d.title,summary:d.summary}:{})});
   return next;
  }
  const grant=await tx.auditGrant.findFirst({where:{id:d.grantId,organizationId:ctx.organizationId,roomId,publicRevision:room.publicRevision,version:d.grantVersion,status:'REQUESTED'},include:{user:true}});
  if(!grant)throw new IntelligenceError('The named access request changed',409);
  if(d.action==='APPROVE'){
   if(!grant.user||grant.user.email!==grant.email||!allowedEmail(grant.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)||!room.publicTitle||!await ready(tx,room))throw new IntelligenceError('The disclosure or buyer identity is unavailable',409);
   if(await tx.auditGrant.count({where:{roomId,status:{in:['PENDING','ACCEPTED']}}})>=AUDIT_LIMITS.guests)throw new IntelligenceError('The room has reached its guest limit',429);
  }
  const next=await tx.auditGrant.update({where:{id:grant.id},data:{status:d.action==='APPROVE'?'PENDING':'DENIED',expiresAt:new Date(Math.min(room.expiresAt.getTime(),Date.now()+AUDIT_LIMITS.inviteDays*86400000)),version:{increment:1}},select:{status:true}});
  await event(tx,ctx.organizationId,ctx.userId,'public_access_'+(d.action==='APPROVE'?'approved':'denied'),roomId,{grantId:grant.id,revision:room.publicRevision});return next;
 });
}

export async function publicSummaries(query:{id?:string;q?:string}){
 const id=query.id?z.uuid().parse(query.id):undefined;
 const q=query.q?.trim()||'';
 if(!id&&(q.length<3||q.length>100))return [];
 const candidates=await db.auditRoom.findMany({
  where:{status:'PUBLISHED',expiresAt:{gt:new Date()},publicTitle:{not:null},...(id?{publicKey:id}:{publicTitle:{contains:q.replace(/[\\%_]/g,'\\$&'),mode:'insensitive'}})},
  select:{id:true,organizationId:true,publicRevision:true},orderBy:{id:'asc'},take:id?1:30
 });
 const output=[];
 for(const candidate of candidates){
  const summary=await transaction({organizationId:candidate.organizationId,userId:'',role:'VIEWER'},async tx=>{
   const room=await tx.auditRoom.findFirst({where:candidate});
   if(!room?.publicTitle||!room.publicSummary||!room.publicKey||!await ready(tx,room))return null;
   return {id:room.publicKey,title:room.publicTitle,summary:room.publicSummary,revision:room.publicRevision,expiresAt:room.expiresAt.toISOString()};
  });
  if(summary)output.push(summary);
 }
 return output;
}
export async function requestTrustAccess(identity:VerifiedWorkspaceIdentity,id:string,raw:unknown){
 const d=z.object({revision:rev}).strict().parse(raw);
 if(!allowedEmail(identity.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw missing();
 const found=await db.auditRoom.findUnique({where:{publicKey:z.uuid().parse(id)},select:{organizationId:true}});
 if(!found)throw missing();
 return transaction({organizationId:found.organizationId,userId:'',role:'VIEWER'},async tx=>{
  const room=await tx.auditRoom.findUnique({where:{publicKey:id}});
  if(!room||!room.publicTitle||d.revision!==room.publicRevision||!await ready(tx,room))throw missing();
  const buyer=await verifiedLocalUser(tx,identity);
  const old=await tx.auditGrant.findUnique({where:{roomId_email:{roomId:room.id,email:identity.email}}});
  if(old&&(old.publicRevision===null||old.publicRevision===room.publicRevision)){
   if(old.userId&&old.userId!==buyer.id)throw missing();
   return {status:old.status};
  }
  const roomPending=await tx.auditGrant.count({where:{roomId:room.id,status:'REQUESTED'}});
  const recent=await tx.auditEvent.count({where:{actorId:buyer.id,action:'auditor.public_access_requested',createdAt:{gt:new Date(Date.now()-86400000)}}});
  if(roomPending>=50||recent>=10)throw new IntelligenceError('The request limit has been reached. Try again later.',429);
  const data={userId:buyer.id,status:'REQUESTED',publicRevision:room.publicRevision,expiresAt:room.expiresAt,acceptedAt:null,...clearedAuditKey};
  const grant=old?await tx.auditGrant.update({where:{id:old.id},data:{...data,version:{increment:1}}}):await tx.auditGrant.create({data:{...data,organizationId:room.organizationId,roomId:room.id,email:identity.email}});
  await event(tx,room.organizationId,buyer.id,'public_access_requested',room.id,{grantId:grant.id,revision:room.publicRevision});return {status:grant.status};
 });
}
