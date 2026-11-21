export const EVIDENCE_LIBRARY_PAGE_SIZE:25;
export const EVIDENCE_LIBRARY_USE_LIMIT:10;
export class EvidenceLibraryInputError extends Error {status:400;constructor(message:string);}
export type EvidenceLibraryQuery={q:string;review:'all'|'approved'|'pending'|'rejected'|'quarantined';format:'all'|'pdf'|'docx';uploader:'all'|'mine';page:number;evidenceId:string|null;targetQ:string;targetPage:number};
export function parseEvidenceLibraryQuery(params:URLSearchParams):EvidenceLibraryQuery;
