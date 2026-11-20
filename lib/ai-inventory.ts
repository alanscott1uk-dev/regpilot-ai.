import {z} from "zod";

const label = (max: number, min = 1) => z.string().trim().min(min).max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
export const systemKinds = ["TOOL", "MODEL", "AGENT", "MCP_SERVER"] as const;
export const dataClasses = ["PUBLIC", "INTERNAL", "PERSONAL", "SENSITIVE"] as const;
export const accessLevels = ["READ", "DRAFT", "WRITE", "AUTONOMOUS"] as const;
export const impactAreas = ["INTERNAL", "CUSTOMERS", "EMPLOYMENT", "HEALTH", "FINANCIAL_DECISIONS"] as const;
export const profileSchema = z.strictObject({
  purpose: label(1200, 12),
  dataClass: z.enum(dataClasses),
  access: z.enum(accessLevels),
  impact: z.enum(impactAreas),
  safeguards: label(1200, 12),
});
export type UseProfile = z.infer<typeof profileSchema>;

export function assessUse(profile: UseProfile | null) {
  if (!profile) return {priority: "Unassessed", reasons: ["Record the use, data, permissions and safeguards."]};
  const reasons: string[] = [];
  const elevatedImpact = ["EMPLOYMENT", "HEALTH", "FINANCIAL_DECISIONS"].includes(profile.impact);
  if (profile.dataClass === "SENSITIVE") reasons.push("Handles sensitive information.");
  if (profile.access === "AUTONOMOUS") reasons.push("Can take actions without approval.");
  if (elevatedImpact) reasons.push("Supports decisions affecting individuals in a higher-impact context.");
  if (profile.access === "WRITE") reasons.push("Can change other systems.");
  if (profile.dataClass === "PERSONAL") reasons.push("Processes personal data.");
  if (profile.impact === "CUSTOMERS") reasons.push("Its outputs reach customers.");
  const priority = profile.dataClass === "SENSITIVE" || profile.access === "AUTONOMOUS" || elevatedImpact ? "High" : reasons.length ? "Elevated" : "Routine";
  return {priority, reasons: reasons.length ? reasons : ["Recorded use is internal with limited permissions."]};
}

const fields = {
  name: label(160),
  kind: z.enum(systemKinds),
  ownerId: z.uuid(),
  controlId: z.uuid().nullable(),
  vendorId: z.uuid().nullable(),
  profile: profileSchema,
};
const version = z.number().int().positive().max(2147483646);
export const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({action: z.literal("CREATE"), requestKey: z.uuid(), ...fields}),
  z.strictObject({action: z.literal("UPDATE"), id: z.uuid(), version, ...fields}),
  z.strictObject({action: z.literal("PREVIEW"), bom: z.unknown()}),
  z.strictObject({action: z.literal("IMPORT"), bom: z.unknown(), refs: z.array(label(240)).min(1).max(100).refine(a => new Set(a).size === a.length)}),
  z.strictObject({action: z.literal("DECIDE"), id: z.uuid(), version, verdict: z.enum(["APPROVED", "RESTRICTED", "DECLINED"]), rationale: label(1600, 16), validUntil: z.iso.date(), evidenceId: z.uuid()}),
]);
export type InventoryAction = z.infer<typeof actionSchema>;
export type BomCandidate = {reference: string; name: string; componentVersion: string | null; digest: string};
