export const DOCUMENT_ACTIVITY_KEY="regpilot-document-activity-v1";
export function addDocumentEvent(events,documentId,action,details="",timestamp=new Date().toISOString()){
 if(!Array.isArray(events)||typeof documentId!=="string"||!documentId||typeof action!=="string"||!action)return [];
 const event={id:typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():String(Date.now()),documentId,action:action.slice(0,80),details:String(details).slice(0,240),timestamp};
 return [event,...events].slice(0,500);
}
export function validDocumentEvents(input){
 return Array.isArray(input)&&input.length<=500&&input.every(x=>x&&typeof x.id==="string"&&typeof x.documentId==="string"&&typeof x.action==="string"&&typeof x.details==="string"&&typeof x.timestamp==="string");
}
