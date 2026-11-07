import { can } from "../permissions.mjs";
import { db } from "./db";
import {requireMember,WRITER} from "./workspace-member";
import {transaction} from "./intelligence-service";
import type { AuthorizedContext } from "./authorization";
import type { ObligationStatus } from "@prisma/client";
import {completionAssessment} from "./assurance-service";
import {downloadEvidence} from "./evidence-service";
import type {EvidenceManifest} from "../evidence/assurance";
import type {EvidenceObjectStore} from "./evidence-storage";

export type NewObligation = { title: string; category: string; ownerName: string; dueDate: string; notes?: string; sourceUrl?:string; sourceCheckedAt?:string };

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date");
  return date;
}

export async function listObligations(ctx: AuthorizedContext) {
  if (!can(ctx.role, "obligation:read")) throw new Error("Forbidden");
  return db.$transaction(async tx=>{await requireMember(tx,ctx);return tx.obligation.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { dueDate: "asc" }, take: 100 });});
}

export async function createObligation(ctx: AuthorizedContext, input: NewObligation) {
  if (!can(ctx.role, "obligation:write")) throw new Error("Forbidden");
  const title = input.title?.trim();
  const ownerName = input.ownerName?.trim();
  const category = input.category?.trim() || "Internal";
  const notes = input.notes?.trim() ?? "";
  if (!title || title.length > 160 || !ownerName || ownerName.length > 80 || category.length > 80 || notes.length > 500) throw new Error("Invalid input");
  const dueDate = dateOnly(input.dueDate);
  const sourceUrl=input.sourceUrl?.trim()||null;
  if(sourceUrl){
    try{const url=new URL(sourceUrl);if(url.protocol!=="https:"||url.username||url.password||sourceUrl.length>500)throw new Error("Invalid");}
    catch{throw new Error("Invalid source URL");}
  }
  if(input.sourceCheckedAt&&!sourceUrl)throw new Error("Source date requires a source reference");
  const sourceCheckedAt=input.sourceCheckedAt?dateOnly(input.sourceCheckedAt):null;
  return transaction(ctx,async tx => {
    await requireMember(tx,ctx,WRITER);
    const item = await tx.obligation.create({ data: { organizationId: ctx.organizationId, title, category, ownerName, dueDate, notes, sourceUrl, sourceCheckedAt } });
    await tx.auditEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.userId, action: "obligation.created", entityType: "Obligation", entityId: item.id, details: { title, dueDate: input.dueDate } } });
    return item;
  });
}

export async function changeObligationStatus(ctx: AuthorizedContext, id: string, status: ObligationStatus, opts?:{completionRationale?:string;evidenceStore?:EvidenceObjectStore}) {
  if (!can(ctx.role, "obligation:write")) throw new Error("Forbidden");
  if (!["OPEN", "IN_PROGRESS", "COMPLETE"].includes(status)) throw new Error("Invalid status");
  let verifiedAssessmentId:string|null=null;
  const task=status==="COMPLETE"?await db.obligation.findFirst({where:{id,organizationId:ctx.organizationId}}):null;
  if(task?.originKey){
    const assessment=await completionAssessment(db,ctx.organizationId,id);
    for(const evidence of assessment.evidenceManifest as unknown as EvidenceManifest[]){
      const file=await downloadEvidence(ctx,evidence.id,opts?.evidenceStore);
      if(file.sha256!==evidence.sha256)throw new Error("Completion requires verified unchanged evidence files");
    }
    verifiedAssessmentId=assessment.id;
  }
  return transaction(ctx,async tx => {
    await requireMember(tx,ctx,WRITER);
    const existing = await tx.obligation.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!existing) return null;
    const membership=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}}});
    if(!membership||!can(membership.role,"obligation:write"))throw new Error("Forbidden");
    if(status==="COMPLETE"&&existing.originKey){
      const latest=await completionAssessment(tx,ctx.organizationId,id);
      if(latest.id!==verifiedAssessmentId)throw new Error("Completion requires a fresh check of the current evidence assessment");
    }
    const approvedEvidence = status==="COMPLETE" ? await tx.evidence.count({
      where:{organizationId:ctx.organizationId,obligationId:id,scanStatus:"CLEAN",reviewStatus:"APPROVED"}
    }):0;
    const rationale=opts?.completionRationale?.trim()||"";
    if(rationale.length>500)throw new Error("Completion rationale too long");
    const exception=status==="COMPLETE"&&approvedEvidence===0&&!verifiedAssessmentId;
    if(exception&&rationale.length<20)throw new Error("Completion requires independently reviewed evidence or a documented exception rationale of at least 20 characters");
    const updated = await tx.obligation.update({
      where:{id:existing.id},data:{
        status,
        completionException:exception,
        completionRationale:exception?rationale:"",
        completedAt:status==="COMPLETE"?new Date():null
      }
    });
    await tx.auditEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.userId, action: "obligation.status_changed", entityType: "Obligation", entityId: id, details: { from: existing.status, to: status, completionException:exception,approvedEvidence,assessmentId:verifiedAssessmentId } } });
    return updated;
  });
}
