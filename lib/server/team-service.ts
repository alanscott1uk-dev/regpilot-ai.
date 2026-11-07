import {Prisma} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {allowedEmail} from "../ai/security.mjs";
import {mayManageRole,TEAM_LIMITS} from "../team-policy";
import {invitationSchema,memberChangeSchema,invitationDecisionSchema} from "./team-inputs";
import type {VerifiedWorkspaceIdentity} from "./ai-auth";

async function event(tx:Prisma.TransactionClient,ctx:AuthorizedContext,action:string,entityId:string,details:Prisma.InputJsonValue={}){
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action,entityType:"WorkspaceAccess",entityId,details}});
}
function eligible(email:string){if(!allowedEmail(email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("This account is not approved for the private pilot",403);}
const inviteSelect={id:true,email:true,role:true,status:true,version:true,expiresAt:true,createdAt:true} as const;

export async function teamWorkspace(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  const member=await requireMember(tx,ctx,ADMIN);
  const members=await tx.membership.findMany({where:{organizationId:ctx.organizationId},select:{role:true,user:{select:{id:true,email:true}}},orderBy:{userId:"asc"},take:TEAM_LIMITS.members+1});
  const invitations=await tx.workspaceInvitation.findMany({where:{organizationId:ctx.organizationId},select:inviteSelect,orderBy:{createdAt:"desc"},take:100});
  const activity=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:"WorkspaceAccess"},select:{id:true,action:true,createdAt:true,actor:{select:{email:true}}},orderBy:{createdAt:"desc"},take:30});
  return {members:members.slice(0,TEAM_LIMITS.members),memberLimitReached:members.length>TEAM_LIMITS.members,invitations,activity,role:member.role,limits:TEAM_LIMITS};
 });
}
export async function inviteMember(ctx:AuthorizedContext,input:unknown){
 const d=invitationSchema.parse(input);eligible(d.email);
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN);
  if(!mayManageRole(actor.role,d.role))throw new IntelligenceError("Only an owner can invite administrators",403);
  if(await tx.membership.findFirst({where:{organizationId:ctx.organizationId,user:{email:d.email}}}))throw new IntelligenceError("This person already belongs to the organisation",409);
  const now=new Date(),pending={organizationId:ctx.organizationId,status:"PENDING",expiresAt:{gt:now}};
  const existing=await tx.workspaceInvitation.findFirst({where:{...pending,email:d.email},select:inviteSelect});
  if(existing){if(existing.role!==d.role)throw new IntelligenceError("Revoke the existing invitation before changing its role",409);return {...existing,reused:true};}
  if(await tx.membership.count({where:{organizationId:ctx.organizationId}})>=TEAM_LIMITS.members)throw new IntelligenceError("This pilot supports up to 100 members",409);
  if(await tx.workspaceInvitation.count({where:pending})>=TEAM_LIMITS.pending)throw new IntelligenceError("Resolve existing invitations before adding more",429);
  if(await tx.workspaceInvitation.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(now.getTime()-86400000)}}})>=TEAM_LIMITS.dailyInvitations)throw new IntelligenceError("Daily invitation limit reached; try again tomorrow",429);
  const saved=await tx.workspaceInvitation.create({data:{organizationId:ctx.organizationId,email:d.email,role:d.role,invitedById:ctx.userId,expiresAt:new Date(now.getTime()+TEAM_LIMITS.expiryDays*86400000)},select:inviteSelect});
  await event(tx,ctx,"team.invitation_created",saved.id,{role:d.role});return {...saved,reused:false};
 });
}
export async function revokeInvitation(ctx:AuthorizedContext,id:string,version:number){
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN),inv=await tx.workspaceInvitation.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!inv)throw new IntelligenceError("Invitation not found",404);
  if(!mayManageRole(actor.role,inv.role))throw new IntelligenceError("Only an owner can revoke administrator invitations",403);
  if(inv.status!=="PENDING"||inv.version!==version)throw new IntelligenceError("Invitation changed; refresh before continuing",409);
  await tx.workspaceInvitation.update({where:{id},data:{status:"REVOKED",resolvedAt:new Date(),version:{increment:1}}});
  await event(tx,ctx,"team.invitation_revoked",id);return {id,status:"REVOKED"};
 });
}

// The HTTP boundary must obtain this identity from verifyAiIdentity. Never accept it from JSON.
export async function invitationInbox(identity:VerifiedWorkspaceIdentity){
 eligible(identity.email);
 return db.workspaceInvitation.findMany({where:{email:identity.email,status:"PENDING",expiresAt:{gt:new Date()}},select:{id:true,role:true,version:true,expiresAt:true,organization:{select:{id:true,name:true}}},orderBy:{createdAt:"desc"},take:50});
}
export async function decideInvitation(identity:VerifiedWorkspaceIdentity,input:unknown){
 const d=invitationDecisionSchema.parse(input);eligible(identity.email);
 // Email-scoped lookup prevents invitation IDs from revealing another account's workspace.
 const found=await db.workspaceInvitation.findFirst({where:{id:d.id,email:identity.email},select:{organizationId:true}});
 if(!found)throw new IntelligenceError("Invitation not available",404);
 const lockContext:AuthorizedContext={organizationId:found.organizationId,userId:"",role:"VIEWER"};
 return transaction(lockContext,async tx=>{
  const inv=await tx.workspaceInvitation.findFirst({where:{id:d.id,email:identity.email,organizationId:found.organizationId}});
  if(!inv||inv.status!=="PENDING"||inv.version!==d.version||inv.expiresAt<=new Date())throw new IntelligenceError("Invitation expired or changed; ask the owner for a new one",409);
  const issuer=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:inv.organizationId,userId:inv.invitedById}},select:{role:true,user:{select:{email:true}}}});
  if(d.decision==="ACCEPT"&&(!issuer||!allowedEmail(issuer.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)||!mayManageRole(issuer.role,inv.role)))throw new IntelligenceError("The inviter no longer has permission; ask an owner for a new invitation",409);
  const user=await verifiedLocalUser(tx,identity),ctx={...lockContext,userId:user.id};
  if(d.decision==="ACCEPT"){
   const existing=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:inv.organizationId,userId:user.id}}});
   if(existing)throw new IntelligenceError("You already belong to this organisation; decline this invitation",409);
   if(await tx.membership.count({where:{organizationId:inv.organizationId}})>=TEAM_LIMITS.members)throw new IntelligenceError("This workspace has reached its member limit",409);
   await tx.membership.create({data:{organizationId:inv.organizationId,userId:user.id,role:inv.role}});
  }
  const status=d.decision==="ACCEPT"?"ACCEPTED":"DECLINED";
  await tx.workspaceInvitation.update({where:{id:inv.id},data:{status,version:{increment:1},resolvedAt:new Date()}});
  await event(tx,ctx,"team.invitation_"+status.toLowerCase(),inv.id,{role:inv.role});return {status,organizationId:inv.organizationId};
 });
}
export async function verifiedLocalUser(tx:Prisma.TransactionClient,identity:VerifiedWorkspaceIdentity){
 const collision=await tx.user.findUnique({where:{email:identity.email},select:{externalId:true}});
 if(collision&&collision.externalId!==identity.externalId)throw new IntelligenceError("Account identity needs administrator review",409);
 return tx.user.upsert({where:{externalId:identity.externalId},create:{externalId:identity.externalId,email:identity.email},update:{email:identity.email}});
}
export async function changeMember(ctx:AuthorizedContext,input:unknown){
 const d=memberChangeSchema.parse(input);
 return transaction(ctx,async tx=>{
  const actor=await requireMember(tx,ctx,ADMIN);
  const key={organizationId:ctx.organizationId,userId:d.userId},target=await tx.membership.findUnique({where:{organizationId_userId:key},include:{user:{select:{email:true}}}});
  if(!target)throw new IntelligenceError("Team member not found",404);
  if(d.userId===ctx.userId)throw new IntelligenceError("Use ownership transfer to change your own access",409);
  if(target.role!==d.expectedRole)throw new IntelligenceError("This member's role changed; refresh before continuing",409);
  if(d.action==="TRANSFER"){
   if(actor.role!=="OWNER"||target.role!=="ADMIN")throw new IntelligenceError("Only an owner can transfer ownership to an existing administrator",403);
   eligible(target.user.email);
   await tx.membership.update({where:{organizationId_userId:key},data:{role:"OWNER"}});
   await tx.membership.update({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}},data:{role:"ADMIN"}});
   await event(tx,ctx,"team.ownership_transferred",d.userId);return {userId:d.userId,role:"OWNER"};
  }
  if(!mayManageRole(actor.role,target.role,d.role))throw new IntelligenceError("Your role cannot change this member's access",403);
  if(d.action==="ROLE"&&!d.role)throw new IntelligenceError("Choose a role");
  // Hand over open work atomically, preserving historical approvals and completed work.
  if(d.action==="REMOVE"||d.role==="VIEWER"){
   const [controls,tasks,requirements]=await Promise.all([
    tx.managedControl.count({where:{organizationId:ctx.organizationId,ownerId:d.userId,enabled:true}}),
    tx.obligation.count({where:{organizationId:ctx.organizationId,assigneeId:d.userId,status:{not:"COMPLETE"}}}),
    tx.$queryRaw<Array<{id:string}>>`SELECT latest.id FROM (
      SELECT DISTINCT ON (a."revisionId") a.id,a."ownerId",a.decision
      FROM "LibraryApplicability" a JOIN "LibraryRevision" r ON r.id=a."revisionId" AND r."organizationId"=a."organizationId"
      JOIN "LibraryRequirement" q ON q.id=r."requirementId" AND q."organizationId"=r."organizationId"
      WHERE a."organizationId"=${ctx.organizationId}::uuid AND r.status='ACCEPTED' AND r.number=q."currentRevision"
      ORDER BY a."revisionId",a."updatedAt" DESC,a.id DESC
    ) latest WHERE latest."ownerId"=${d.userId}::uuid AND latest.decision='APPLIES'`
   ]);
   if(controls+tasks+requirements.length){
    if(!d.replacementId||d.replacementId===d.userId)throw new IntelligenceError(`Choose a replacement owner for ${controls} active controls, ${tasks} open tasks and ${requirements.length} requirements`,409);
    const replacement=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:d.replacementId}},include:{user:{select:{email:true}}}});
    if(!replacement||replacement.role==="VIEWER")throw new IntelligenceError("Choose an active colleague who can edit work",409);
    eligible(replacement.user.email);
    await tx.managedControl.updateMany({where:{organizationId:ctx.organizationId,ownerId:d.userId,enabled:true},data:{ownerId:d.replacementId,version:{increment:1}}});
    await tx.obligation.updateMany({where:{organizationId:ctx.organizationId,assigneeId:d.userId,status:{not:"COMPLETE"}},data:{assigneeId:d.replacementId,ownerName:replacement.user.email}});
    // A handover is not an applicability approval. Existing relationship contexts become stale.
    await tx.libraryApplicability.updateMany({where:{organizationId:ctx.organizationId,id:{in:requirements.map(r=>r.id)}},data:{ownerId:d.replacementId,version:{increment:1}}});
    await event(tx,ctx,"team.responsibilities_transferred",d.userId,{replacementId:d.replacementId,controls,tasks,requirements:requirements.length});
   }
  }
  if(d.action==="REMOVE")await tx.membership.delete({where:{organizationId_userId:key}});
  else await tx.membership.update({where:{organizationId_userId:key},data:{role:d.role!}});
  if(d.action==="REMOVE"||d.role==="EDITOR"||d.role==="VIEWER"){
   const connectors=await tx.evidenceConnector.updateMany({where:{organizationId:ctx.organizationId,configuredById:d.userId},data:{enabled:false,encryptedSecret:null,leaseToken:null,leaseUntil:null,version:{increment:1},failureCode:"PERMISSION_REVOKED"}});
   const watches=await tx.watchSchedule.updateMany({where:{organizationId:ctx.organizationId,configuredById:d.userId},data:{enabled:false,leaseToken:null,leaseUntil:null,version:{increment:1},failureCode:"PERMISSION_REVOKED"}});
   const schedules=await tx.managedControl.updateMany({where:{organizationId:ctx.organizationId,scheduledById:d.userId,enabled:true},data:{enabled:false,version:{increment:1}}});
   if(connectors.count+watches.count+schedules.count)await event(tx,ctx,"team.automation_paused",d.userId,{connectors:connectors.count,watches:watches.count,controls:schedules.count});
  }
  // Outstanding grants from a changed administrator must never survive a later re-promotion.
  await tx.workspaceInvitation.updateMany({where:{organizationId:ctx.organizationId,invitedById:d.userId,status:"PENDING"},data:{status:"REVOKED",version:{increment:1},resolvedAt:new Date()}});
  await event(tx,ctx,d.action==="REMOVE"?"team.member_removed":"team.role_changed",d.userId,{previousRole:target.role,role:d.action==="REMOVE"?null:d.role!});
  return {userId:d.userId,role:d.action==="REMOVE"?null:d.role};
 });
}
