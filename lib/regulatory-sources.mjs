// Public GOV.UK publications only. These are monitoring references, not a complete legal register.
export const REGULATORY_SOURCES = Object.freeze([
  { id:"home-office-domestic", agency:"Home Office", title:"Controlled drugs: domestic licences", path:"/guidance/controlled-drugs-domestic-licences", topic:"Controlled drugs licensing" },
  { id:"mhra-organisation", agency:"MHRA", title:"MHRA publications and updates", path:"/government/organisations/medicines-and-healthcare-products-regulatory-agency", topic:"Medicines regulation" },
  { id:"mhra-safety", agency:"MHRA", title:"Safety communications concerning medicines", path:"/government/publications/safety-communications-concerning-medicines-medical-devices-and-other-healthcare-products/safety-communications-concerning-medicines-medical-devices-and-other-healthcare-products", topic:"Safety alerts" }
]);
export function normaliseContent(source, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.title !== "string") throw new Error("Invalid GOV.UK content");
  return {
    id:source.id,agency:source.agency,topic:source.topic,
    title:raw.title, url:"https://www.gov.uk"+source.path,
    updatedAt:typeof raw.public_updated_at==="string"?raw.public_updated_at:null,
    firstPublishedAt:typeof raw.first_published_at==="string"?raw.first_published_at:null,
    description:typeof raw.description==="string"?raw.description.slice(0,300):"",
    status:"available"
  };
}
