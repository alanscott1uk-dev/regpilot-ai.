import type {WorkCompletionInput} from './work-completion.mjs';
export const WORK_REVIEW_PAGE_SIZE:25;
export const WORK_REVIEW_SCOPE:string;
export type WorkReviewQuery={q:string;page:number};
export type WorkReviewFollowUpInput={phase:'preview'|'apply';reviewToken:string;assigneeId:string;dueDate:string;reason:string;token?:string;confirm?:true};
export function parseWorkReviewQuery(params:URLSearchParams):WorkReviewQuery;
export function parseWorkReviewFollowUp(input:unknown):WorkReviewFollowUpInput;
export function parseWorkVerification(input:unknown):WorkCompletionInput;
