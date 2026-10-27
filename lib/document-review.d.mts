export type ReviewState="unscheduled"|"archived"|"overdue"|"due-soon"|"current";
export function reviewState(item:{reviewDate:string;status:string},today:string,warningDays?:number):ReviewState;
export function documentReviewSummary(items:Array<{reviewDate:string;status:string}>,today:string):Record<string,number>;
