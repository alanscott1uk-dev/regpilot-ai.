import {createHash} from "node:crypto";
import type {Interpretation} from "./semantic";

export const ENGINE_VERSION = "obligation-triage-1.1.0";
export const ACTIVITIES = ["personal-data", "employing-staff", "premises", "medicines", "controlled-drugs", "food-business", "consumer-sales", "vat-registered", "limited-company", "commercial-waste"] as const;
export const JURISDICTIONS = ["England", "Scotland", "Wales", "Northern Ireland"] as const;
export type BusinessProfile = {activities: string[]; jurisdictions: string[]};
export type Mapping = {id: string; title: string; matchedTerms: string[]; evidenceNeeded: string[]; domains: string[]};
export type Candidate = {
  key: string; quote: string; start: number; end: number;
  language: "mandatory-language" | "prohibition" | "recommendation" | "exemption";
  change: "baseline" | "added-or-reworded" | "existing";
  applicability: "potential-match" | "needs-context";
  reasons: string[]; questions: string[]; mappings: Mapping[];
  priority: "review-first" | "normal"; dateMentions: string[];
  interpretation?: Interpretation;
};
export type Analysis = {engineVersion: string; candidates: Candidate[]; warnings: string[]; examinedCharacters: number; candidateLimitReached: boolean;grounding?:{proposed:number;retained:number;rejected:number;meaningVerified:false}};

// These are reusable internal control themes, NOT certified framework equivalences.
export const CONTROL_THEMES = [
  {id:"records", title:"Controlled records and retention", terms:["record", "records", "document", "documented", "retention", "retain"], evidenceNeeded:["Approved record procedure", "Dated completed record sample"], domains:["Quality", "Privacy", "Corporate governance"]},
  {id:"training", title:"People and competence", terms:["staff", "training", "train", "competence", "employees"], evidenceNeeded:["Role-specific training requirements", "Dated competence assessment"], domains:["Quality", "Workplace safety", "Security"]},
  {id:"suppliers", title:"Supplier assurance", terms:["supplier", "suppliers", "contractor", "contractors", "vendor"], evidenceNeeded:["Approved supplier assessment", "Current supplier review"], domains:["Quality", "Security", "Procurement"]},
  {id:"incidents", title:"Incident response and corrective action", terms:["incident", "incidents", "breach", "breaches", "recall", "investigation"], evidenceNeeded:["Incident response procedure", "Investigation and follow-up record"], domains:["Privacy", "Quality", "Workplace safety"]},
  {id:"access", title:"Access and information security", terms:["secure", "security", "access", "confidential", "password"], evidenceNeeded:["Approved access policy", "Recent access review"], domains:["Privacy", "Security", "Quality"]},
  {id:"licensing", title:"Licences and permissions", terms:["licence", "licences", "license", "licensing", "authorisation", "permit"], evidenceNeeded:["Current permission and scope", "Renewal and conditions review"], domains:["Medicines", "Controlled drugs", "Business permissions"]},
  {id:"risk", title:"Risk assessment and review", terms:["risk", "risks", "hazard", "hazards", "assessment"], evidenceNeeded:["Approved risk assessment", "Action and review record"], domains:["Workplace safety", "Quality", "Security"]},
  {id:"privacy", title:"Personal information and transparency", terms:["personal", "privacy", "information", "consent"], evidenceNeeded:["Processing inventory", "Privacy notice and request procedure"], domains:["Privacy", "People", "Customer operations"]}
] as const;

const sourceActivities: Record<string, string[]> = {
  "home-office-domestic":["controlled-drugs"], "home-office-application":["controlled-drugs"],
  "mhra-organisation":["medicines"], "mhra-safety":["medicines"],
  "employer-registration":["employing-staff"], "workplace-pensions":["employing-staff"],
  "vat-records":["vat-registered"], "company-records":["limited-company"], "distance-selling":["consumer-sales"],
  "food-registration":["food-business"], "food-safety":["food-business"], "commercial-waste":["commercial-waste"],
  "uk-data-protection":["personal-data"], "workplace-fire-safety":["premises", "employing-staff"]
};
export function hashValue(value: unknown) {
  const canonical = (v:unknown):unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function parseProfile(value: unknown): BusinessProfile {
  const p = value as BusinessProfile;
  if (!p || !Array.isArray(p.activities) || !Array.isArray(p.jurisdictions) ||
      p.activities.length > ACTIVITIES.length || p.jurisdictions.length > JURISDICTIONS.length ||
      p.activities.some(x => !(ACTIVITIES as readonly string[]).includes(x)) ||
      p.jurisdictions.some(x => !(JURISDICTIONS as readonly string[]).includes(x))) throw new Error("Choose recognised business activities and UK nations");
  return {activities:[...new Set(p.activities)].sort(), jurisdictions:[...new Set(p.jurisdictions)].sort()};
}
export function matchControls(quote: string): Mapping[] {
  const tokens = new Set(quote.toLowerCase().match(/[a-z]+/g) || []);
  return CONTROL_THEMES.map(c => ({id:c.id,title:c.title,matchedTerms:c.terms.filter(t => tokens.has(t)),evidenceNeeded:[...c.evidenceNeeded],domains:[...c.domains]}))
    .filter(c => c.matchedTerms.length > 0).sort((a,b) => b.matchedTerms.length-a.matchedTerms.length || a.id.localeCompare(b.id)).slice(0,3);
}
/** Deterministic, cost-free triage. No model, legal interpretation or inferred deadlines. */
export function analysePublication(input: {sourceId: string; text: string; previousText?: string; profile: BusinessProfile}): Analysis {
  const profile = parseProfile(input.profile), text = input.text;
  if (typeof text !== "string" || text.length < 80 || text.length > 20000) throw new Error("A bounded official source excerpt is required");
  const candidates: Candidate[] = [], seen = new Set<string>();
  let limitReached = false;
  // Preserve exact offsets into the stored source; do not normalise quotes after matching.
  const segments = text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g);
  for (const segment of segments) {
    const quote = segment[0].trim();
    if (!/\b(must|shall|should|required to|need to)\b/i.test(quote) || quote.length < 20) continue;
    if (candidates.length >= 30) {limitReached = true; break;}
    const key = hashValue({sourceId:input.sourceId,quote});
    if (seen.has(key)) continue;
    seen.add(key);
    const start = segment.index! + segment[0].indexOf(quote), end = start + quote.length;
    const language = /\b(must not|shall not)\b/i.test(quote) ? "prohibition" : /\b(must|shall|required to|need to)\b/i.test(quote) ? "mandatory-language" : "recommendation";
    const relevant = (sourceActivities[input.sourceId] || []).filter(a => profile.activities.includes(a));
    const reasons = relevant.length ? ["Publication topic matches declared activities: " + relevant.join(", ") + "."] : ["No confirmed match between this source topic and the selected activities. Absence of a match does not establish an exemption."];
    const questions = ["Does the whole publication apply to this business, including any exceptions?", "What is the legal status and effective date of this passage?"];
    if (/\b(if|unless|except|where|when|provided that)\b/i.test(quote)) questions.push("Check the condition or exception in this passage before assigning work.");
    if (/\b(not required|do not need|does not need|need not|no longer|not necessary)\b/i.test(quote)) questions.push("This passage may describe an exemption or removal of a requirement; do not turn it into a positive duty.");
    if (!profile.jurisdictions.length) questions.push("Which UK nations does the business operate in?");
    if (profile.jurisdictions.includes("Scotland") || profile.jurisdictions.includes("Northern Ireland")) questions.push("Confirm the territorial scope; this GOV.UK page may link to different rules for Scotland or Northern Ireland.");
    const change = input.previousText === undefined ? "baseline" : input.previousText.includes(quote) ? "existing" : "added-or-reworded";
    candidates.push({key,quote,start,end,language,change,
      applicability:relevant.length && profile.jurisdictions.length ? "potential-match" : "needs-context",
      reasons,questions,mappings:matchControls(quote),priority:change === "added-or-reworded" && language !== "recommendation" ? "review-first" : "normal",
      dateMentions:[...new Set(quote.match(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi) || [])]
    });
  }
  candidates.sort((a,b) => Number(b.priority === "review-first")-Number(a.priority === "review-first") || a.start-b.start);
  return {engineVersion:ENGINE_VERSION,candidates,examinedCharacters:text.length,candidateLimitReached:limitReached,warnings:[
    "Pattern-based triage of a saved excerpt, not exhaustive obligation extraction or a legal determination.",
    "Related control themes indicate possible reuse across domains, not framework equivalence or evidence sufficiency.",
    "Date mentions are quoted text, not verified commencement or task deadlines.",
    ...(text.length >= 12000 ? ["The source excerpt may have been truncated upstream; inspect the complete original publication."] : []),
    ...(limitReached ? ["The 30-candidate limit was reached; review the remaining publication manually."] : []),
    ...(!candidates.length ? ["No obligation-language candidates found. This does not mean the publication contains no obligations."] : [])
  ]};
}

export function evidenceReadiness(rows: Array<{scanStatus:string; reviewStatus:string; uploadedById:string|null; reviewerId:string|null; reviewedAt:Date|null}>) {
  const approved = rows.filter(e => e.scanStatus === "CLEAN" && e.reviewStatus === "APPROVED" && e.uploadedById && e.reviewerId && e.reviewerId !== e.uploadedById && e.reviewedAt);
  return {total:rows.length,independentlyReviewed:approved.length,state:approved.length ? "reviewed-files-available" : rows.length ? "review-required" : "missing-evidence",
    nextStep:approved.length ? "Check that the reviewed files actually demonstrate this specific requirement; metadata cannot establish adequacy." : rows.length ? "Complete independent review of clean evidence files." : "Attach evidence demonstrating the task and request an independent review."};
}
