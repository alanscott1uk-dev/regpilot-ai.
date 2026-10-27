export type DocumentEvent={id:string;documentId:string;action:string;details:string;timestamp:string};
export const DOCUMENT_ACTIVITY_KEY:string;
export function addDocumentEvent(events:DocumentEvent[],documentId:string,action:string,details?:string,timestamp?:string):DocumentEvent[];
export function validDocumentEvents(input:unknown):input is DocumentEvent[];
