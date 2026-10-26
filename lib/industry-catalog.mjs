export const INDUSTRIES=Object.freeze([
 {id:"healthcare",name:"Healthcare & Life Sciences",departments:["Regulatory Affairs","Quality Assurance","Clinical Operations","Pharmacovigilance","Supply Chain","Human Resources","Finance","IT & Data Protection","Health & Safety"]},
 {id:"manufacturing",name:"Manufacturing",departments:["Production","Quality Assurance","Engineering","Maintenance","Procurement","Supply Chain","Human Resources","Finance","Health & Safety","Environmental"]},
 {id:"food",name:"Food & Beverage",departments:["Food Safety","Quality Assurance","Production","Procurement","Supply Chain","Human Resources","Finance","Health & Safety","Environmental"]},
 {id:"logistics",name:"Logistics & Distribution",departments:["Warehouse Operations","Transport","Fleet Management","Quality Assurance","Procurement","Human Resources","Finance","Health & Safety","IT & Data Protection"]},
 {id:"construction",name:"Construction",departments:["Site Operations","Health & Safety","Engineering","Procurement","Environmental","Human Resources","Finance","Legal & Contracts","Quality Assurance"]},
 {id:"financial",name:"Financial Services",departments:["Risk & Compliance","Legal","Finance","Operations","Customer Services","Human Resources","IT & Cybersecurity","Data Protection","Internal Audit"]},
 {id:"retail",name:"Retail & E-commerce",departments:["Store Operations","Customer Services","Procurement","Supply Chain","Marketing","Finance","Human Resources","IT & Data Protection","Health & Safety"]},
 {id:"technology",name:"Technology & SaaS",departments:["Engineering","Information Security","Data Protection","Product","Customer Success","Legal","Human Resources","Finance","Operations"]},
 {id:"hospitality",name:"Hospitality",departments:["Operations","Food Safety","Facilities","Customer Services","Human Resources","Finance","Health & Safety","Procurement"]},
 {id:"general",name:"Other / General Business",departments:["Operations","Quality Assurance","Human Resources","Finance","Legal & Compliance","IT & Data Protection","Health & Safety","Procurement"]}
]);
export function getIndustry(id){return INDUSTRIES.find(x=>x.id===id)||INDUSTRIES[INDUSTRIES.length-1];}
export function validateDepartments(names){
 return Array.isArray(names)&&names.length<=40&&names.every(x=>typeof x==="string"&&x.trim().length>0&&x.length<=80)&&new Set(names.map(x=>x.trim().toLowerCase())).size===names.length;
}
