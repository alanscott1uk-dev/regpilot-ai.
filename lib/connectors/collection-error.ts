/** Codes and retry metadata only; provider bodies and credential-bearing URLs are never errors. */
export class CollectionError extends Error {
 constructor(public code:string,public retryAfterSeconds?:number){super('Connected evidence could not be collected');}
}
