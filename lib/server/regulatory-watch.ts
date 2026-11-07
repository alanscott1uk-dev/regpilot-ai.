import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {loadOfficialSource,loadPublication} from "./ai-sources";
import {resolveWorkspaceSource} from "./publication-catalogue";
import {sourceTextHash,canonicalSourceText,compareSourceText,publicSnapshot} from "../regulatory/source-fingerprint.mjs";
import {Prisma} from "@prisma/client";
export class RegulatoryWatchError extends Error{
 status:number;
 constructor(message:string,status=400){super(message);this.name="RegulatoryWatchError";this.status=status;}
}
type Official={id:string;title:string;url:string;updatedAt:string|null;revisionAt:string|null;text:string};
export type Loader=(sourceId:string)=>Promise<Official|null>;
const roles=["OWNER","ADMIN","EDITOR"];
const validUuid=(x:unknown):x is string=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export async function listSourceSnapshots(ctx:AuthorizedContext,sourceId?:string){
 const snapshots=await db.regulatorySnapshot.findMany({
  where:{organizationId:ctx.organizationId,...(sourceId?{sourceId}:{})},
  orderBy:[{firstCapturedAt:"desc"},{id:"desc"}],take:60
 });
 return snapshots.map(publicSnapshot);
}
export async function checkOfficialSource(ctx:AuthorizedContext,sourceId:string,loader?:Loader,guard?:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!roles.includes(ctx.role))throw new RegulatoryWatchError("Insufficient permission to check official source",403);
 const source=await resolveWorkspaceSource(db,ctx.organizationId,sourceId);
 if(!source)throw new RegulatoryWatchError("Unknown official source",400);
 const previous=await db.regulatorySnapshot.findFirst({
  where:{organizationId:ctx.organizationId,sourceId},orderBy:{firstCapturedAt:"desc"}
 });
 const now=new Date();
 if(previous&&now.getTime()-previous.lastCheckedAt.getTime()<15*60*1000){
  return {state:"COOLDOWN",snapshot:publicSnapshot(previous),comparison:{state:"UNCHANGED",changed:false,added:[],removed:[]},
   note:"Last check was less than 15 minutes ago; official source was not fetched again."};
 }
 const official=await (loader?loader(sourceId):loadPublication(source));
 if(!official||official.id!==sourceId||typeof official.text!=="string")
  throw new RegulatoryWatchError("The selected official publication is unavailable",503);
 const text=canonicalSourceText(official.text),hash=sourceTextHash(text);
 const result=await db.$transaction(async tx=>{
  if(guard)await guard(tx);
  const latest=await tx.regulatorySnapshot.findFirst({
   where:{organizationId:ctx.organizationId,sourceId},orderBy:{firstCapturedAt:"desc"}
  });
  if(latest&&latest.contentHash===hash){
   const refreshed=await tx.regulatorySnapshot.update({where:{id:latest.id},data:{lastCheckedAt:now,
    title:official.title,revisionAt:official.revisionAt}});
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
    action:"regulatory.source_text_unchanged",entityType:"RegulatorySnapshot",entityId:latest.id,
    details:{sourceId,hash,checkedAt:now.toISOString()}
   }});
   return {state:"UNCHANGED",snapshot:publicSnapshot(refreshed),
    comparison:{state:"UNCHANGED",changed:false,added:[],removed:[]}};
  }
  const comparison=compareSourceText(latest?.bodyText||"",text);
  const row=await tx.regulatorySnapshot.create({data:{
   organizationId:ctx.organizationId,sourceId,title:official.title,url:official.url,
   bodyText:text,contentHash:hash,revisionAt:official.revisionAt,
   addedSnippets:comparison.added as Prisma.InputJsonValue,
   removedSnippets:comparison.removed as Prisma.InputJsonValue,
   capturedById:ctx.userId,
   reviewStatus:"NEEDS_REVIEW"
  }});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
   action:comparison.changed?"regulatory.source_text_changed":"regulatory.baseline_created",
   entityType:"RegulatorySnapshot",entityId:row.id,
   details:{sourceId,hash,previousHash:latest?.contentHash||null,changedText:comparison.changed}
  }});
  return {state:comparison.state,snapshot:publicSnapshot(row),comparison};
 },{isolationLevel:"Serializable",maxWait:3500,timeout:10000});
 return {...result,note:result.state==="CONTENT_CHANGED"?
  "Publication text changed. An expert must determine whether any legal requirement changed.":
  "Text baseline saved or rechecked. This is not a legal compliance verdict."};
}
export async function reviewSourceSnapshot(ctx:AuthorizedContext,id:string,data:unknown){
 if(!["OWNER","ADMIN"].includes(ctx.role))throw new RegulatoryWatchError("Independent reviewer required",403);
 if(!validUuid(id))throw new RegulatoryWatchError("Invalid source snapshot ID",400);
 if(!data||typeof data!=="object"||Array.isArray(data))throw new RegulatoryWatchError("Invalid review",400);
 const input=data as {status?:string;notes?:string;version?:number};
 if(!["REVIEWED","NOT_APPLICABLE"].includes(input.status||""))throw new RegulatoryWatchError("Invalid source review decision",400);
 if(!Number.isInteger(input.version)||Number(input.version)<1)throw new RegulatoryWatchError("Invalid source version",400);
 if(typeof input.notes!=="string"||input.notes.trim().length<20||input.notes.length>800)
  throw new RegulatoryWatchError("Enter review rationale of at least 20 characters",400);
 const notes=input.notes.trim();
 return db.$transaction(async tx=>{
  const row=await tx.regulatorySnapshot.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!row)throw new RegulatoryWatchError("Source snapshot not found",404);
  if(row.capturedById===ctx.userId)throw new RegulatoryWatchError("A different reviewer must assess this source",403);
  if(row.reviewStatus!=="NEEDS_REVIEW"||row.version!==input.version)
   throw new RegulatoryWatchError("This source was already reviewed or changed; refresh",409);
  const changed=await tx.regulatorySnapshot.updateMany({where:{
   id,organizationId:ctx.organizationId,version:input.version,reviewStatus:"NEEDS_REVIEW"},
   data:{reviewStatus:input.status as "REVIEWED"|"NOT_APPLICABLE",
    reviewNotes:notes,reviewedAt:new Date(),version:{increment:1}}
  });
  if(changed.count!==1)throw new RegulatoryWatchError("Review conflict",409);
  await tx.regulatorySnapshot.update({where:{id},data:{reviewer:{connect:{id:ctx.userId}}}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
   action:"regulatory.human_impact_review",entityType:"RegulatorySnapshot",entityId:id,
   details:{sourceId:row.sourceId,contentHash:row.contentHash,decision:input.status,reviewVersion:input.version+1}
  }});
  const updated=await tx.regulatorySnapshot.findFirstOrThrow({where:{id,organizationId:ctx.organizationId}});
  return publicSnapshot(updated);
 },{isolationLevel:"Serializable"});
}
