import type {CollectionStep} from './collection-step';
/** Codes and retry metadata only; provider bodies and credential-bearing URLs are never errors. */
export class CollectionError extends Error {
 constructor(public code:string,public retryAfterSeconds?:number,public step?:CollectionStep){super('Connected evidence could not be collected');}
}
