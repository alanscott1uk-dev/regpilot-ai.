export const DOCUMENT_CATEGORIES:readonly string[];
export type DocumentMetadata={id:string;title:string;category:string;department:string;owner:string;version:string;reviewDate:string;status:"Draft"|"In review"|"Approved"|"Archived";obligationId?:string};
export function validDocumentMetadata(value:unknown):boolean;
