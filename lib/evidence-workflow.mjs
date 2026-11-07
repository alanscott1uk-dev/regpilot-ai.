// Evidence state transitions are advisory domain logic.
// Server-side authentication, role enforcement and audit persistence are mandatory.
const transitions = Object.freeze({
 DRAFT: ["PENDING_REVIEW"],
 PENDING_REVIEW: ["APPROVED", "REJECTED"],
 REJECTED: ["DRAFT"],
 APPROVED: ["EXPIRED"],
 EXPIRED: ["DRAFT"]
});
export function canTransitionEvidence({ from, to, actorRole, reviewerId, uploaderId }) {
 if (!transitions[from]?.includes(to)) return { allowed: false, reason: "Invalid evidence transition" };
 if (actorRole === "VIEWER") return { allowed: false, reason: "Viewers cannot change evidence" };
 if (to === "APPROVED" || to === "REJECTED") {
   if (!["OWNER", "ADMIN"].includes(actorRole)) return { allowed: false, reason: "Reviewer role required" };
   if (!reviewerId) return { allowed: false, reason: "Reviewer identity required" };
   if (uploaderId && reviewerId === uploaderId) return { allowed: false, reason: "Independent review required" };
 }
 if (to === "EXPIRED" && actorRole !== "SYSTEM" && !["OWNER", "ADMIN"].includes(actorRole)) {
   return { allowed: false, reason: "Expiry update requires elevated permission" };
 }
 if (actorRole === "SYSTEM" && to !== "EXPIRED") return { allowed: false, reason: "System may only mark expiry" };
 return { allowed: true, reason: null };
}
export function renewalCandidates(documents, today, daysAhead = 30) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isInteger(daysAhead) || daysAhead < 0) return [];
 const limit = new Date(today + "T00:00:00.000Z");
 limit.setUTCDate(limit.getUTCDate() + daysAhead);
 const threshold = limit.toISOString().slice(0, 10);
 return documents.filter(doc => doc && typeof doc.id === "string" &&
   typeof doc.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.expiresOn) &&
   doc.expiresOn <= threshold && doc.reviewStatus !== "REJECTED");
}
