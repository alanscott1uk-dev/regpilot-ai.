export function assessBusiness(f) {
  const findings = [];
  const add = (item) => findings.push(item);
  const knownEmployees = typeof f.employeeCount === "number" && Number.isInteger(f.employeeCount) && f.employeeCount >= 0;
  add({
    id: "HS-002", title: "Written health and safety policy", category: "Employment", kind: "statutory",
    status: !knownEmployees ? "information-required" : f.employeeCount >= 5 ? "review-required" : "not-triggered",
    explanation: !knownEmployees ? "Employee count is required to assess the five-employee written-policy threshold." : f.employeeCount >= 5 ? "Five or more employees reported. Verify that the required written policy exists and is current." : "Fewer than five employees reported. Other health and safety duties may still apply.",
    source: HSE, factKeys: ["employeeCount"],
  });
  add({
    id: "DP-002", title: "ICO data protection fee assessment", category: "Data Protection", kind: "assessment",
    status: f.processesPersonalData == null ? "information-required" : f.processesPersonalData ? "review-required" : "information-required",
    explanation: f.processesPersonalData == null ? "Confirm whether the business processes personal information." : f.processesPersonalData ? "Check whether a fee applies and whether an exemption is available." : "Verify the answer: many businesses process some personal information even without a customer database.",
    source: ICO, factKeys: ["processesPersonalData"],
  });
  add({
    id: "WEB-001", title: "Limited-company website disclosures", category: "Digital", kind: "assessment",
    status: f.operatesWebsite == null ? "information-required" : f.operatesWebsite ? "review-required" : "not-triggered",
    explanation: f.operatesWebsite == null ? "Confirm whether the company operates a website." : f.operatesWebsite ? "Check that required company identity details appear on the website." : "No website reported; review if one is launched.",
    source: GOV, factKeys: ["operatesWebsite"],
  });
  const turnoverKnown = typeof f.taxableTurnover12m === "number" && Number.isFinite(f.taxableTurnover12m) && f.taxableTurnover12m >= 0;
  add({
    id: "VAT-001", title: "VAT registration threshold review", category: "Tax", kind: "assessment",
    status: !turnoverKnown || f.vatRegistered == null ? "information-required" : !f.vatRegistered && f.taxableTurnover12m >= 90000 ? "review-required" : "not-triggered",
    explanation: !turnoverKnown || f.vatRegistered == null ? "Provide taxable turnover and VAT registration status. Forward-looking tests and exceptions still require assessment." : !f.vatRegistered && f.taxableTurnover12m >= 90000 ? "Reported rolling taxable turnover reaches the indicative £90,000 threshold. Review registration urgently, including exceptions and timing." : "No threshold alert from these facts. Forward-looking registration tests and special cases are not assessed.",
    source: VAT, factKeys: ["taxableTurnover12m", "vatRegistered"],
  });
  add({
    id: "AI-001", title: "AI tool inventory", category: "AI Governance", kind: "regpilot-control",
    status: f.usesAI == null ? "information-required" : f.usesAI ? "review-required" : "not-triggered",
    explanation: f.usesAI == null ? "Confirm whether staff use AI tools." : f.usesAI ? "RegPilot recommends recording AI tools, owners and permitted data uses. This register is not a universal statutory requirement." : "No AI tools reported.",
    source: AI, factKeys: ["usesAI"],
  });
  add({
    id: "TRADE-001", title: "Import obligations assessment", category: "Trade", kind: "assessment",
    status: f.importsGoods == null ? "information-required" : f.importsGoods ? "review-required" : "not-triggered",
    explanation: f.importsGoods == null ? "Confirm whether the company imports goods." : f.importsGoods ? "Determine product, origin, customs and any sector-specific import controls." : "No goods imports reported.",
    source: TRADE, factKeys: ["importsGoods"],
  });
  return findings;
}
export function assessmentSummary(findings) {
  return {
    reviewed: findings.filter(x => x.status === "review-required").length,
    unanswered: findings.filter(x => x.status === "information-required").length,
    notTriggered: findings.filter(x => x.status === "not-triggered").length,
  };
}
