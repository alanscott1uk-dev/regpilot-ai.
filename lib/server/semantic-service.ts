import {Prisma} from "@prisma/client";
import {db} from "./db";
import {aiConfigured} from "./ai-auth";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {generateSemantic} from "./semantic-model";
import {groundSemanticOutput,SEMANTIC_ENGINE_VERSION,type SemanticInput} from "../regulatory/semantic";
import {hashValue,parseProfile} from "../regulatory/intelligence";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";
import {resolveWorkspaceSource} from "./publication-catalogue";
import {officialSourceUrl} from "../regulatory-sources.mjs";
import {allowedEmail} from "../ai/security.mjs";

export function semanticConfigured(){return aiConfigured()&&process.env.REGPILOT_SEMANTIC_ENABLED==="true"&&process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED==="true";}
export async function semanticActivity(ctx:AuthorizedContext){
  const requests=await db.semanticRequest.findMany({where:{organizationId:ctx.organizationId},orderBy:{createdAt:"desc"},take:20,select:{id:true,snapshotId:true,status:true,failureCode:true,createdAt:true,finishedAt:true}});
  return requests.map(r=>({...r,status:r.status==="RUNNING"&&Date.now()-r.createdAt.getTime()>120000?"INTERRUPTED":r.status}));
}
async function currentContext(tx:Prisma.TransactionClient,ctx:AuthorizedContext,snapshotId:string){
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}},include:{user:{select:{email:true}}}});
  if(!member||!["OWNER","ADMIN","EDITOR"].includes(member.role)||!allowedEmail(member.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Your access changed. Sign in again.",403);
  const snapshot=await tx.regulatorySnapshot.findFirst({where:{id:snapshotId,organizationId:ctx.organizationId}});
  if(!snapshot)throw new IntelligenceError("Source snapshot not found",404);
  const source=await resolveWorkspaceSource(tx,ctx.organizationId,snapshot.sourceId);
  if(!source||snapshot.url!==officialSourceUrl(source)||sourceTextHash(snapshot.bodyText)!==snapshot.contentHash)throw new IntelligenceError("Source integrity check failed",409);
  const profile=await tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}});
  const latest=await tx.regulatorySnapshot.findFirst({where:{organizationId:ctx.organizationId,sourceId:snapshot.sourceId},orderBy:{firstCapturedAt:"desc"}});
  if(!profile||latest?.id!==snapshot.id||Date.now()-snapshot.lastCheckedAt.getTime()>7*86400000)throw new IntelligenceError("Save your business context and recheck the latest source first",409);
  return {snapshot,profile};
}

export async function createSemanticRun(ctx:AuthorizedContext,snapshotId:string,consent:unknown,generate:(input:SemanticInput)=>Promise<unknown>=generateSemantic){
  if(!semanticConfigured())throw new IntelligenceError("AI interpretation is not enabled for this pilot",503);
  if(consent!==true)throw new IntelligenceError("Confirm sending the public excerpt and selected business categories for AI interpretation");
  if(!["OWNER","ADMIN","EDITOR"].includes(ctx.role))throw new IntelligenceError("Your role cannot request analysis",403);
  if(!/^[a-f0-9-]{36}$/i.test(snapshotId))throw new IntelligenceError("Invalid snapshot identifier");
  const prepared=await transaction(ctx,async tx=>{
    const {snapshot,profile}=await currentContext(tx,ctx,snapshotId);
    const key={organizationId:ctx.organizationId,snapshotId,profileVersion:profile.version,engineVersion:SEMANTIC_ENGINE_VERSION};
    const existing=await tx.intelligenceRun.findUnique({where:{organizationId_snapshotId_profileVersion_engineVersion:key}});
    if(existing)return {existingId:existing.id};
    const attempted=await tx.semanticRequest.findUnique({where:{organizationId_snapshotId_profileVersion_engineVersion:key}});
    if(attempted)throw new IntelligenceError(attempted.status==="RUNNING"&&Date.now()-attempted.createdAt.getTime()<120000?"AI interpretation is already running. Refresh shortly.":"This interpretation attempt did not complete. Use rule analysis; automatic paid retries are blocked.",409);
    const prior=await tx.regulatorySnapshot.findFirst({where:{organizationId:ctx.organizationId,sourceId:snapshot.sourceId,firstCapturedAt:{lt:snapshot.firstCapturedAt}},orderBy:{firstCapturedAt:"desc"}});
    const request=await tx.semanticRequest.create({data:{...key,createdById:ctx.userId,modelId:process.env.REGPILOT_AI_MODEL!}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"intelligence.semantic_consent",entityType:"SemanticRequest",entityId:request.id,details:{snapshotId,sourceHash:snapshot.contentHash,profileVersion:profile.version,model:request.modelId,dataScope:"public-excerpt-and-selected-categories"}}});
    return {request,input:{sourceId:snapshot.sourceId,text:snapshot.bodyText,previousText:prior?.bodyText,profile:parseProfile(profile)},sourceHash:snapshot.contentHash};
  });
  if(prepared.existingId)return {id:prepared.existingId,reused:true};
  const {request,input,sourceHash}=prepared;
  try{
    await reserveAiRequest(ctx,"semantic-obligations");
    // Recheck the deployment kill switch immediately before any provider request.
    if(!semanticConfigured())throw new IntelligenceError("AI interpretation was disabled",503);
    const result=groundSemanticOutput(await generate(input!),input!);
    return await transaction(ctx,async tx=>{
      const current=await currentContext(tx,ctx,snapshotId);
      if(!semanticConfigured()||current.profile.version!==request!.profileVersion||current.snapshot.contentHash!==sourceHash)throw new IntelligenceError("Source, profile or access changed during analysis. Output was discarded.",409);
      const run=await tx.intelligenceRun.create({data:{organizationId:ctx.organizationId,snapshotId,profileVersion:request!.profileVersion,profile:input!.profile,engineVersion:SEMANTIC_ENGINE_VERSION,result:result as unknown as Prisma.InputJsonValue,resultHash:hashValue(result),createdById:ctx.userId}});
      await tx.semanticRequest.update({where:{id:request!.id},data:{status:"COMPLETED",finishedAt:new Date()}});
      await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"intelligence.semantic_completed",entityType:"IntelligenceRun",entityId:run.id,details:{requestId:request!.id,sourceHash:sourceHash!,resultHash:run.resultHash,retained:result.candidates.length,rejected:result.grounding!.rejected,meaningVerified:false}}});
      return {id:run.id,reused:false};
    });
  }catch(error){
    const failureCode=error instanceof DailyLimitError?"DAILY_LIMIT":error instanceof IntelligenceError?"CONTEXT_CHANGED":"PROVIDER_OR_GROUNDING_FAILURE";
    await db.semanticRequest.updateMany({where:{id:request!.id,organizationId:ctx.organizationId,status:"RUNNING"},data:{status:"FAILED",failureCode,finishedAt:new Date()}});
    if(error instanceof IntelligenceError)throw error;
    throw new IntelligenceError(error instanceof DailyLimitError?"Daily AI request allowance reached":"AI interpretation could not be completed. No unverified output was saved.",error instanceof DailyLimitError?429:503);
  }
}
