// Deterministic evidence-gap assessment. Not an AI legal determination.
export const EVIDENCE_RULES = Object.freeze({
 suppliers:["Supplier certificate","Audit report"],
 policies:["Policy / SOP"],
 licences:["Licence"],
 audits:["Audit report"],
 training:["Other"]
});
export function assessEvidenceGap({moduleId,documents=[],today}){
 const required=EVIDENCE_RULES[moduleId]??[];
 const date=/^\d{4}-\d{2}-\d{2}$/;
 const findings=required.map(category=>{
  const matching=documents.filter(d=>d.category===category);
  const approved=matching.filter(d=>d.review_status==="APPROVED"&&
   (d.expires_on==null||(date.test(d.expires_on)&&date.test(today)&&d.expires_on>=today)));
  const expired=matching.some(d=>date.test(d.expires_on??"")&&date.test(today)&&d.expires_on<today);
  return {category,status:approved.length?"EVIDENCE_RECORDED":expired?"EXPIRED_OR_REVIEW_REQUIRED":matching.length?"REVIEW_REQUIRED":"MISSING",count:matching.length};
 });
 return {
  moduleId,
  overall:findings.length===0?"NOT_CONFIGURED":findings.every(x=>x.status==="EVIDENCE_RECORDED")?"EVIDENCE_RECORDED":"REVIEW_REQUIRED",
  findings,
  notice:"This is a configurable evidence checklist, not a compliance assessment or proof of legal sufficiency."
 };
}
