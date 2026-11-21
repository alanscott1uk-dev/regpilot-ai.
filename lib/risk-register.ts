import {z} from 'zod';

export const RISK_CATEGORIES=['OPERATIONAL','SECURITY','PRIVACY','SUPPLIER','QUALITY','OTHER'] as const;
export const RISK_STRATEGIES=['MITIGATE','ACCEPT','TRANSFER','AVOID'] as const;
export const RISK_LIMIT=200;
export const RISK_PAGE_SIZE=25;
export const RISK_SCOPE='Internal risk judgements and their recorded evidence. Ratings use likelihood × impact on a five-point scale. A recorded acceptance is a human decision about remaining risk, not certification or a prediction that harm cannot occur.';
export const riskFields={
 title:z.string().trim().min(3).max(160),description:z.string().trim().min(20).max(2000),category:z.enum(RISK_CATEGORIES),
 ownerId:z.uuid(),likelihood:z.number().int().min(1).max(5),impact:z.number().int().min(1).max(5),
 ratingRationale:z.string().trim().min(20).max(1200),strategy:z.enum(RISK_STRATEGIES),reviewDueAt:z.iso.date(),
 controlIds:z.array(z.uuid()).max(10).refine(ids=>new Set(ids).size===ids.length)
};
export const createRiskSchema=z.object({...riskFields,requestKey:z.uuid()});
export const updateRiskSchema=z.object({...riskFields,version:z.number().int().positive()});
export const treatmentSchema=z.object({version:z.number().int().positive(),requestKey:z.uuid(),purpose:z.string().trim().min(20).max(1200),taskId:z.uuid().optional(),title:z.string().trim().min(3).max(160).optional(),ownerId:z.uuid().optional(),dueDate:z.iso.date().optional()}).refine(value=>value.taskId?!value.title&&!value.ownerId&&!value.dueDate:!!value.title&&!!value.ownerId&&!!value.dueDate);
export const riskReviewSchema=z.object({version:z.number().int().positive(),requestKey:z.uuid(),residualLikelihood:z.number().int().min(1).max(5),residualImpact:z.number().int().min(1).max(5),rationale:z.string().trim().min(40).max(1600),validUntil:z.iso.date(),evidenceIds:z.array(z.uuid()).min(1).max(10).refine(ids=>new Set(ids).size===ids.length),confirm:z.literal(true)});
export const riskDecisionSchema=z.object({version:z.number().int().positive(),riskVersion:z.number().int().positive(),decision:z.enum(['ACCEPTED','RETURNED']),notes:z.string().trim().min(20).max(1600),confirm:z.literal(true)});
export const riskArchiveSchema=z.object({version:z.number().int().positive(),notes:z.string().trim().min(20).max(1200)});
export function riskRating(likelihood:number,impact:number){
 if(!Number.isInteger(likelihood)||likelihood<1||likelihood>5||!Number.isInteger(impact)||impact<1||impact>5)throw new Error('Choose likelihood and impact from 1 to 5');
 const score=likelihood*impact;
 return {score,band:score<=5?'LOW':score<=10?'MODERATE':score<=15?'HIGH':'VERY_HIGH'};
}
export const riskQuerySchema=z.object({riskId:z.uuid().optional(),requestKey:z.uuid().optional(),q:z.string().trim().max(120).default(''),status:z.enum(['all','open','under_review','accepted','archived']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),taskQ:z.string().trim().max(120).default(''),taskPage:z.coerce.number().int().min(1).max(100000).default(1)});
export type RiskQuery=z.infer<typeof riskQuerySchema>;
