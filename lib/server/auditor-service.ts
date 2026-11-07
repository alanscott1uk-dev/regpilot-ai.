import {Prisma,type AuditRoom,type AuditGrant} from "@prisma/client";
import {db} from "./db";
import {approvedDisclosure} from "./customer-assurance-service";
import {assertAuditRequestsReady} from "./audit-request-service";
import type {AuthorizedContext} from "./authorization";
import type {VerifiedWorkspaceIdentity} from "./ai-auth";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {verifiedLocalUser} from "./team-service";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {AUDIT_LIMITS,roomDraftSchema,roomActionSchema,guestActionSchema,manifestSchema,responseHistorySchema,evidenceStillShareable,type AuditManifest} from "../auditor-policy";
import {privateEvidenceStore,type EvidenceObjectStore} from "./evidence-storage";
import {evidenceHash,contentDispositionFilename} from "../evidence/file-guard.mjs";

type Tx=Prisma.TransactionClient;
const summary={id:true,title:true,purpose:true,status:true,expiresAt:true,publishedAt:true,version:true,createdAt:true,manifestHash:true} as const;
function eligible(email:string){if(!allowedEmail(email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Account is not approved for this pilot",403);}
async function event(tx:Tx,organizationId:string,userId:string,action:string,id:string,details:Prisma.InputJsonValue={}){
 await tx.auditEvent.create({data:{organizationId,actorId:userId,action:"auditor."+action,entityType:"AuditRoom",entityId:id,details}});
}
async function issuerActive(tx:Tx,room:{organizationId:string;createdById:string}){
 const m=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:room.organizationId,userId:room.createdById}},select:{role:true,user:{select:{email:true}}}});
 return !!m&&ADMIN.includes(m.role)&&allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS);
}
function manifest(room:{manifest:unknown;manifestHash:string}):AuditManifest{
 const m=manifestSchema.parse(room.manifest);if(hashValue(m)!==room.manifestHash)throw new IntelligenceError("Shared record integrity check failed",409);return m;
}
async function currentAssurance(tx:Tx,room:{organizationId:string;manifest:unknown;manifestHash:string}){
 const a=manifest(room).assurance;if(!a)return;
 const s=await approvedDisclosure(tx,room.organizationId,a.questionnaireId);
 if(s.row.version!==a.questionnaireVersion||s.row.approvedHash!==a.approvedHash||hashValue({title:s.disclosure.title,scope:s.disclosure.scope,questions:s.disclosure.questions})!==hashValue({title:a.title,scope:a.scope,questions:a.questions}))throw new IntelligenceError("Shared assurance answers changed; prepare a new reviewed share",409);
}
async function filesWithAvailability(tx:Tx,orgId:string,m:AuditManifest){
 const rows=await tx.evidence.findMany({where:{organizationId:orgId,id:{in:m.files.map(f=>f.id)}}});
 return m.files.map(f=>({...f,available:evidenceStillShareable(f,rows.find(r=>r.id===f.id),orgId)}));
}
function activeRoom(room:{status:string;expiresAt:Date}){return room.status==="PUBLISHED"&&room.expiresAt>new Date();}
export async function auditWorkspace(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const [rooms,candidates,controls,members,questionnaires]=await Promise.all([
   tx.auditRoom.findMany({where:{organizationId:ctx.organizationId},select:{...summary,_count:{select:{grants:true,questions:true}}},orderBy:{createdAt:"desc"},take:AUDIT_LIMITS.rooms}),
   tx.evidence.findMany({where:{organizationId:ctx.organizationId,reviewStatus:"APPROVED",scanStatus:"CLEAN",obligation:{organizationId:ctx.organizationId}},select:{id:true,filename:true,sha256:true,reviewVersion:true,reviewedAt:true,uploadedById:true,reviewerId:true,obligation:{select:{title:true}}},orderBy:{createdAt:"desc"},take:201}),
   tx.managedControl.findMany({where:{organizationId:ctx.organizationId,enabled:true},select:{id:true,title:true},orderBy:{title:"asc"},take:100}),
   tx.membership.findMany({where:{organizationId:ctx.organizationId,role:{not:"VIEWER"}},select:{user:{select:{id:true,email:true}}},take:100}),
   tx.assuranceQuestionnaire.findMany({where:{organizationId:ctx.organizationId,status:"APPROVED"},select:{id:true,title:true,scope:true},take:100})
  ]);
  return {rooms,controls,members,questionnaires,candidates:candidates.slice(0,200).filter(e=>e.uploadedById&&e.reviewerId&&e.uploadedById!==e.reviewerId),moreEvidence:candidates.length>200,limits:AUDIT_LIMITS};
 });
}
export async function createAuditRoom(ctx:AuthorizedContext,input:unknown){return transaction(ctx,tx=>createAuditRoomInTransaction(tx,ctx,input));}
export async function createAuditRoomInTransaction(tx:Tx,ctx:AuthorizedContext,input:unknown){
 const d=roomDraftSchema.parse(input),expiresAt=new Date(d.expiresAt);
 if(expiresAt<=new Date()||expiresAt.getTime()>Date.now()+AUDIT_LIMITS.roomDays*86400000)throw new IntelligenceError("Choose an expiry within the next 90 days");
 await requireMember(tx,ctx,ADMIN);
  if(await tx.auditRoom.count({where:{organizationId:ctx.organizationId}})>=AUDIT_LIMITS.rooms)throw new IntelligenceError("This pilot supports 40 audit rooms per organisation",429);
  const disclosure=d.questionnaireId?await approvedDisclosure(tx,ctx.organizationId,d.questionnaireId):null;
  const evidenceIds=[...new Set([...d.evidenceIds,...(disclosure?.files.map(f=>f.id)||[])])];if(evidenceIds.length>50)throw new IntelligenceError("This share supports 50 evidence files",409);
  const rows=await tx.evidence.findMany({where:{id:{in:evidenceIds},organizationId:ctx.organizationId},include:{obligation:{select:{title:true,organizationId:true}}},orderBy:{id:"asc"}});
  if(rows.length!==evidenceIds.length||rows.some(e=>e.scanStatus!=="CLEAN"||e.reviewStatus!=="APPROVED"||!e.reviewedAt||!e.uploadedById||!e.reviewerId||e.uploadedById===e.reviewerId||e.obligation.organizationId!==ctx.organizationId))throw new IntelligenceError("Choose only current, independently approved files from this organisation",409);
  const m:AuditManifest={version:1,...(disclosure?{assurance:{questionnaireId:disclosure.row.id,questionnaireVersion:disclosure.row.version,approvedHash:disclosure.row.approvedHash!,title:disclosure.disclosure.title,scope:disclosure.disclosure.scope,questions:disclosure.disclosure.questions}}:{}),...(d.period?{period:d.period}:{}),capturedAt:new Date().toISOString(),files:rows.map(e=>({id:e.id,obligationId:e.obligationId,taskTitle:e.obligation.title,filename:e.filename,contentType:e.contentType,sizeBytes:e.sizeBytes,sha256:e.sha256,reviewVersion:e.reviewVersion,reviewedAt:e.reviewedAt!.toISOString()}))};
  manifestSchema.parse(m);
  const room=await tx.auditRoom.create({data:{organizationId:ctx.organizationId,createdById:ctx.userId,title:d.title,purpose:d.purpose,expiresAt,manifest:m,manifestHash:hashValue(m)},select:summary});
  await event(tx,ctx.organizationId,ctx.userId,"draft_created",room.id,{files:rows.length,manifestHash:room.manifestHash});return room;

}

export async function manageAuditRoom(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const room=await tx.auditRoom.findFirst({where:{id,organizationId:ctx.organizationId},select:{...summary,manifest:true,createdById:true}});
  if(!room)throw new IntelligenceError("Audit room not found",404);
  const [grants,questions,activity,files]=await Promise.all([
   tx.auditGrant.findMany({where:{roomId:id,organizationId:ctx.organizationId},select:{id:true,email:true,status:true,version:true,expiresAt:true,acceptedAt:true},orderBy:{createdAt:"desc"}}),
   tx.auditQuestion.findMany({where:{roomId:id,organizationId:ctx.organizationId},select:{id:true,grantId:true,evidenceId:true,question:true,response:true,responses:true,status:true,version:true,createdAt:true,answeredAt:true,grant:{select:{email:true}}},orderBy:{createdAt:"desc"},take:AUDIT_LIMITS.questions}),
   tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:"AuditRoom",entityId:id},select:{id:true,action:true,createdAt:true,actor:{select:{email:true}}},orderBy:{createdAt:"desc"},take:50}),
   filesWithAvailability(tx,ctx.organizationId,manifest(room))
  ]);
  const {manifest:_,createdById:__,...publicRoom}=room;
  return {room:publicRoom,assurance:manifest(room).assurance,period:manifest(room).period,requests:manifest(room).requests||[],files,grants,questions:questions.map(q=>({...q,responses:responseHistorySchema.parse(q.responses)})),activity};
 });
}
export async function changeAuditRoom(ctx:AuthorizedContext,id:string,input:unknown){
 const d=roomActionSchema.parse(input);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const room=await tx.auditRoom.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!room)throw new IntelligenceError("Audit room not found",404);
  if(d.action==="CLOSE"||d.action==="PUBLISH"){
   if(room.version!==d.version||room.status==="CLOSED")throw new IntelligenceError("Room changed; refresh before continuing",409);
   if(d.action==="PUBLISH"){
    if(room.status!=="DRAFT"||room.expiresAt<=new Date()||!await issuerActive(tx,room))throw new IntelligenceError("This draft can no longer be published",409);
    if(room.manifestHash!==d.manifestHash)throw new IntelligenceError("Review the current disclosure before publishing",409);
    await assertAuditRequestsReady(tx,ctx,id);await currentAssurance(tx,room);
    const files=await filesWithAvailability(tx,ctx.organizationId,manifest(room));
    if(!files.length)throw new IntelligenceError("Select or accept reviewed evidence before publishing",409);
    if(files.some(f=>!f.available))throw new IntelligenceError("Selected evidence changed. Prepare a new room with current files",409);
   }
   const updated=await tx.auditRoom.update({where:{id},data:{status:d.action==="PUBLISH"?"PUBLISHED":"CLOSED",version:{increment:1},...(d.action==="PUBLISH"?{publishedAt:new Date()}: {})},select:summary});
   if(d.action==="CLOSE")await tx.auditGrant.updateMany({where:{roomId:id,status:{in:["PENDING","ACCEPTED"]}},data:{status:"REVOKED",version:{increment:1}}});
   await event(tx,ctx.organizationId,ctx.userId,d.action==="PUBLISH"?"published":"closed",id,{manifestHash:room.manifestHash});return updated;
  }
  if(d.action==="REVOKE"){
   const changed=await tx.auditGrant.updateMany({where:{id:d.grantId,roomId:id,organizationId:ctx.organizationId,version:d.version,status:{in:["PENDING","ACCEPTED"]}},data:{status:"REVOKED",version:{increment:1}}});
   if(changed.count!==1)throw new IntelligenceError("Guest access changed; refresh",409);
   await event(tx,ctx.organizationId,ctx.userId,"guest_revoked",id,{grantId:d.grantId});return {status:"REVOKED"};
  }
  if(!activeRoom(room)||!await issuerActive(tx,room))throw new IntelligenceError("Audit room is closed or expired",409);
  if(d.action==="INVITE"){
   eligible(d.email);if(room.version!==d.version)throw new IntelligenceError("Room changed; refresh",409);
   if(await tx.auditGrant.findUnique({where:{roomId_email:{roomId:id,email:d.email}}}))throw new IntelligenceError("This email already has an invitation. Use a new room for renewed access",409);
   if(await tx.auditGrant.count({where:{roomId:id}})>=AUDIT_LIMITS.guests)throw new IntelligenceError("This room supports ten named guests",429);
   const grant=await tx.auditGrant.create({data:{organizationId:ctx.organizationId,roomId:id,email:d.email,expiresAt:new Date(Math.min(room.expiresAt.getTime(),Date.now()+AUDIT_LIMITS.inviteDays*86400000))},select:{id:true,status:true,version:true,expiresAt:true}});
   await event(tx,ctx.organizationId,ctx.userId,"guest_invited",id,{grantId:grant.id});return grant;
  }
  const question=await tx.auditQuestion.findFirst({where:{id:d.questionId,roomId:id,organizationId:ctx.organizationId}});
  if(!question)throw new IntelligenceError("Question not found",404);
  const history=responseHistorySchema.parse(question.responses);
  if(history.length>=20)throw new IntelligenceError("Response limit reached; ask the reviewer to open a follow-up question",429);
  const answeredAt=new Date();
  const changed=await tx.auditQuestion.updateMany({where:{id:d.questionId,roomId:id,organizationId:ctx.organizationId,version:d.version,status:"OPEN"},data:{response:d.response,responses:[...history,{response:d.response,answeredAt:answeredAt.toISOString(),version:d.version+1}],status:"ANSWERED",answeredById:ctx.userId,answeredAt,version:{increment:1}}});
  if(changed.count!==1)throw new IntelligenceError("Question changed or was already answered; refresh",409);
  await event(tx,ctx.organizationId,ctx.userId,"question_answered",id,{questionId:d.questionId});return {status:"ANSWERED"};
 });
}

// Only server-verified Supabase identities may call guest services; no caller-supplied
// organisation, role or email is used at the HTTP boundary.
async function guestTransaction<T>(identity:VerifiedWorkspaceIdentity,grantId:string,accepted:boolean,fn:(tx:Tx,grant:AuditGrant,room:AuditRoom,userId:string)=>Promise<T>):Promise<T>{
 eligible(identity.email);
 const found=await db.auditGrant.findFirst({where:{id:grantId,email:identity.email},select:{organizationId:true}});
 if(!found)throw new IntelligenceError("Audit access unavailable",404);
 return transaction({organizationId:found.organizationId,userId:"",role:"VIEWER"},async tx=>{
  const grant=await tx.auditGrant.findFirst({where:{id:grantId,email:identity.email,organizationId:found.organizationId},include:{room:true,user:{select:{externalId:true}}}});
  if(!grant||!activeRoom(grant.room)||!await issuerActive(tx,grant.room)||!["PENDING","ACCEPTED"].includes(grant.status)||(grant.status==="PENDING"&&grant.expiresAt<=new Date()))throw new IntelligenceError("Audit access unavailable",404);
  if(grant.user&&grant.user.externalId!==identity.externalId)throw new IntelligenceError("Audit access unavailable",404);
  if(accepted&&grant.status!=="ACCEPTED")throw new IntelligenceError("Accept this invitation before opening the room",403);
  await currentAssurance(tx,grant.room);
  const user=await verifiedLocalUser(tx,identity);
  if(grant.status==="ACCEPTED"&&grant.userId!==user.id)throw new IntelligenceError("Audit access unavailable",404);
  return fn(tx,grant,grant.room,user.id);
 });
}
export async function auditInbox(identity:VerifiedWorkspaceIdentity){
 eligible(identity.email);
 const local=await db.user.findUnique({where:{email:identity.email},select:{externalId:true}});
 if(local&&local.externalId!==identity.externalId)throw new IntelligenceError("Account identity needs administrator review",409);
 const rows=await db.auditGrant.findMany({where:{email:identity.email,status:{in:["PENDING","ACCEPTED"]},room:{status:"PUBLISHED",expiresAt:{gt:new Date()}}},select:{id:true,status:true,version:true,expiresAt:true,user:{select:{externalId:true}},room:{select:{...summary,organizationId:true,createdById:true,organization:{select:{name:true}}}}},orderBy:{createdAt:"desc"},take:100});
 const result=[];
 for(const row of rows){
  if(row.user&&row.user.externalId!==identity.externalId||row.status==="PENDING"&&row.expiresAt<=new Date()||!await issuerActive(db,row.room))continue;
  result.push({id:row.id,status:row.status,version:row.version,invitationExpiresAt:row.expiresAt,title:row.room.title,organizationName:row.room.organization.name,expiresAt:row.room.expiresAt});
 }
 return result;
}
export async function openAuditRoom(identity:VerifiedWorkspaceIdentity,grantId:string){
 return guestTransaction(identity,grantId,true,async(tx,g,room,userId)=>{
  const files=await filesWithAvailability(tx,room.organizationId,manifest(room));
  const questions=await tx.auditQuestion.findMany({where:{organizationId:room.organizationId,roomId:room.id,grantId:g.id},select:{id:true,evidenceId:true,question:true,response:true,responses:true,status:true,version:true,createdAt:true,answeredAt:true},orderBy:{createdAt:"desc"},take:AUDIT_LIMITS.questions});
  await event(tx,room.organizationId,userId,"room_opened",room.id,{grantId:g.id});
  return {room:{title:room.title,purpose:room.purpose,expiresAt:room.expiresAt,publishedAt:room.publishedAt,manifestHash:room.manifestHash,assurance:manifest(room).assurance?{title:manifest(room).assurance!.title,scope:manifest(room).assurance!.scope,questions:manifest(room).assurance!.questions}:null,period:manifest(room).period,requests:manifest(room).requests||[]},files,questions:questions.map(q=>({...q,responses:responseHistorySchema.parse(q.responses)}))};
 });
}
export async function guestAuditAction(identity:VerifiedWorkspaceIdentity,grantId:string,input:unknown){
 const d=guestActionSchema.parse(input);
 return guestTransaction(identity,grantId,d.action!=="ACCEPT"&&d.action!=="DECLINE",async(tx,g,room,userId)=>{
  if(d.action==="ACCEPT"||d.action==="DECLINE"){
   if(g.status!=="PENDING"||g.version!==d.version)throw new IntelligenceError("Invitation changed; refresh",409);
   const status=d.action==="ACCEPT"?"ACCEPTED":"DECLINED";
   await tx.auditGrant.update({where:{id:g.id},data:{status,userId,acceptedAt:d.action==="ACCEPT"?new Date():null,version:{increment:1}}});
   await event(tx,room.organizationId,userId,"invitation_"+status.toLowerCase(),room.id,{grantId:g.id});return {status};
  }
  if(d.action==="QUESTION"){
   if(d.evidenceId&&!manifest(room).files.some(f=>f.id===d.evidenceId))throw new IntelligenceError("Choose a file in this room",404);
   if(await tx.auditQuestion.count({where:{roomId:room.id}})>=AUDIT_LIMITS.questions||await tx.auditQuestion.count({where:{grantId:g.id,createdAt:{gte:new Date(Date.now()-86400000)}}})>=AUDIT_LIMITS.dailyQuestions)throw new IntelligenceError("Question limit reached. Contact the room owner",429);
   const q=await tx.auditQuestion.create({data:{organizationId:room.organizationId,roomId:room.id,grantId:g.id,evidenceId:d.evidenceId,question:d.question},select:{id:true,status:true}});
   await event(tx,room.organizationId,userId,"question_created",room.id,{questionId:q.id,grantId:g.id});return q;
  }
  const status=d.action==="RESOLVE"?"RESOLVED":"OPEN";
  const changed=await tx.auditQuestion.updateMany({where:{id:d.questionId,roomId:room.id,grantId:g.id,organizationId:room.organizationId,version:d.version,status:d.action==="RESOLVE"?"ANSWERED":"RESOLVED"},data:{status,version:{increment:1}}});
  if(changed.count!==1)throw new IntelligenceError("Question changed; refresh",409);
  await event(tx,room.organizationId,userId,"question_"+status.toLowerCase(),room.id,{questionId:d.questionId,grantId:g.id});return {status};
 });
}
export async function downloadAuditEvidence(identity:VerifiedWorkspaceIdentity,grantId:string,evidenceId:string,store?:EvidenceObjectStore){
 const prepared=await guestTransaction(identity,grantId,true,async(tx,g,room)=>{
  const file=manifest(room).files.find(f=>f.id===evidenceId);
  if(!file)throw new IntelligenceError("Shared file unavailable",404);
  const record=await tx.evidence.findFirst({where:{id:evidenceId,organizationId:room.organizationId}});
  if(!evidenceStillShareable(file,record,room.organizationId))throw new IntelligenceError("Evidence changed or was withdrawn; ask for a new reviewed share",409);
  return {file,storageKey:record!.storageKey,manifestHash:room.manifestHash};
 });
 const backend=store||await privateEvidenceStore(),bytes=await backend.get(prepared.storageKey);
 if(bytes.byteLength!==prepared.file.sizeBytes||evidenceHash(bytes)!==prepared.file.sha256)throw new IntelligenceError("File integrity verification failed",409);
 // Recheck after async storage retrieval: a revoked invitation, expired room or
 // changed/quarantined file must never be returned by a request already in flight.
 await guestTransaction(identity,grantId,true,async(tx,g,room,userId)=>{
  const file=manifest(room).files.find(f=>f.id===evidenceId);
  const record=await tx.evidence.findFirst({where:{id:evidenceId,organizationId:room.organizationId}});
  if(room.manifestHash!==prepared.manifestHash||!file||!evidenceStillShareable(file,record,room.organizationId)||record!.storageKey!==prepared.storageKey)throw new IntelligenceError("Shared evidence changed during retrieval",409);
  await event(tx,room.organizationId,userId,"file_downloaded",room.id,{grantId:g.id,evidenceId,sha256:file.sha256});
 });
 return {bytes,filename:contentDispositionFilename(prepared.file.filename),contentType:prepared.file.contentType,sha256:prepared.file.sha256};
}

export async function exportAuditPackage(ctx:AuthorizedContext,id:string){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);const room=await tx.auditRoom.findFirst({where:{id,organizationId:ctx.organizationId}});
 if(!room||!activeRoom(room)||!await issuerActive(tx,room))throw new IntelligenceError("Published audit package unavailable",404);
 await currentAssurance(tx,room);const m=manifest(room),files=await filesWithAvailability(tx,ctx.organizationId,m);if(files.some(f=>!f.available))throw new IntelligenceError("Package evidence changed; prepare a current reviewed share",409);
 await event(tx,ctx.organizationId,ctx.userId,"package_index_exported",id);
 return {format:"regpilot-audit-package-index-v1",title:room.title,purpose:room.purpose,publishedAt:room.publishedAt,manifest:m,manifestHash:room.manifestHash,limitation:"An index of selected files and reviewer-accepted period claims, not file bytes, a digital signature, a complete audit population or a control-effectiveness opinion."};
});}

export async function exportAuditArchive(ctx:AuthorizedContext,id:string,store?:EvidenceObjectStore){
 const before=await exportAuditPackage(ctx,id);if(before.manifest.files.reduce((n,f)=>n+f.sizeBytes,0)>30*1024*1024)throw new IntelligenceError("Split the package into selections of at most 30 MB for archive download",413);
 const {downloadEvidence}=await import("./evidence-service"),{makeAuditZip,archiveFilename}=await import("../audit-archive");const entries:Array<{name:string;bytes:Uint8Array}>=[];
 for(const [i,f] of before.manifest.files.entries()){const actual=await downloadEvidence(ctx,f.id,store);if(actual.sha256!==f.sha256||actual.bytes.byteLength!==f.sizeBytes)throw new IntelligenceError("Package bytes changed during retrieval",409);entries.push({name:archiveFilename(i,f.filename),bytes:actual.bytes});}
 const after=await exportAuditPackage(ctx,id);if(after.manifestHash!==before.manifestHash)throw new IntelligenceError("Published selection changed during retrieval",409);
 const index={...after,format:"regpilot-audit-archive-v1",archiveFiles:entries.map((e,i)=>({entry:e.name,evidenceId:after.manifest.files[i].id,sha256:after.manifest.files[i].sha256})),limitation:"Selected reviewed files and accepted coverage claims. The population and sample limitations remain part of the record; this is not certification or a digital signature."};return makeAuditZip([{name:"manifest.json",bytes:Buffer.from(JSON.stringify(index,null,2))},...entries]);
}
