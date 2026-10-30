// Source-backed, human-review-first regulatory control catalogue.
// These are candidate review controls, NOT verified legal determinations.
export const REGULATORY_CONTROLS = Object.freeze([
 {id:"HO-CD-LIC-001",regulator:"Home Office",domain:"controlled-drugs",title:"Review domestic controlled-drug licensing applicability",sourceUrl:"https://www.gov.uk/guidance/controlled-drugs-domestic-licences",sourceType:"official-guidance",classification:"applicability-review",reviewStatus:"PENDING_EXPERT_REVIEW",activities:["controlled-drug-possession","controlled-drug-supply"],evidence:["Licence or exemption rationale","Scope of activities"],caveat:"Licensing depends on substance, schedule, activity and exemptions. Do not infer licence necessity from industry alone."},
 {id:"HO-CD-SEC-002",regulator:"Home Office",domain:"controlled-drugs",title:"Review site security and controlled-drug storage arrangements",sourceUrl:"https://www.gov.uk/government/publications/general-security-guidance-for-controlled-drug-suppliers",sourceType:"official-guidance",classification:"risk-review",reviewStatus:"PENDING_EXPERT_REVIEW",activities:["controlled-drug-possession"],evidence:["Security risk assessment","Site security procedures"],caveat:"Guidance is risk-based, not a universal prescriptive specification."},
 {id:"HO-CD-APP-003",regulator:"Home Office",domain:"controlled-drugs",title:"Prepare controlled-drug application and inspection evidence",sourceUrl:"https://www.gov.uk/government/publications/domestic-licensing-application-guidance",sourceType:"official-guidance",classification:"application-readiness",reviewStatus:"PENDING_EXPERT_REVIEW",activities:["controlled-drug-licence-application"],evidence:["Site details","Relevant SOPs","Named personnel","Security description"],caveat:"Actual required evidence depends on the application and regulator requests."},
 {id:"MHRA-WDA-001",regulator:"MHRA",domain:"medicines-wholesale",title:"Assess wholesale distribution authorisation and GDP readiness",sourceUrl:"https://www.gov.uk/guidance/apply-for-manufacturer-or-wholesaler-of-medicines-licences",sourceType:"official-guidance",classification:"applicability-review",reviewStatus:"PENDING_EXPERT_REVIEW",activities:["medicines-wholesale"],evidence:["Authorisation details","GDP procedures","Responsible Person arrangements"],caveat:"This is a readiness review, not an MHRA inspection or authorisation."}
]);
export function candidateControls(activities) {
 if(!Array.isArray(activities))return [];
 const selected=new Set(activities.filter(x=>typeof x==="string"));
 return REGULATORY_CONTROLS.filter(c=>c.activities.some(a=>selected.has(a))).map(c=>({...c,automatedVerdict:null}));
}
export function controlReadyForAutomaticComplianceVerdict(control) {
 // No rule may claim statutory compliance solely from an AI recommendation or uploaded file.
 return false;
}
