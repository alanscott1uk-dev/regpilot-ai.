import { can } from "../permissions.mjs";
import { db } from "./db";
import type { AuthorizedContext } from "./authorization";
import type { ObligationStatus } from "@prisma/client";

export type NewObligation = { title: string; category: string; ownerName: string; dueDate: string; notes?: string };

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date");
  return date;
}

export async function listObligations(ctx: AuthorizedContext) {
  if (!can(ctx.role, "obligation:read")) throw new Error("Forbidden");
  return db.obligation.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { dueDate: "asc" }, take: 100 });
}

export async function createObligation(ctx: AuthorizedContext, input: NewObligation) {
  if (!can(ctx.role, "obligation:write")) throw new Error("Forbidden");
  const title = input.title?.trim();
  const ownerName = input.ownerName?.trim();
  const category = input.category?.trim() || "Internal";
  const notes = input.notes?.trim() ?? "";
  if (!title || title.length > 160 || !ownerName || ownerName.length > 80 || category.length > 80 || notes.length > 500) throw new Error("Invalid input");
  const dueDate = dateOnly(input.dueDate);
  return db.$transaction(async tx => {
    const item = await tx.obligation.create({ data: { organizationId: ctx.organizationId, title, category, ownerName, dueDate, notes } });
    await tx.auditEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.userId, action: "obligation.created", entityType: "Obligation", entityId: item.id, details: { title, dueDate: input.dueDate } } });
    return item;
  });
}

export async function changeObligationStatus(ctx: AuthorizedContext, id: string, status: ObligationStatus) {
  if (!can(ctx.role, "obligation:write")) throw new Error("Forbidden");
  if (!["OPEN", "IN_PROGRESS", "COMPLETE"].includes(status)) throw new Error("Invalid status");
  return db.$transaction(async tx => {
    const existing = await tx.obligation.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!existing) return null;
    const updated = await tx.obligation.update({ where: { id: existing.id }, data: { status } });
    await tx.auditEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.userId, action: "obligation.status_changed", entityType: "Obligation", entityId: id, details: { from: existing.status, to: status } } });
    return updated;
  });
}
