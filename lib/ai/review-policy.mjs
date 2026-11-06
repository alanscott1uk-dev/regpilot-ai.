import {createHash} from "node:crypto";
export const REVIEW_DECISIONS=Object.freeze(["REVIEWED","NEEDS_CHANGES"]);
export function canonicalReviewValue(value){
 if(Array.isArray(value))return value.map(canonicalReviewValue);
 if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalReviewValue(value[k])]));
 return value;
}
export function reviewContentHash(result){
 if(result===null||typeof result!=="object"||Array.isArray(result))throw new Error("Invalid AI review");
 return createHash("sha256").update(JSON.stringify(canonicalReviewValue(result))).digest("hex");
}
export class ReviewPolicyError extends Error {
 constructor(message, status=400){super(message);this.name="ReviewPolicyError";this.status=status;}
}
export function validateReviewDecision(input,ctx,creatorId){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new ReviewPolicyError("Invalid review decision");
 if(!REVIEW_DECISIONS.includes(input.decision))throw new ReviewPolicyError("Unknown review decision");
 if(ctx?.role!=="OWNER"&&ctx?.role!=="ADMIN")throw new ReviewPolicyError("Only an administrator can review AI drafts",403);
 if(!ctx.userId||ctx.userId===creatorId)throw new ReviewPolicyError("A different authorised reviewer is required",403);
 if(!Number.isInteger(input.version)||input.version<1)throw new ReviewPolicyError("Invalid draft version");
 if(typeof input.notes!=="string"||input.notes.trim().length<20||input.notes.length>800)throw new ReviewPolicyError("Explain the review decision in 20 to 800 characters");
 return {decision:input.decision,notes:input.notes.trim(),version:input.version};
}
export function stableReviewId(value){return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
export function reviewOutputForStorage(ai){
 if(!ai||typeof ai!=="object"||Array.isArray(ai))throw new ReviewPolicyError("No AI output");
 const {summary,confidence,findings,suggestedActions,suggestedAmendments,questions,limitations,scope,source,model,generatedAt}=ai;
 if(typeof summary!=="string"||summary.length<25||summary.length>1300)throw new ReviewPolicyError("Invalid summary");
 const result={summary,confidence,findings,suggestedActions,suggestedAmendments,questions,limitations,scope,source,model,generatedAt};
 const encoded=JSON.stringify(result);
 if(encoded.length>35000)throw new ReviewPolicyError("AI draft too large to retain");
 return result;
}
