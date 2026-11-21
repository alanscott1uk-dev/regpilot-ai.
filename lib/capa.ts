import {z} from 'zod';

export const QUALITY_KINDS=['DEVIATION','CAPA'] as const;
export const QUALITY_CLASSES=['MINOR','MAJOR','CRITICAL'] as const;
export const QUALITY_ACTIONS=['CONTAINMENT','CORRECTIVE','PREVENTIVE'] as const;
export const QUALITY_STATES=['INVESTIGATING','ACTIONS_OPEN','EFFECTIVENESS_DUE','CLOSED','REOPENED'] as const;
export const QUALITY_SCOPE='Internal deviation, corrective and preventive action records. Independent effectiveness decisions record a bounded human assessment; they do not certify GMP compliance or replace a validated quality management system.';
export const QUALITY_LIMIT=200,QUALITY_PAGE_SIZE=20;
const identity={requestKey:z.uuid(),version:z.number().int().positive()};
const uniqueIds=z.array(z.uuid()).min(1).max(10).refine(ids=>new Set(ids).size===ids.length);
export const qualityCreateSchema=z.object({requestKey:z.uuid(),title:z.string().trim().min(3).max(160),kind:z.enum(QUALITY_KINDS),classification:z.enum(QUALITY_CLASSES),description:z.string().trim().min(20).max(2000),impact:z.string().trim().min(20).max(1600),containment:z.string().trim().min(20).max(1600),occurredAt:z.iso.date(),ownerId:z.uuid()}).strict();
export const qualityInvestigationSchema=z.object({...identity,ownerId:z.uuid(),containment:z.string().trim().min(20).max(1600),investigationNotes:z.string().trim().min(40).max(3000),rootCause:z.string().trim().min(30).max(2000),effectivenessCriteria:z.string().trim().min(40).max(2000),effectivenessDueAt:z.iso.date()}).strict();
export const qualityActionSchema=z.object({...identity,kind:z.enum(QUALITY_ACTIONS),purpose:z.string().trim().min(20).max(1200),taskId:z.uuid().optional(),title:z.string().trim().min(3).max(160).optional(),ownerId:z.uuid().optional(),dueDate:z.iso.date().optional()}).strict().refine(value=>value.taskId?!value.title&&!value.ownerId&&!value.dueDate:!!value.title&&!!value.ownerId&&!!value.dueDate);
export const qualityEffectivenessSchema=z.object({...identity,observedAt:z.iso.date(),notes:z.string().trim().min(40).max(2000),evidenceIds:uniqueIds,confirm:z.literal(true)}).strict();
export const qualityDecisionSchema=z.object({...identity,caseVersion:z.number().int().positive(),decision:z.enum(['PASSED','FAILED']),notes:z.string().trim().min(30).max(1600),confirm:z.literal(true)}).strict();
export const qualityReopenSchema=z.object({...identity,reason:z.enum(['RECURRENCE','REASSESSMENT']),notes:z.string().trim().min(40).max(1600),occurredAt:z.iso.date(),impact:z.string().trim().min(20).max(1600),containment:z.string().trim().min(20).max(1600)}).strict();
export const qualityQuerySchema=z.object({caseId:z.uuid().optional(),requestKey:z.uuid().optional(),q:z.string().trim().max(120).default(''),status:z.enum(['all','open','due','overdue','reopened','closed']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),taskQ:z.string().trim().max(120).default(''),taskPage:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export type QualityQuery=z.infer<typeof qualityQuerySchema>;
export function qualityDue(date:string|null,status:string,today=new Date().toISOString().slice(0,10)){
 if(status==='CLOSED'||!date)return 'NONE';
 const day=date.slice(0,10);return day<today?'OVERDUE':day===today?'DUE_TODAY':'PLANNED';
}
export function qualityCanClose(observedAt:string,dueAt:string|null,today=new Date().toISOString().slice(0,10)){
 return !!dueAt&&observedAt<=today&&observedAt>=dueAt.slice(0,10)&&dueAt.slice(0,10)<=today;
}
