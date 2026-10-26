import { db } from "./db";
import type { MembershipRole } from "@prisma/client";
import { ROLES } from "../permissions.mjs";

export type VerifiedIdentity = { externalId: string };
export type AuthorizedContext = { userId: string; organizationId: string; role: MembershipRole };

// Only pass identity verified by a trusted server-side session provider.
export async function authorizeOrganization(
  identity: VerifiedIdentity,
  organizationId: string,
  allowedRoles: readonly MembershipRole[]
): Promise<AuthorizedContext | null> {
  if (!identity.externalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) return null;
  const user = await db.user.findUnique({ where: { externalId: identity.externalId }, select: { id: true } });
  if (!user) return null;
  const membership = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    select: { role: true }
  });
  if (!membership || !ROLES.includes(membership.role) || !allowedRoles.includes(membership.role)) return null;
  return { userId: user.id, organizationId, role: membership.role };
}
