// A compact, explainable regulatory-source panel. All controls are candidates
// until a qualified expert has reviewed their applicability.
import {REGULATORY_CONTROLS} from "./regulatory-assurance.mjs";
export function regulatoryReferencesForModule(moduleId){
 const domains={
  suppliers:["medicines-wholesale","controlled-drugs"],
  licences:["medicines-wholesale","controlled-drugs"],
  policies:["medicines-wholesale","controlled-drugs"],
  audits:["medicines-wholesale","controlled-drugs"]
 };
 const relevant=domains[moduleId]??[];
 return REGULATORY_CONTROLS.filter(c=>relevant.includes(c.domain)).map(c=>({
  id:c.id,title:c.title,regulator:c.regulator,url:c.sourceUrl,
  status:c.reviewStatus,notice:"Reference for expert review only. Not a confirmed obligation for this organisation."
 }));
}
