import {isValidDate} from "./obligations.mjs";
export function reviewState(item,today,warningDays=30){
 if(!item||typeof item.reviewDate!=="string"||!isValidDate(item.reviewDate)||!isValidDate(today))return "unscheduled";
 if(item.status==="Archived")return "archived";
 const review=Date.parse(item.reviewDate+"T00:00:00Z");
 const current=Date.parse(today+"T00:00:00Z");
 const days=Math.ceil((review-current)/86400000);
 return days<0?"overdue":days<=warningDays?"due-soon":"current";
}
export function documentReviewSummary(items,today){
 return items.reduce((result,item)=>{const status=reviewState(item,today);result[status]=(result[status]||0)+1;return result;},{});
}
