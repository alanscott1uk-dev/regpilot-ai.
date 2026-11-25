export type StarterItem={key:string;title:string;description:string;why:string;evidenceHint:string;scopeCategory?:string;sourceUrl?:string;mappings?:readonly string[];suggestedDays:number};
export type StarterPack={id:string;version:number;title:string;description:string;items:readonly StarterItem[]};
export type StarterPlanItem={key:string;title:string;description:string;why:string;assigneeId:string;dueDate:string};
export type StarterPlan={packId:string;packVersion:number;name:string;scopeRationale:string;items:StarterPlanItem[];token?:string;confirm?:true};
export const STARTER_PACKS:readonly StarterPack[];
export const STARTER_PROGRAMME_SCOPE:string;
export const STARTER_PROGRAMME_LIMIT:30;
export const STARTER_TASK_LIMIT:40;
export class StarterProgrammeInputError extends Error{status:number;constructor(message:string,status?:number);}
export function parseStarterProgramme(input:unknown,now?:Date,options?:{allowPastDates?:boolean}):StarterPlan;
export function readStarterProgrammeJson(request:Request):Promise<unknown>;
