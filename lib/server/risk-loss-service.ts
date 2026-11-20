import {Prisma} from "@prisma/client";
import {hashValue} from "../regulatory/intelligence";
import {casesSchema, LOSS_METHOD, quantifyLoss, saveScenarioSchema, type LossResult} from "../risk-loss";
import type {AuthorizedContext} from "./authorization";
import type {EvidenceObjectStore} from "./evidence-storage";
import {IntelligenceError,transaction} from "./intelligence-service";
import {reviewedFiles,reviewedFileSchema,verifyReviewedBytes} from "./reviewed-files";
import {ADMIN, WRITER, requireMember} from "./workspace-member";

type Tx = Prisma.TransactionClient;
const json = (value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
async function risk(tx:Tx,ctx:AuthorizedContext,id:string) {
  const row = await tx.riskRecord.findFirst({where:{id,organizationId:ctx.organizationId},select:{id:true,version:true,ownerId:true,createdById:true,status:true}});
  if (!row) throw new IntelligenceError("Risk unavailable in this company.",404);
  return row;
}
export async function lossScenarios(ctx:AuthorizedContext,riskId:string) {
  return transaction(ctx,async tx=>{
    await requireMember(tx,ctx);
    const current=await risk(tx,ctx,riskId);
    const rows=await tx.riskLossScenario.findMany({where:{organizationId:ctx.organizationId,riskId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:50,
      include:{author:{select:{email:true}},evidence:{select:{id:true,filename:true,sha256:true,reviewVersion:true,contentType:true,sizeBytes:true,uploadedById:true,reviewerId:true,scanStatus:true,reviewStatus:true,reviewedAt:true}}}});
    return {organizationId:ctx.organizationId,riskId,riskVersion:current.version,scenarios:rows.map(row=>{
      const file=row.evidence;
      const saved=reviewedFileSchema.safeParse(row.evidenceBasis), live=reviewedFileSchema.safeParse(file);
      const evidenceStatus=!row.evidenceId?"Assumptions only":file?.reviewStatus==="APPROVED" && file.scanStatus==="CLEAN" && file.reviewedAt && saved.success && live.success && hashValue(saved.data)===hashValue(live.data) ? "Reviewed evidence current":"Evidence changed";
      return {id:row.id,title:row.title,assumptions:row.assumptions,riskVersion:row.riskVersion,currentRevision:row.riskVersion===current.version && current.status!=="ARCHIVED",
        author:row.author.email,createdAt:row.createdAt.toISOString(),inputs:casesSchema.parse(row.inputs),result:row.results as unknown as LossResult,
        method:row.method,evidenceStatus,evidenceName:saved.success?saved.data.filename:null};
    })};
  });
}
export async function saveLossScenario(ctx:AuthorizedContext,riskId:string,body:unknown,storage?:EvidenceObjectStore) {
  const input=saveScenarioSchema.parse(body);
  const requestHash=hashValue({actor:ctx.userId,input,riskId,method:LOSS_METHOD});
  async function capture(tx:Tx) {
    const actor=await requireMember(tx,ctx,WRITER),row=await risk(tx,ctx,riskId);
    if (!ADMIN.includes(actor.role) && row.ownerId!==ctx.userId && row.createdById!==ctx.userId) throw new IntelligenceError("The risk owner, creator or an administrator can save a scenario.",403);
    const previous=await tx.riskLossScenario.findUnique({where:{riskId_requestKey:{riskId,requestKey:input.requestKey}}});
    if (previous) {
      if (previous.requestHash!==requestHash) throw new IntelligenceError("This request key already identifies a different scenario.",409);
      return {previous,files:[]};
    }
    if (row.version!==input.riskVersion || row.status==="ARCHIVED") throw new IntelligenceError("Open the current active risk before saving a scenario.",409);
    if (await tx.riskLossScenario.count({where:{organizationId:ctx.organizationId,riskId}})>=50) throw new IntelligenceError("This risk has reached its 50 saved scenarios.",409);
    const files=input.evidenceId?await reviewedFiles(tx,ctx.organizationId,[input.evidenceId]):[];
    return {previous:null,files};
  }
  const before=await transaction(ctx,capture);
  if (before.previous) return {id:before.previous.id};
  await verifyReviewedBytes(ctx,before.files,storage);
  const results=quantifyLoss(input.inputs);
  return transaction(ctx,async tx=>{
    const current=await capture(tx);
    if (current.previous) return {id:current.previous.id};
    if (hashValue(before.files)!==hashValue(current.files)) throw new IntelligenceError("Evidence changed during verification. Review the updated file.",409);
    const saved=await tx.riskLossScenario.create({data:{organizationId:ctx.organizationId,riskId,riskVersion:input.riskVersion,requestKey:input.requestKey,requestHash,authorId:ctx.userId,
      title:input.title,assumptions:input.assumptions,inputs:json(input.inputs),method:LOSS_METHOD,results:json(results),evidenceId:input.evidenceId,
      ...(current.files[0]?{evidenceBasis:json(current.files[0])}:{})}});
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:"RiskRecord",entityId:riskId,action:"risk.loss-scenario-saved",details:{scenarioId:saved.id,riskVersion:input.riskVersion,method:LOSS_METHOD}}});
    return {id:saved.id};
  });
}
