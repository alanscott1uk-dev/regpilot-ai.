// Deterministic evidence-gap assessment. Not an AI legal determination.
export const EVIDENCE_RULES = Object.freeze({
 suppliers:["Supplier certificate","Audit report"],
 policies:["Policy / SOP"],
 licences:["Licence"],
 audits:["Audit report"],
 training:["Other"]
});
// Never accept a document solely because its metadata says APPROVED.
// These fields must ultimately be populated by trusted server-side upload, scan,
// integrity-verification and independent-review workflows.
export function isVerifiedEvidence(d) {
 return d?.review_status==="APPROVED"
  && typeof d.storage_path==="string" && d.storage_path.length>0
  && d.scan_status==="CLEAN"
  && d.integrity_verified===true
  && typeof d.sha256==="string" && /^[a-f0-9]{64}$/i.test(d.sha256)
  && typeof d.reviewed_by==="string" && d.reviewed_by.length>0
  && typeof d.uploaded_by==="string" && d.uploaded_by.length>0
  && d.reviewed_by!==d.uploaded_by;
}
export function assessEvidenceGap({moduleId,documents=[],today}){
 const required=EVIDENCE_RULES[moduleId]??[];
 const date=/^\d{4}-\d{2}-\d{2}$/;
 const findings=required.map(category=>{
  const matching=documents.filter(d=>d.category===category);
  const approved=matching.filter(d=>isVerifiedEvidence(d)&&
   (d.expires_on==null||(date.test(d.expires_on)&&date.test(today)&&d.expires_on>=today)));
  const expired=matching.some(d=>date.test(d.expires_on??"")&&date.test(today)&&d.expires_on<today);
  return {category,status:approved.length?"EVIDENCE_RECORDED":expired?"EXPIRED_OR_REVIEW_REQUIRED":matching.length?"REVIEW_REQUIRED":"MISSING",count:matching.length};
 });
 return {
  moduleId,
  overall:findings.length===0?"NOT_CONFIGURED":findings.every(x=>x.status==="EVIDENCE_RECORDED")?"EVIDENCE_RECORDED":"REVIEW_REQUIRED",
  findings,
  notice:"Only scanned, integrity-verified, independently reviewed files may count as evidence. This checklist is not a legal compliance assessment."
 };
}
