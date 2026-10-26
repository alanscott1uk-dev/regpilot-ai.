export const COMPLIANCE_MODULES=Object.freeze([
 {id:"regulatory",name:"Regulatory intelligence",sectors:["all"]},
 {id:"obligations",name:"Compliance register",sectors:["all"]},
 {id:"departments",name:"Departments & ownership",sectors:["all"]},
 {id:"licences",name:"Licences & certifications",sectors:["all"]},
 {id:"policies",name:"Policies & SOPs",sectors:["all"]},
 {id:"audits",name:"Audits & inspections",sectors:["all"]},
 {id:"risk",name:"Risk management",sectors:["all"]},
 {id:"safety",name:"Health & safety",sectors:["all"]},
 {id:"hr",name:"HR compliance",sectors:["all"]},
 {id:"privacy",name:"Data protection",sectors:["all"]},
 {id:"suppliers",name:"Supplier qualification",sectors:["healthcare","manufacturing","food","logistics","construction","retail","hospitality"]},
 {id:"imports",name:"Imports & distribution",sectors:["healthcare","manufacturing","food","logistics","retail"]},
 {id:"environment",name:"Environmental compliance",sectors:["manufacturing","food","logistics","construction","hospitality"]},
 {id:"training",name:"Training & competency",sectors:["all"]},
 {id:"reporting",name:"Management reporting",sectors:["all"]}
]);
export function recommendedModules(industryId){
 return COMPLIANCE_MODULES.filter(x=>x.sectors.includes("all")||x.sectors.includes(industryId)).map(x=>x.id);
}
export function validModules(ids){
 return Array.isArray(ids)&&ids.length<=COMPLIANCE_MODULES.length&&ids.every(x=>typeof x==="string"&&COMPLIANCE_MODULES.some(m=>m.id===x))&&new Set(ids).size===ids.length;
}
