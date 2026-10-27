export const DOCUMENT_CATEGORIES=Object.freeze([
 "Policies & SOPs","Licences & permits","Certifications","Supplier documents",
 "Contracts & agreements","Import & export","Quality & batch records",
 "Audits & inspections","Risk assessments","Health & safety",
 "Training records","HR documentation","Environmental records",
 "Data protection","Financial compliance","Other"
]);
export function validDocumentMetadata(value){
 return !!value&&typeof value==="object"&&
 typeof value.id==="string"&&value.id.length>0&&
 typeof value.title==="string"&&value.title.trim().length>0&&value.title.length<=160&&
 DOCUMENT_CATEGORIES.includes(value.category)&&
 typeof value.department==="string"&&value.department.length<=80&&
 typeof value.owner==="string"&&value.owner.length<=80&&
 (value.obligationId===undefined||(typeof value.obligationId==="string"&&value.obligationId.length<=80))&&
 typeof value.version==="string"&&value.version.length<=30&&
 typeof value.reviewDate==="string"&&(/^\d{4}-\d{2}-\d{2}$/.test(value.reviewDate)||value.reviewDate==="")&&
 ["Draft","In review","Approved","Archived"].includes(value.status);
}
