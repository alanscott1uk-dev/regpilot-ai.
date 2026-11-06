import {isValidDate,validateObligation} from "./obligations.mjs";

export const CHANGE_REVIEW_KEY="regpilot-regulatory-review-v1";
export const REVIEW_STATUSES=Object.freeze(["unreviewed","investigating","not-applicable","action-required"]);
const IMPACTS=Object.freeze(["unknown","low","moderate","high"]);
export function sourceVersion(source){
 if(!source||typeof source!=="object")return "";
 return typeof source.revisionAt==="string"&&source.revisionAt?source.revisionAt:typeof source.updatedAt==="string"?source.updatedAt:"";
}
export function reviewKey(source){return source.id+"::"+sourceVersion(source)}
export function safeOfficialSource(source) {
 if(!source||typeof source.id!=="string"||source.id.length>100||typeof source.title!=="string"||source.title.length>300||typeof source.url!=="string")return false;
 try{const url=new URL(source.url);return url.protocol==="https:"&&url.hostname==="www.gov.uk"&&!url.username&&!url.password}catch{return false;}
}
export function validateChangeReview(r){
 return !!r&&typeof r==="object"&&typeof r.key==="string"&&r.key.length<=200&&
 REVIEW_STATUSES.includes(r.status)&&IMPACTS.includes(r.impact)&&
 typeof r.owner==="string"&&r.owner.length<=80&&
 typeof r.notes==="string"&&r.notes.length<=500&&
 typeof r.due==="string"&&(r.due===""||isValidDate(r.due))&&
 typeof r.updatedAt==="string"&&!Number.isNaN(Date.parse(r.updatedAt))&&
 (r.actionId===undefined||(typeof r.actionId==="string"&&r.actionId.length<=80));
}
export function parseChangeReviews(raw) {
 try{const parsed=JSON.parse(raw);if(!Array.isArray(parsed))return [];return parsed.filter(validateChangeReview).slice(0,300);}catch{return [];}
}
export function buildReview(source,values,time=new Date().toISOString()){
 if(!safeOfficialSource(source))throw new Error("Not a supported official source");
 const review={key:reviewKey(source),status:values.status,impact:values.impact,owner:values.owner.trim(),due:values.due,notes:values.notes.trim(),updatedAt:time};
 if(!validateChangeReview(review))throw new Error("Review is invalid");
 if(review.status==="action-required"&&(!review.owner||!review.due))throw new Error("An action requires an owner and target date");
 if(review.status==="not-applicable"&&review.notes.length<10)throw new Error("Explain why the source is not applicable (at least 10 characters)");
 return review;
}
export function buildTaskFromSource(source,review,id){
 if(!safeOfficialSource(source)||!validateChangeReview(review)||review.key!==reviewKey(source)||review.status!=="action-required"||!review.owner||!review.due)throw new Error("Complete this source's impact review first");
 const task={
  id,title:("Assess impact: "+source.title).slice(0,160),regulator:source.agency||"UK regulation",
  owner:review.owner,due:review.due,status:"Open",
  notes:("Source publication metadata requires a human applicability assessment. Impact rated "+review.impact+". "+review.notes).slice(0,500),
  sourceUrl:source.url,sourceCheckedAt:new Date(review.updatedAt).toISOString().slice(0,10)
 };
 if(!validateObligation(task))throw new Error("Generated task failed validation");
 return task;
}
export function reviewSummary(sources,reviews){
 const safe=Array.isArray(sources)?sources.filter(s=>safeOfficialSource(s)&&s.status==="available"):[];
 const actionable=safe.filter(source=>{
  const r=reviews.find(x=>x.key===reviewKey(source));
  return !r||r.status==="unreviewed"||r.status==="investigating"||r.status==="action-required"&&!r.actionId;
 });
 return {sources:safe.length,awaiting:actionable.length,tracked:safe.filter(s=>reviews.some(r=>r.key===reviewKey(s)&&r.actionId)).length};
}
