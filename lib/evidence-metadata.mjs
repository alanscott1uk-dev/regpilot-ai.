// Pure metadata helpers. This module never uploads, reads or stores document bytes.
// Real files require authenticated private object storage and server-side authorisation.
export const EVIDENCE_STATES = Object.freeze(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "EXPIRED"]);
export const DOCUMENT_CATEGORIES = Object.freeze(["Policy", "Certificate", "Licence", "Procedure", "Training", "Supplier", "Contract", "Other"]);
export function validIsoDate(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function validateEvidenceMetadata(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.id !== "string" || !item.id || typeof item.organizationId !== "string" || !item.organizationId) return false;
  if (typeof item.filename !== "string" || !item.filename.trim() || item.filename.length > 255) return false;
  if (!DOCUMENT_CATEGORIES.includes(item.category) || !EVIDENCE_STATES.includes(item.reviewStatus)) return false;
  if (!Array.isArray(item.actionIds) || !item.actionIds.every(id => typeof id === "string" && id.length > 0)) return false;
  if (!Number.isInteger(item.version) || item.version < 1) return false;
  if (!validIsoDate(item.expiresOn) || !validIsoDate(item.reviewOn)) return false;
  return true;
}
export function linkedEvidence(items, organizationId, actionId) {
  return items.filter(item => validateEvidenceMetadata(item) && item.organizationId === organizationId && item.actionIds.includes(actionId));
}
export function evidenceNeedsAttention(item, today) {
  if (!validateEvidenceMetadata(item) || !validIsoDate(today) || !today) return false;
  return item.reviewStatus === "REJECTED" || item.reviewStatus === "EXPIRED" ||
    (item.expiresOn && item.expiresOn <= today) ||
    (item.reviewOn && item.reviewOn <= today && item.reviewStatus !== "APPROVED");
}
export function evidenceCounts(items, organizationId, today) {
  const own = items.filter(item => validateEvidenceMetadata(item) && item.organizationId === organizationId);
  return {
    total: own.length,
    pending: own.filter(item => item.reviewStatus === "PENDING_REVIEW").length,
    approved: own.filter(item => item.reviewStatus === "APPROVED").length,
    attention: own.filter(item => evidenceNeedsAttention(item, today)).length
  };
}
