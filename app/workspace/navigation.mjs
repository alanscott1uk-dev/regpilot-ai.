import { COMPLIANCE_MODULES, recommendedModules } from "../../lib/compliance-modules.mjs";
export const GROUPS = [
 {id:"dashboard",label:"Dashboard",modules:[]},
 {id:"compliance",label:"Compliance",modules:["obligations","regulatory","licences"]},
 {id:"documents",label:"Documents",modules:["policies"]},
 {id:"operations",label:"Operations",modules:["suppliers","imports","audits","environment"]},
 {id:"people",label:"People",modules:["departments","hr","safety","training"]},
 {id:"governance",label:"Risk & Governance",modules:["risk","privacy"]},
 {id:"reports",label:"Reports",modules:["reporting"]}
];
export const moduleById = Object.fromEntries(COMPLIANCE_MODULES.map(x=>[x.id,x]));
export function navigationForIndustry(industry) {
 const allowed=new Set(recommendedModules(industry));
 return GROUPS.map(group=>({...group,items:group.modules.filter(id=>allowed.has(id)).map(id=>moduleById[id])}));
}
