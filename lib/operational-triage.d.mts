export type TriageRow={id:string;title:string;owner:string;due:string;status:string;linked:number;verifiedAttachments:number;state:string;regulator:string;notes:string;sourceUrl:string;sourceCheckedAt:string;completionRationale:string;daysRemaining:number|null;priority:number;nextStep:string;level:"exception"|"overdue"|"soon"|"complete"|"evidence"|"routine";completionException:boolean};
export type OperationalEvent={id:string;actionId:string;action:string;details:string;timestamp:string};
export function operationalQueue(actions:any[],documents:any[],today:string):TriageRow[];
export function operationsSummary(rows:TriageRow[]):{total:number;overdue:number;dueSoon:number;exceptions:number;needsEvidence:number;completed:number;needsAttention:number};
export function exportOperationsCsv(rows:TriageRow[]):string;
export const ACTIVITY_KEY:string;
export function addOperationalEvent(events:OperationalEvent[],actionId:string,action:string,details:string,time?:string):OperationalEvent[];
export function validOperationalEvents(events:unknown):events is OperationalEvent[];
