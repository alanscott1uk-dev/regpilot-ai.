export const COMPLETION_EVIDENCE_LIMIT:10;
export const COMPLETION_SCOPE:string;
export type WorkCompletionInput={token:string;evidenceIds:string[];confirm:true;notes:string};
export function parseWorkCompletion(input:unknown):WorkCompletionInput;
export function selectedCompletionEvidence<T extends {id:string}>(evidence:T[],ids:string[],mandatory?:boolean):T[];
