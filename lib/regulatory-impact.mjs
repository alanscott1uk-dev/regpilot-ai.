// Candidate impact assessment, not legal advice or a compliance verdict.
// Only expert-approved rules can become actionable regulatory findings.
export function assessRegulatoryImpact({activities=[],jurisdiction="",controls=[]}={}){
 const selected=new Set(Array.isArray(activities)?activities.filter(x=>typeof x==="string"):[]);
 const findings=[];
 for(const rule of controls){
  if(!rule||typeof rule.id!=="string")continue;
  const matches=Array.isArray(rule.activities)&&rule.activities.some(x=>selected.has(x));
  if(!matches)continue;
  const allowed=Array.isArray(rule.jurisdictions)?rule.jurisdictions.includes(jurisdiction)||rule.jurisdictions.includes("UK"):false;
  if(!allowed){findings.push({id:rule.id,status:"JURISDICTION_REVIEW",actionable:false,reason:"Jurisdiction has not been confirmed for this rule."});continue;}
  const reviewed=rule.reviewStatus==="APPROVED"&&typeof rule.reviewedBy==="string"&&rule.reviewedBy.trim().length>0&&
   typeof rule.sourceUrl==="string"&&rule.sourceUrl.startsWith("https://")&&
   typeof rule.reviewedAt==="string"&&!Number.isNaN(Date.parse(rule.reviewedAt));
  findings.push({id:rule.id,status:reviewed?"REVIEWED_CANDIDATE":"EXPERT_REVIEW_REQUIRED",actionable:reviewed,reason:reviewed?"Potentially applicable: confirm facts and exemptions.":"This regulatory rule has not passed expert review."});
 }
 return {findings,actionable:findings.filter(x=>x.actionable).length,notice:"An actionable candidate is not proof of legal applicability or compliance."};
}
