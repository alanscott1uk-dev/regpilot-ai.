import {createHash} from "node:crypto";
import {z} from "zod";
import {IntelligenceError} from "./intelligence-service";
import type {BomCandidate} from "../ai-inventory";

// Register declared ML components in the document's assembly, including its root.
const envelope = z.looseObject({
  bomFormat: z.literal("CycloneDX"), specVersion: z.enum(["1.6", "1.7"]),
  serialNumber: z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  version: z.number().int().min(1).max(2147483647),
  metadata: z.looseObject({component: z.unknown().optional()}).optional(),
  components: z.array(z.unknown()).optional(),
});
const printable = (n: number) => z.string().min(1).max(n).regex(/^[^\u0000-\u001f\u007f]+$/).refine(value => value.trim() === value);
const component = z.looseObject({
  type: printable(80), name: z.string().min(1),
  "bom-ref": z.string().optional(), components: z.array(z.unknown()).optional(),
});
const model = z.object({"bom-ref": printable(240), name: printable(160), version: printable(120).optional()});
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const componentKey = (serial: string, reference: string) => "bom:" + digest(JSON.stringify([serial, reference]));

// The parser touches only JSON values. Key ordering and whitespace do not change a model fingerprint.
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 40) throw new IntelligenceError("The model component contains more than 40 nested levels.");
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v, depth + 1)]));
  return value;
}

export function discoverModels(input: unknown) {
  const parsed = envelope.safeParse(input);
  if (!parsed.success) throw new IntelligenceError("Choose a CycloneDX 1.6 or 1.7 JSON BOM with a UUID serialNumber and a positive document version.");
  const bom = parsed.data, models: BomCandidate[] = [], seen = new Set<string>();
  let inspected = 0;
  function visit(entry: unknown, depth: number) {
    if (++inspected > 2000 || depth > 25) throw new IntelligenceError("Import supports 2,000 components and 25 assembly levels.");
    const item = component.safeParse(entry);
    if (!item.success) throw new IntelligenceError("A BOM component is missing its type or name, or has invalid children.");
    const c = item.data, ref = c["bom-ref"];
    if (ref !== undefined) {
      if (!ref || seen.has(ref)) throw new IntelligenceError("Component references must be nonempty and unique within this BOM.");
      seen.add(ref);
    }
    if (c.type === "machine-learning-model") {
      const m = model.safeParse(c);
      if (!m.success || models.length >= 100) throw new IntelligenceError("Use up to 100 model components, each with a name and a unique bom-ref within the supported lengths.");
      models.push({reference: m.data["bom-ref"], name: m.data.name, componentVersion: m.data.version ?? null, digest: digest(JSON.stringify(canonical(entry)))});
    }
    for (const child of c.components ?? []) visit(child, depth + 1);
  }
  if (bom.metadata?.component !== undefined) visit(bom.metadata.component, 1);
  for (const entry of bom.components ?? []) visit(entry, 1);
  const manifest = models.map(m => [m.reference,m.digest]).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  return {serial: bom.serialNumber.toLowerCase(), version: bom.version, manifestHash: digest(JSON.stringify(manifest)), models, inspected};
}
