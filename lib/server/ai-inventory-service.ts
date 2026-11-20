import {Prisma} from "@prisma/client";
import {actionSchema, assessUse, profileSchema, type InventoryAction} from "../ai-inventory";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {componentKey, discoverModels} from "./ai-inventory-bom";
import type {AuthorizedContext} from "./authorization";
import type {EvidenceObjectStore} from "./evidence-storage";
import {IntelligenceError, transaction} from "./intelligence-service";
import {futureDate, reviewedFileSchema, reviewedFiles, verifyReviewedBytes} from "./reviewed-files";
import {ADMIN, WRITER, requireMember} from "./workspace-member";

type Tx = Prisma.TransactionClient;
const limit = 200;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const links = {
  vendor: {select: {id: true, name: true, version: true, active: true}},
  control: {select: {id: true, title: true, version: true, enabled: true}},
} as const;
type System = Prisma.AiSystemGetPayload<{include: typeof links}>;
async function eligibleMembers(tx: Tx, organizationId: string) {
  const rows = await tx.membership.findMany({where: {organizationId, role: {in: ["OWNER","ADMIN","EDITOR"]}}, select: {userId: true, role: true, user: {select: {email: true}}}, orderBy: {user: {email: "asc"}}});
  return new Map(rows.filter(m => allowedEmail(m.user.email, process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(m => [m.userId, {id: m.userId, role: m.role, email: m.user.email}]));
}
type Members = Awaited<ReturnType<typeof eligibleMembers>>;
async function record(tx: Tx, org: string, id: string) {
  const row = await tx.aiSystem.findFirst({where: {organizationId: org, id}, include: links});
  if (!row) throw new IntelligenceError("AI system unavailable in this company.", 404);
  return row;
}
function checkVersion(row: System, version: number) {
  if (row.version !== version) throw new IntelligenceError("The AI system has changed. Reload its current version.", 409);
}
function basis(row: System, file: unknown) {
  return {version: row.version, name: row.name, kind: row.kind, ownerId: row.ownerId, editorId: row.updatedById, profile: row.profile,
    vendor: row.vendor, control: row.control, model: row.componentHash, evidence: reviewedFileSchema.parse(file)};
}
function usableFile(file: {scanStatus: string; reviewStatus: string; reviewedAt: Date | null; uploadedById: string | null; reviewerId: string | null}) {
  return file.scanStatus === "CLEAN" && file.reviewStatus === "APPROVED" && !!file.reviewedAt && !!file.uploadedById && !!file.reviewerId && file.uploadedById !== file.reviewerId;
}
const evidenceFields = {id: true, filename: true, sha256: true, reviewVersion: true, contentType: true, sizeBytes: true, uploadedById: true, reviewerId: true, scanStatus: true, reviewStatus: true, reviewedAt: true} as const;
function available(row: System, members: Members) {
  return members.has(row.ownerId) && members.has(row.updatedById) && (!row.control || row.control.enabled) && (!row.vendor || row.vendor.active);
}
function independent(row: System, userId: string, uploader: string | null) {
  return row.ownerId !== userId && row.updatedById !== userId && uploader !== userId;
}
async function audit(tx: Tx, ctx: AuthorizedContext, rowId: string, action: string, details: object) {
  await tx.auditEvent.create({data: {organizationId: ctx.organizationId, actorId: ctx.userId, entityType: "AiSystem", entityId: rowId, action: "ai-system." + action, details: json(details)}});
}

export async function inventoryWorkspace(ctx: AuthorizedContext) {
  return transaction(ctx, async tx => {
    const actor = await requireMember(tx, ctx, WRITER), organizationId = ctx.organizationId;
    const [members, rows, controls, vendors, evidence] = await Promise.all([
      eligibleMembers(tx, organizationId),
      tx.aiSystem.findMany({where: {organizationId}, orderBy: [{name:"asc"},{id:"asc"}], include: {...links, decisions: {orderBy: {systemVersion: "desc"}, take: 5, include: {evidence: {select: evidenceFields}}}}}),
      tx.managedControl.findMany({where: {organizationId, enabled: true}, select: {id:true,title:true}, orderBy:{title:"asc"}, take:200}),
      tx.vendor.findMany({where: {organizationId, active:true}, select:{id:true,name:true}, orderBy:{name:"asc"}, take:200}),
      ADMIN.includes(actor.role) ? tx.evidence.findMany({where:{organizationId, scanStatus:"CLEAN",reviewStatus:"APPROVED", reviewedAt:{not:null}}, select:{id:true,filename:true,uploadedById:true},orderBy:[{reviewedAt:"desc"},{id:"asc"}],take:200}) : [],
    ]);
    const today = new Date().toISOString().slice(0,10);
    const systems = rows.map(row => {
      const parsed = profileSchema.safeParse(row.profile), profile = parsed.success ? parsed.data : null;
      const last = row.decisions[0];
      let status = profile ? "Awaiting review" : "Needs assessment";
      if (profile && last?.systemVersion === row.version) {
        const file = last.evidence;
        const current = usableFile(file) && available(row, members) && ADMIN.includes(members.get(last.reviewerId)?.role ?? "") &&
          independent(row,last.reviewerId,file.uploadedById) && !!file.uploadedById && members.has(file.uploadedById) &&
          !!file.reviewerId && ADMIN.includes(members.get(file.reviewerId)?.role ?? "") &&
          hashValue(basis(row,file)) === last.contextHash && hashValue(last.context) === last.contextHash;
        status = !current ? "Review invalidated" : last.validUntil.toISOString().slice(0,10) < today ? "Review expired" :
          ({APPROVED:"Approved", RESTRICTED:"Restricted", DECLINED:"Declined"}[last.verdict] ?? "Review invalidated");
      }
      return {id:row.id, name:row.name, kind:row.kind, version:row.version, ownerId:row.ownerId, owner:members.get(row.ownerId)?.email ?? "Owner unavailable",
        vendorId:row.vendorId, controlId:row.controlId, profile, assessment:assessUse(profile), status,
        source: row.bomSerial ? {serial:row.bomSerial, reference:row.bomReference, version:row.bomVersion, modelVersion:row.componentVersion} : null,
        canEdit:ADMIN.includes(actor.role) || row.ownerId === ctx.userId,
        canDecide:!!profile && available(row,members) && last?.systemVersion !== row.version && ADMIN.includes(actor.role) && independent(row,ctx.userId,null),
        history:row.decisions.map(d=>({version:d.systemVersion, verdict:d.verdict, rationale:d.rationale, reviewer:members.get(d.reviewerId)?.email ?? "Former reviewer",
          evidence:d.evidence.filename, validUntil:d.validUntil.toISOString().slice(0,10), at:d.createdAt.toISOString()}))};
    });
    return {organizationId, systems, members:[...members.values()], controls, vendors, evidence:evidence.filter(f=>f.uploadedById !== ctx.userId).map(({id,filename})=>({id,filename}))};
  });
}

type Write = Extract<InventoryAction,{action:"CREATE"|"UPDATE"}>;
async function saveProfile(ctx: AuthorizedContext, input: Write) {
  return transaction(ctx, async tx => {
    const actor = await requireMember(tx,ctx,WRITER), org = ctx.organizationId;
    const members = await eligibleMembers(tx,org);
    if (!members.has(input.ownerId)) throw new IntelligenceError("Choose a current editor or administrator to own this use.",409);
    if (input.vendorId && !await tx.vendor.count({where:{id:input.vendorId,organizationId:org,active:true}})) throw new IntelligenceError("Choose an active supplier from this company.",409);
    if (input.controlId && !await tx.managedControl.count({where:{id:input.controlId,organizationId:org,enabled:true}})) throw new IntelligenceError("Choose an active control from this company.",409);
    const fields = {name:input.name, kind:input.kind,ownerId:input.ownerId,profile:input.profile,vendorId:input.vendorId,controlId:input.controlId,updatedById:ctx.userId};
    if (input.action === "CREATE") {
      const originKey = "manual:" + input.requestKey, fingerprint = hashValue(fields);
      const previous = await tx.aiSystem.findUnique({where:{organizationId_originKey:{organizationId:org,originKey}}});
      if (previous) {
        const created = await tx.auditEvent.findFirst({where:{organizationId:org,entityId:previous.id,action:"ai-system.created",actorId:ctx.userId}});
        if ((created?.details as {fingerprint?:string}|null)?.fingerprint !== fingerprint) throw new IntelligenceError("This request was used for a different AI system.",409);
        return {id:previous.id, version:previous.version};
      }
      if (await tx.aiSystem.count({where:{organizationId:org}}) >= limit) throw new IntelligenceError("This inventory supports 200 systems.",409);
      const row = await tx.aiSystem.create({data:{...fields,organizationId:org,originKey}});
      await audit(tx,ctx,row.id,"created",{fingerprint,version:row.version});
      return {id:row.id, version:row.version};
    }
    const row = await record(tx,org,input.id);
    if (!ADMIN.includes(actor.role) && row.ownerId !== ctx.userId) throw new IntelligenceError("Only the owner or an administrator can edit this system.",403);
    checkVersion(row,input.version);
    if (row.bomSerial && (row.name !== input.name || input.kind !== "MODEL")) throw new IntelligenceError("Imported names and model types come from the source BOM.",409);
    const saved = await tx.aiSystem.update({where:{id:row.id},data:{...fields,version:{increment:1}}});
    await audit(tx,ctx,row.id,"revised",{version:saved.version,profile:fields.profile});
    return {id:row.id,version:saved.version};
  });
}

async function importBom(ctx: AuthorizedContext, input: Extract<InventoryAction,{action:"PREVIEW"|"IMPORT"}>) {
  const bom = discoverModels(input.bom);
  return transaction(ctx, async tx => {
    const actor = await requireMember(tx,ctx,WRITER);
    const org = ctx.organizationId;
    const existing = await tx.aiSystem.findMany({where:{organizationId:org,bomSerial:bom.serial}});
    const byKey = new Map(existing.map(row=>[row.originKey,row]));
    const newer = existing.some(row => row.bomVersion! > bom.version);
    const conflict = existing.some(row => row.bomVersion === bom.version && row.bomDocumentHash !== bom.manifestHash);
    const candidates = bom.models.map(model => {
      const originKey = componentKey(bom.serial,model.reference), current = byKey.get(originKey);
      const state = newer ? "Older export" : conflict ? "Conflicting version" : !current ? "New" : current.componentHash === model.digest ? "Unchanged" :
        current.bomVersion === bom.version ? "Conflicting version" : "Changed";
      return {...model,originKey,current,state};
    });
    if (input.action === "PREVIEW") return {serial:bom.serial,version:bom.version,inspected:bom.inspected,candidates:candidates.map(({reference,name,componentVersion,state})=>({reference,name,componentVersion,state}))};
    const selected = candidates.filter(c=>input.refs.includes(c.reference));
    if (selected.length !== input.refs.length || selected.some(c=>["Older export","Conflicting version"].includes(c.state))) throw new IntelligenceError("Refresh the preview and select models from a current, consistent export.",409);
    if (!ADMIN.includes(actor.role) && selected.some(c => c.current && c.current.ownerId !== ctx.userId && (c.state === "Changed" || c.current.bomVersion !== bom.version))) {
      throw new IntelligenceError("The owner or an administrator must apply a new BOM revision to an existing system.",403);
    }
    const total = await tx.aiSystem.count({where:{organizationId:org}});
    if (total + selected.filter(c=>!c.current).length > limit) throw new IntelligenceError("This import would exceed 200 AI systems.",409);
    let changed = 0;
    for (const c of selected) {
      if (c.state === "Unchanged") {
        if (c.current!.bomVersion! < bom.version) await tx.aiSystem.update({where:{id:c.current!.id},data:{bomVersion:bom.version,bomDocumentHash:bom.manifestHash}});
        continue;
      }
      const observed = {name:c.name, componentHash:c.digest, componentVersion:c.componentVersion, bomVersion:bom.version, bomDocumentHash:bom.manifestHash, updatedById:ctx.userId};
      const saved = c.current ? await tx.aiSystem.update({where:{id:c.current.id},data:{...observed,version:{increment:1}}}) :
        await tx.aiSystem.create({data:{...observed, organizationId:org,originKey:c.originKey,bomSerial:bom.serial,bomReference:c.reference,kind:"MODEL",ownerId:ctx.userId}});
      await audit(tx,ctx,saved.id,"bom-observed",{version:saved.version,serial:bom.serial,documentVersion:bom.version,reference:c.reference,componentHash:c.digest});
      changed++;
    }
    return {changed,unchanged:selected.length-changed};
  });
}

type Decision = Extract<InventoryAction,{action:"DECIDE"}>;
async function decide(ctx: AuthorizedContext, input: Decision, storage?: EvidenceObjectStore) {
  const expires = futureDate(input.validUntil);
  async function capture(tx: Tx) {
    await requireMember(tx,ctx,ADMIN);
    const row = await record(tx,ctx.organizationId,input.id);
    checkVersion(row,input.version);
    const members = await eligibleMembers(tx,ctx.organizationId);
    if (!profileSchema.safeParse(row.profile).success || !available(row,members)) throw new IntelligenceError("The current use, owner and linked records must be available for review.",409);
    const [file] = await reviewedFiles(tx,ctx.organizationId,[input.evidenceId]);
    if (!independent(row,ctx.userId,file.uploadedById)) throw new IntelligenceError("Choose a reviewer independent of the owner, last editor and evidence uploader.",403);
    if (!members.has(file.uploadedById) || !ADMIN.includes(members.get(file.reviewerId)?.role ?? "")) throw new IntelligenceError("The evidence participants are no longer eligible.",409);
    const context = basis(row,file), contextHash = hashValue(context);
    const prior = await tx.aiSystemDecision.findUnique({where:{systemId_systemVersion:{systemId:row.id,systemVersion:row.version}}});
    if (prior && (prior.reviewerId !== ctx.userId || prior.verdict !== input.verdict || prior.rationale !== input.rationale || prior.validUntil.getTime() !== expires.getTime() || prior.contextHash !== contextHash)) throw new IntelligenceError("A decision already exists for this version. Start a new review to change it.",409);
    return {file,context,contextHash,prior};
  }
  const before = await transaction(ctx,capture);
  await verifyReviewedBytes(ctx,[before.file],storage);
  return transaction(ctx,async tx=>{
    const current = await capture(tx);
    if (before.contextHash !== current.contextHash) throw new IntelligenceError("The review basis changed during verification.",409);
    if (current.prior) return {id:current.prior.id};
    const saved = await tx.aiSystemDecision.create({data:{organizationId:ctx.organizationId,systemId:input.id,systemVersion:input.version,verdict:input.verdict,rationale:input.rationale,validUntil:expires,reviewerId:ctx.userId,evidenceId:input.evidenceId,context:json(current.context),contextHash:current.contextHash}});
    await audit(tx,ctx,input.id,"decided",{decisionId:saved.id,version:input.version,verdict:input.verdict});
    return {id:saved.id};
  });
}

export async function inventoryAction(ctx: AuthorizedContext, body: unknown, storage?: EvidenceObjectStore) {
  const input = actionSchema.parse(body);
  switch (input.action) {
    case "PREVIEW": case "IMPORT": return importBom(ctx,input);
    case "CREATE": case "UPDATE": return saveProfile(ctx,input);
    case "DECIDE": return decide(ctx,input,storage);
  }
}
