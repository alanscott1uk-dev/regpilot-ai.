export const MAX_EVIDENCE_BYTES:number;
export const MAX_ORG_EVIDENCE_BYTES:number;
export const MAX_ORG_EVIDENCE_FILES:number;
export class EvidenceError extends Error{status:number;constructor(message:string,status?:number);}
export function checkPdf(bytes:Uint8Array|Buffer,filename:string):Buffer;
export function evidenceHash(bytes:Uint8Array|Buffer):string;
export function contentDispositionFilename(value:string):string;
export function objectKey(organisationId:string):string;
export function scanWithClamd(bytes:Uint8Array|Buffer,options?:{host?:string;port?:number;timeoutMs?:number}):Promise<{status:"CLEAN";engine:string}>;
