// Registry of official UK regulatory bodies and authoritative guidance sources.
// Catalogue entries are discovery metadata, not an assertion that every body regulates every business.
export const AUTHORITIES = Object.freeze([
 {id:"mhra",name:"Medicines and Healthcare products Regulatory Agency",kind:"regulator",jurisdictions:["UK"],sectors:["pharmaceuticals","medical-devices"],url:"https://www.gov.uk/government/organisations/medicines-and-healthcare-products-regulatory-agency"},
 {id:"home-office",name:"Home Office",kind:"government-department",jurisdictions:["UK"],sectors:["controlled-drugs","security"],url:"https://www.gov.uk/government/organisations/home-office"},
 {id:"hse",name:"Health and Safety Executive",kind:"regulator",jurisdictions:["GB"],sectors:["general","construction","manufacturing","logistics"],url:"https://www.hse.gov.uk/"},
 {id:"ico",name:"Information Commissioner's Office",kind:"regulator",jurisdictions:["UK"],sectors:["general","technology","healthcare"],url:"https://ico.org.uk/"},
 {id:"hmrc",name:"HM Revenue & Customs",kind:"government-department",jurisdictions:["UK"],sectors:["general","tax","imports"],url:"https://www.gov.uk/government/organisations/hm-revenue-customs"},
 {id:"companies-house",name:"Companies House",kind:"registrar",jurisdictions:["UK"],sectors:["general","corporate"],url:"https://www.gov.uk/government/organisations/companies-house"},
 {id:"fca",name:"Financial Conduct Authority",kind:"regulator",jurisdictions:["UK"],sectors:["financial-services"],url:"https://www.fca.org.uk/"},
 {id:"cqc",name:"Care Quality Commission",kind:"regulator",jurisdictions:["England"],sectors:["healthcare","social-care"],url:"https://www.cqc.org.uk/"},
 {id:"his",name:"Healthcare Improvement Scotland",kind:"regulator",jurisdictions:["Scotland"],sectors:["healthcare"],url:"https://www.healthcareimprovementscotland.scot/"},
 {id:"gphc",name:"General Pharmaceutical Council",kind:"professional-regulator",jurisdictions:["GB"],sectors:["pharmacy"],url:"https://www.pharmacyregulation.org/"},
 {id:"sepa",name:"Scottish Environment Protection Agency",kind:"regulator",jurisdictions:["Scotland"],sectors:["environment","manufacturing","waste"],url:"https://www.sepa.org.uk/"},
 {id:"environment-agency",name:"Environment Agency",kind:"regulator",jurisdictions:["England"],sectors:["environment","manufacturing","waste"],url:"https://www.gov.uk/government/organisations/environment-agency"},
 {id:"natural-resources-wales",name:"Natural Resources Wales",kind:"regulator",jurisdictions:["Wales"],sectors:["environment","waste"],url:"https://naturalresources.wales/"},
 {id:"niea",name:"Northern Ireland Environment Agency",kind:"regulator",jurisdictions:["Northern Ireland"],sectors:["environment","waste"],url:"https://www.daera-ni.gov.uk/northern-ireland-environment-agency"},
 {id:"fsa",name:"Food Standards Agency",kind:"regulator",jurisdictions:["England","Wales","Northern Ireland"],sectors:["food","hospitality"],url:"https://www.food.gov.uk/"},
 {id:"fss",name:"Food Standards Scotland",kind:"regulator",jurisdictions:["Scotland"],sectors:["food","hospitality"],url:"https://www.foodstandards.gov.scot/"},
 {id:"dvsa",name:"Driver and Vehicle Standards Agency",kind:"executive-agency",jurisdictions:["GB"],sectors:["transport","logistics"],url:"https://www.gov.uk/government/organisations/driver-and-vehicle-standards-agency"},
 {id:"opss",name:"Office for Product Safety and Standards",kind:"regulatory-office",jurisdictions:["UK"],sectors:["retail","product-safety"],url:"https://www.gov.uk/government/organisations/office-for-product-safety-and-standards"},
 {id:"ofcom",name:"Ofcom",kind:"regulator",jurisdictions:["UK"],sectors:["communications","online-services"],url:"https://www.ofcom.org.uk/"},
 {id:"acas",name:"Acas",kind:"guidance-body",jurisdictions:["GB"],sectors:["general","employment"],url:"https://www.acas.org.uk/"}
]);
const normalize=(values)=>new Set(Array.isArray(values)?values.filter(x=>typeof x==="string").map(x=>x.toLowerCase()):[]);
export function findRelevantAuthorities({jurisdiction,sectors}){
 const selected=normalize(sectors);
 const place=typeof jurisdiction==="string"?jurisdiction:"";
 return AUTHORITIES.filter(a=>(a.jurisdictions.includes("UK")||a.jurisdictions.includes("GB")&&place!=="Northern Ireland"||a.jurisdictions.includes(place)) &&
  (a.sectors.includes("general")||a.sectors.some(s=>selected.has(s)))).map(a=>({...a,applicability:"CANDIDATE_REVIEW_ONLY"}));
}
