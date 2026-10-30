// Plain-English workflow guides. These are operational suggestions, not legal determinations.
export const WORKFLOW_GUIDES = Object.freeze({
 suppliers:{
  title:"Qualify a supplier",
  steps:[
   "Confirm the supplier's legal name and the products or services they provide.",
   "Check which qualifications and licences may apply to this supplier.",
   "Record the certificate or assessment details and review dates.",
   "Ask an authorised reviewer to assess the evidence before approving the supplier."
  ]},
 policies:{
  title:"Review a policy or SOP",
  steps:[
   "Check the document code, current revision and responsible owner.",
   "Confirm whether the procedure still reflects how the business operates.",
   "Record changes needed and link the relevant document metadata.",
   "Route the document for independent review before treating it as approved."
  ]},
 licences:{
  title:"Review a licence or certification",
  steps:[
   "Confirm the issuing authority, licence holder and permitted activities.",
   "Check the expiry date and any conditions requiring attention.",
   "Register the licence details and assign renewal responsibilities.",
   "Verify the current licence with the issuing authority where appropriate."
  ]},
 audits:{
  title:"Prepare for an audit",
  steps:[
   "Confirm the audit scope, location and responsible people.",
   "Review the relevant procedures and available evidence.",
   "Record outstanding gaps and assign corrective actions.",
   "Have an authorised reviewer verify completion and supporting records."
  ]}
});
const fallback={
 title:"Complete this task",
 steps:[
  "Confirm what needs doing, who is responsible and the deadline.",
  "Review the relevant records and any supporting documents.",
  "Record the work completed and any outstanding issues.",
  "Request independent review when the task requires formal evidence approval."
 ]};
export function guideForModule(moduleId){
 return WORKFLOW_GUIDES[moduleId]??fallback;
}
