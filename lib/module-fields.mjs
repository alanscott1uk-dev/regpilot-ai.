// Metadata definitions for sector-specific register fields.
// These describe UI fields, not legal compliance requirements.
export const MODULE_FIELDS = Object.freeze({
 licences: [
  {key:"reference",label:"Licence / certificate number",type:"text"},
  {key:"issuer",label:"Issuing authority",type:"text"},
  {key:"expiry",label:"Expiry date",type:"date"}
 ],
 suppliers: [
  {key:"supplier",label:"Supplier name",type:"text"},
  {key:"approval",label:"Approval status",type:"select",options:["Pending","Approved","Suspended","Rejected"]},
  {key:"expiry",label:"Certificate expiry",type:"date"}
 ],
 imports: [
  {key:"origin",label:"Country of origin",type:"text"},
  {key:"product",label:"Product category",type:"text"},
  {key:"reference",label:"Shipment reference",type:"text"}
 ],
 audits: [
  {key:"auditType",label:"Audit type",type:"text"},
  {key:"finding",label:"Finding category",type:"select",options:["Observation","Minor","Major","Not classified"]},
  {key:"followUp",label:"Follow-up date",type:"date"}
 ],
 training: [
  {key:"course",label:"Training course",type:"text"},
  {key:"trainee",label:"Employee / role",type:"text"},
  {key:"renewal",label:"Renewal date",type:"date"}
 ],
 risk: [
  {key:"likelihood",label:"Likelihood (1–5)",type:"select",options:["1","2","3","4","5"]},
  {key:"impact",label:"Impact (1–5)",type:"select",options:["1","2","3","4","5"]},
  {key:"mitigation",label:"Mitigation",type:"text"}
 ],
 policies: [
  {key:"documentCode",label:"Document code",type:"text"},
  {key:"revision",label:"Revision",type:"text"},
  {key:"reviewDate",label:"Review date",type:"date"}
 ]
});
export function fieldsForModule(moduleId) {
 return MODULE_FIELDS[moduleId] ?? [];
}
export function validateModuleDetails(moduleId, details) {
 if (!details || typeof details !== "object" || Array.isArray(details)) return false;
 const fields=fieldsForModule(moduleId);
 const allowed=new Set(fields.map(f=>f.key));
 return Object.entries(details).every(([key,value])=>{
  if(!allowed.has(key) || typeof value!=="string" || value.length>180) return false;
  const field=fields.find(f=>f.key===key);
  if(field.type==="select")return value==="" || field.options.includes(value);
  if(field.type==="date" && value!=="")return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+"T00:00:00Z"));
  return true;
 });
}
