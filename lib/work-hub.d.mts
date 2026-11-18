export type WorkView='open'|'mine'|'overdue'|'unassigned'|'review'|'complete';
export const WORK_VIEWS:Readonly<Record<WorkView,string>>;
export const WORK_PAGE_SIZE:25;
export class WorkInputError extends Error { status:number; constructor(message:string,status?:number); }
export function workUuid(value:unknown):value is string;
export function workDate(value:unknown):string;
export type WorkQuery={view:WorkView;q:string;page:number};
export function parseWorkQuery(params:URLSearchParams):WorkQuery;
export type WorkPlan={items:{id:string;updatedAt:string}[];changes:{assigneeId?:string|null;dueDate?:string};reason:string;token?:string};
export function parseWorkPlan(input:unknown):WorkPlan;
export type WorkTask={id:string;status:string;originKey?:string|null;changeAction?:{responseId:string}|null;auditRequest?:unknown;accessItem?:unknown};
export function planningBlock(task:WorkTask):string|null;
export function taskWorkflow(task:WorkTask,organizationId:string):{label:string;href:string};
export function safeWorkSource(value:unknown):string|null;

export function parseWorkStart(input:unknown):{id:string;updatedAt:string};
export function readWorkJson(request:Request):Promise<unknown>;

export function parseWorkCreate(input:unknown):{title:string;category:string;notes:string;dueDate:string;assigneeId:string};
