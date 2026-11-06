import {Prisma} from "@prisma/client";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {analysePublication,ENGINE_VERSION,evidenceReadiness,hashValue,parseProfile,type Analysis} from "../regulatory/intelligence";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";

export class IntelligenceError extends Error {
  constructor(message:string,public status=400){super(message);this.name="IntelligenceError";}
}
const json = (value:unknown) => value as Prisma.InputJsonValue;
function requireRole(ctx:AuthorizedContext,review=false) {
  if (!(review ? ["OWNER","ADMIN"] : ["OWNER","ADMIN","EDITOR"]).includes(ctx.role)) throw new IntelligenceError("Your role cannot perform this action",403);
}
function uuid(value:string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new IntelligenceError("Invalid record identifier");
}
// Retry serialization conflicts only. Validation/auth failures are never retried.
async function transaction<T>(ctx:AuthorizedContext,fn:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  for(let attempt=0;attempt<3;attempt++) {
    try {return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId}, 0))`;
      return fn(tx);
    },{isolationLevel:"Serializable",maxWait:5000,timeout:12000});}
    catch(e) {
      if(e instanceof Prisma.PrismaClientKnownRequestError && ["P2034","P2002"].includes(e.code)) {
        if(attempt<2) continue;
        throw new IntelligenceError("Another change was saved at the same time. Refresh and retry.",409);
      }
      throw e;
    }
  }
  throw new IntelligenceError("Unable to save this change",409);
}
export async function saveBusinessProfile(ctx:AuthorizedContext,input:unknown,version:number) {
  requireRole(ctx,true);
  let profile;try {profile=parseProfile(input);} catch {throw new IntelligenceError("Choose recognised activities and UK nations");}
  if(!Number.isInteger(version)||version<0)throw new IntelligenceError("Invalid profile version");
  return transaction(ctx,async tx=>{
    const current=await tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}});
    if((current?.version||0)!==version)throw new IntelligenceError("Your business profile changed. Refresh before saving.",409);
    const saved=await tx.businessProfile.upsert({where:{organizationId:ctx.organizationId},
      create:{organizationId:ctx.organizationId,activities:profile.activities,jurisdictions:profile.jurisdictions,updatedById:ctx.userId},
      update:{activities:profile.activities,jurisdictions:profile.jurisdictions,updatedById:ctx.userId,version:{increment:1}}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"intelligence.profile_updated",entityType:"BusinessProfile",entityId:ctx.organizationId,details:{version:saved.version}}});
    return saved;
  });
}
export async function createIntelligenceRun(ctx:AuthorizedContext,snapshotId:string) {
  requireRole(ctx);uuid(snapshotId);
  return transaction(ctx,async tx=>{
    const snapshot=await tx.regulatorySnapshot.findFirst({where:{id:snapshotId,organizationId:ctx.organizationId}});
    if(!snapshot)throw new IntelligenceError("Source snapshot not found",404);
    if(sourceTextHash(snapshot.bodyText)!==snapshot.contentHash)throw new IntelligenceError("Source integrity check failed",409);
    const profile=await tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}});
    if(!profile)throw new IntelligenceError("Save your business profile first",409);
    const existing=await tx.intelligenceRun.findUnique({where:{organizationId_snapshotId_profileVersion_engineVersion:{organizationId:ctx.organizationId,snapshotId,profileVersion:profile.version,engineVersion:ENGINE_VERSION}}});
    if(existing)return {id:existing.id,reused:true};
    const count=await tx.intelligenceRun.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}});
    if(count>=30)throw new IntelligenceError("The daily limit of 30 analyses per organisation has been reached",429);
    const previous=await tx.regulatorySnapshot.findFirst({where:{organizationId:ctx.organizationId,sourceId:snapshot.sourceId,firstCapturedAt:{lt:snapshot.firstCapturedAt}},orderBy:{firstCapturedAt:"desc"}});
    const business=parseProfile(profile);
    const result=analysePublication({sourceId:snapshot.sourceId,text:snapshot.bodyText,previousText:previous?.bodyText,profile:business});
    const run=await tx.intelligenceRun.create({data:{organizationId:ctx.organizationId,snapshotId,profileVersion:profile.version,profile:json(business),engineVersion:ENGINE_VERSION,result:json(result),resultHash:hashValue(result),createdById:ctx.userId}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"intelligence.analysis_created",entityType:"IntelligenceRun",entityId:run.id,details:{snapshotId,contentHash:snapshot.contentHash,engineVersion:ENGINE_VERSION,candidates:result.candidates.length,profileVersion:profile.version}}});
    return {id:run.id,reused:false};
  });
}
export async function getIntelligenceWorkspace(ctx:AuthorizedContext) {
  const [profile,runs,snapshots]=await Promise.all([
    db.businessProfile.findUnique({where:{organizationId:ctx.organizationId}}),
    db.intelligenceRun.findMany({where:{organizationId:ctx.organizationId},orderBy:{createdAt:"desc"},take:20,
      include:{snapshot:{select:{id:true,sourceId:true,title:true,url:true,contentHash:true,reviewStatus:true,lastCheckedAt:true,firstCapturedAt:true}},decisions:{include:{obligation:{select:{id:true,title:true,status:true,evidence:{where:{organizationId:ctx.organizationId},select:{scanStatus:true,reviewStatus:true,uploadedById:true,reviewerId:true,reviewedAt:true}}}}}}}}),
    db.regulatorySnapshot.findMany({where:{organizationId:ctx.organizationId},orderBy:{firstCapturedAt:"desc"},distinct:["sourceId"],take:30,select:{id:true,sourceId:true,title:true,lastCheckedAt:true,reviewStatus:true}})
  ]);
  return {profile,sources:snapshots.map(s=>({...s,stale:Date.now()-s.lastCheckedAt.getTime()>7*86400000})),
    runs:runs.map(run=>({
      ...run,result:hashValue(run.result)===run.resultHash ? run.result : null,
      integrityValid:hashValue(run.result)===run.resultHash,
      stale:profile?.version!==run.profileVersion||snapshots.find(s=>s.sourceId===run.snapshot.sourceId)?.id!==run.snapshotId,
      decisions:run.decisions.map(d=>({...d,obligation:d.obligation ? {id:d.obligation.id,title:d.obligation.title,status:d.obligation.status,evidence:evidenceReadiness(d.obligation.evidence)} : null}))
    }))};
}
export async function decideCandidate(ctx:AuthorizedContext,runId:string,input:{candidateKey:string;decision:string;rationale:string;ownerName?:string;dueDate?:string;title?:string}) {
  requireRole(ctx,true);uuid(runId);
  if(!/^[a-f0-9]{64}$/.test(input.candidateKey)||!["ACCEPTED","DISMISSED"].includes(input.decision))throw new IntelligenceError("Choose a valid recommendation and decision");
  if(typeof input.rationale!=="string"||input.rationale.trim().length<20||input.rationale.length>800)throw new IntelligenceError("Explain your decision in 20 to 800 characters");
  const rationale=input.rationale.trim();
  let dueDate:Date|undefined;
  if(input.decision==="ACCEPTED") {
    if(!input.title?.trim()||input.title.length>160||!input.ownerName?.trim()||input.ownerName.length>80)throw new IntelligenceError("Enter a task title and owner");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate||""))throw new IntelligenceError("Choose a target date for the task");
    dueDate=new Date(input.dueDate+"T00:00:00.000Z");
    if(Number.isNaN(dueDate.getTime())||dueDate.toISOString().slice(0,10)!==input.dueDate)throw new IntelligenceError("Invalid target date");
  }
  return transaction(ctx,async tx=>{
    const run=await tx.intelligenceRun.findFirst({where:{id:runId,organizationId:ctx.organizationId},include:{snapshot:true}});
    if(!run)throw new IntelligenceError("Analysis not found",404);
    if(run.createdById===ctx.userId)throw new IntelligenceError("A different administrator must review this analysis",403);
    if(hashValue(run.result)!==run.resultHash||sourceTextHash(run.snapshot.bodyText)!==run.snapshot.contentHash)throw new IntelligenceError("Analysis or source integrity check failed",409);
    const result=run.result as unknown as Analysis;
    const candidate=result.candidates.find(c=>c.key===input.candidateKey);
    if(!candidate||run.snapshot.bodyText.slice(candidate.start,candidate.end)!==candidate.quote)throw new IntelligenceError("Candidate is not supported by the saved source",409);
    const recorded=await tx.intelligenceDecision.findUnique({where:{runId_candidateKey:{runId,candidateKey:input.candidateKey}}});
    if(recorded)throw new IntelligenceError("This recommendation has already been decided",409);
    const [profile,latest]=await Promise.all([
      tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}}),
      tx.regulatorySnapshot.findFirst({where:{organizationId:ctx.organizationId,sourceId:run.snapshot.sourceId},orderBy:{firstCapturedAt:"desc"}})
    ]);
    if(profile?.version!==run.profileVersion||latest?.id!==run.snapshotId)throw new IntelligenceError("Source or business profile changed. Generate a fresh analysis.",409);
    let obligationId:string|null=null;
    if(input.decision==="ACCEPTED") {
      if(run.snapshot.reviewStatus!=="REVIEWED")throw new IntelligenceError("Complete independent source review before creating tasks",409);
      if(Date.now()-run.snapshot.lastCheckedAt.getTime()>7*86400000)throw new IntelligenceError("Recheck this source before creating tasks; its last check is over seven days old",409);
      const duplicate=await tx.obligation.findUnique({where:{organizationId_originKey:{organizationId:ctx.organizationId,originKey:candidate.key}}});
      if(duplicate)throw new IntelligenceError("This source passage already has a task. Review the existing team task instead.",409);
      const task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:input.title!.trim(),ownerName:input.ownerName!.trim(),dueDate:dueDate!,category:"Regulatory follow-up",sourceUrl:run.snapshot.url,sourceCheckedAt:run.snapshot.lastCheckedAt,originKey:candidate.key,
        notes:("Human-reviewed follow-up, not a legal compliance verdict. "+rationale).slice(0,500)}});
      obligationId=task.id;
    }
    const decision=await tx.intelligenceDecision.create({data:{organizationId:ctx.organizationId,runId,candidateKey:input.candidateKey,decision:input.decision,rationale,reviewerId:ctx.userId,obligationId}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"intelligence.candidate_"+input.decision.toLowerCase(),entityType:"IntelligenceDecision",entityId:decision.id,details:{runId,candidateKey:candidate.key,resultHash:run.resultHash,snapshotId:run.snapshotId,sourceHash:run.snapshot.contentHash,profileVersion:run.profileVersion,obligationId}}});
    return decision;
  });
}
