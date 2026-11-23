// Pure deadline and action-priority helpers for workspace demo and future APIs.
export function isIsoDate(value) {
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function daysUntil(due,today) {
 if(!isIsoDate(due)||!isIsoDate(today))return null;
 return Math.round((Date.parse(due+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000);
}
export function actionPriority(action,today) {
 if(action.status==="Complete")return "Complete";
 const days=daysUntil(action.due,today);
 if(days===null)return "Unknown";
 if(days<0)return "Overdue";
 if(days<=7)return "Urgent";
 if(days<=30)return "Upcoming";
 return "Scheduled";
}
export function actionSummary(actions,today) {
 const counts={overdue:0,urgent:0,upcoming:0,scheduled:0,complete:0,unknown:0};
 for(const action of actions){
  const key=actionPriority(action,today).toLowerCase();
  counts[key]++;
 }
 return counts;
}
