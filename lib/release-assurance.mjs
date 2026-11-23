// Fail-closed release assurance gate. Evidence is only accepted when explicitly reviewed.
// No checkbox or AI model can certify legal compliance.
export const RELEASE_CONTROLS = Object.freeze([
 {id:"SEC-01",label:"Threat model and access-control tests",category:"Security",critical:true},
 {id:"SEC-02",label:"Two-organisation isolation tests",category:"Security",critical:true},
 {id:"SEC-03",label:"Dependency and vulnerability review",category:"Security",critical:true},
 {id:"PRIV-01",label:"Data mapping, lawful bases and privacy notices",category:"Privacy",critical:true},
 {id:"PRIV-02",label:"Processor agreements and retention review",category:"Privacy",critical:true},
 {id:"REG-01",label:"Expert review of published regulatory rules",category:"Regulatory accuracy",critical:true},
 {id:"REG-02",label:"Jurisdiction and exemptions validated",category:"Regulatory accuracy",critical:true},
 {id:"VAL-01",label:"Requirements-to-tests traceability",category:"Validation",critical:true},
 {id:"VAL-02",label:"Audit trail, backup and restore verified",category:"Validation",critical:true},
 {id:"UX-01",label:"Accessibility and mobile testing",category:"Usability",critical:false},
 {id:"LEGAL-01",label:"Terms, subscriptions and marketing review",category:"Legal",critical:true},
 {id:"OPS-01",label:"Incident response and service continuity review",category:"Operations",critical:true}
]);
const accepted=new Set(["PASS","FAIL","NOT_TESTED","NOT_APPLICABLE"]);
export function evaluateRelease(evidence,required=RELEASE_CONTROLS){
 const records=Array.isArray(evidence)?evidence:[];
 const seen=new Map();
 for(const r of records){
  if(!r||typeof r.controlId!=="string"||!accepted.has(r.status)||seen.has(r.controlId))continue;
  seen.set(r.controlId,r);
 }
 const controls=required.map(c=>{
  const r=seen.get(c.id);
  const verified=r?.status==="PASS"&&typeof r.reviewer==="string"&&r.reviewer.trim().length>0&&
   typeof r.evidenceRef==="string"&&r.evidenceRef.trim().length>0&&
   typeof r.reviewedAt==="string"&&!Number.isNaN(Date.parse(r.reviewedAt));
  return {...c,status:r?.status??"NOT_TESTED",verified:Boolean(verified)};
 });
 return {
  approved:controls.every(c=>c.verified),
  passed:controls.filter(c=>c.verified).length,
  total:controls.length,
  blockers:controls.filter(c=>!c.verified).map(c=>c.id),
  controls
 };
}
