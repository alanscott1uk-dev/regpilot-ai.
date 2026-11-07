// Public GOV.UK publications only. These are monitoring references, not a complete legal register.
export const REGULATORY_SOURCES = Object.freeze([
  { id:"uk-data-protection", agency:"GOV.UK", title:"Data protection and your business", path:"/data-protection-your-business", topic:"Privacy and personal information" },
  { id:"workplace-fire-safety", agency:"GOV.UK", title:"Fire safety in the workplace", path:"/workplace-fire-safety-your-responsibilities", topic:"Premises and workplace safety" },
  { id:"home-office-domestic", agency:"Home Office", title:"Controlled drugs: domestic licences", path:"/guidance/controlled-drugs-domestic-licences", topic:"Controlled drugs licensing" },
  { id:"home-office-application", agency:"Home Office", title:"Domestic licensing applications", path:"/government/publications/domestic-licensing-application-guidance", topic:"Controlled drugs applications" },
  { id:"mhra-organisation", agency:"MHRA", title:"MHRA publications and updates", path:"/government/organisations/medicines-and-healthcare-products-regulatory-agency", topic:"Medicines regulation" },
  { id:"mhra-safety", agency:"MHRA", title:"Safety communications concerning medicines", path:"/government/publications/safety-communications-concerning-medicines-medical-devices-and-other-healthcare-products/safety-communications-concerning-medicines-medical-devices-and-other-healthcare-products", topic:"Safety alerts" },
  {id:"employer-registration",agency:"HMRC",title:"Register as an employer",path:"/register-employer",topic:"Employer registration"},
  {id:"workplace-pensions",agency:"GOV.UK",title:"Set up and manage a workplace pension scheme",path:"/workplace-pensions-employers",topic:"Employment and pensions"},
  {id:"vat-records",agency:"HMRC",title:"Charge, reclaim and record VAT",path:"/charge-reclaim-record-vat",topic:"VAT and accounting records"},
  {id:"company-records",agency:"GOV.UK",title:"Running a limited company",path:"/running-a-limited-company",topic:"Corporate governance and records"},
  {id:"distance-selling",agency:"GOV.UK",title:"Online and distance selling",path:"/online-and-distance-selling-for-businesses",topic:"Consumer sales"},
  {id:"food-registration",agency:"Food Standards Agency",title:"Food business registration",path:"/guidance/food-business-registration",topic:"Food business permissions and territorial differences"},
  {id:"food-safety",agency:"Food Standards Agency",title:"Managing food safety",path:"/government/publications/managing-food-safety/managing-food-safety",topic:"Food safety management"},
  {id:"commercial-waste",agency:"GOV.UK",title:"Dispose of business or commercial waste",path:"/dispose-business-commercial-waste",topic:"Waste management and territorial differences"}
]);
export function normaliseContent(source, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.title !== "string") throw new Error("Invalid GOV.UK content");
  return {
    id:source.id,agency:source.agency,topic:source.topic,
    title:raw.title, url:"https://www.gov.uk"+source.path,
    updatedAt:typeof raw.public_updated_at==="string"?raw.public_updated_at:null,
    revisionAt:typeof raw.updated_at==="string"?raw.updated_at:null,
    firstPublishedAt:typeof raw.first_published_at==="string"?raw.first_published_at:null,
    description:typeof raw.description==="string"?raw.description.slice(0,300):"",
    status:"available"
  };
}
