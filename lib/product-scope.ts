import {z} from 'zod';

export const PRODUCT_LIMITS={products:100,selected:10,responses:100,evidence:3000} as const;
const version=z.number().int().positive(),notes=z.string().trim().min(20).max(1200);
const code=z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/,'Use 2–24 letters, numbers or hyphens');
export const productFields=z.object({code,name:z.string().trim().min(2).max(100),description:z.string().trim().max(1200).default('')});
export const createProductInput=productFields.extend({requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export const changeProductInput=z.discriminatedUnion('action',[
 productFields.extend({action:z.literal('UPDATE'),version,notes,confirm:z.literal(true)}).strict(),
 z.object({action:z.enum(['ARCHIVE','RESTORE']),version,notes,confirm:z.literal(true)}).strict()
]);
export const evidenceScopeInput=z.object({evidenceId:z.uuid(),reviewVersion:version,mode:z.enum(['UNSCOPED','GLOBAL','PRODUCT']),productIds:z.array(z.uuid()).max(10).refine(ids=>new Set(ids).size===ids.length),notes,requestKey:z.uuid(),confirm:z.literal(true)}).strict().superRefine((v,c)=>{if(v.mode==='PRODUCT'?!v.productIds.length:!!v.productIds.length)c.addIssue({code:'custom',message:'Product scope needs selected products; global or unscoped must have none',path:['productIds']});});
export const productSnapshotSchema=z.object({id:z.uuid(),code:z.string().min(2).max(24),name:z.string().min(2).max(100),version}).strict();
export type ProductSnapshot=z.infer<typeof productSnapshotSchema>;
export const productQuestionnaireContextSchema=z.object({format:z.literal('product-questionnaire-v1'),products:z.array(productSnapshotSchema).min(1).max(10).refine(v=>new Set(v.map(p=>p.id)).size===v.length)}).strict();
export const answerProductContextSchema=z.discriminatedUnion('mode',[
 z.object({format:z.literal('product-answer-v1'),mode:z.literal('GLOBAL')}).strict(),
 z.object({format:z.literal('product-answer-v1'),mode:z.literal('PRODUCT'),product:productSnapshotSchema}).strict()
]);
export const productEvidenceScopeSchema=z.object({id:z.uuid(),mode:z.enum(['GLOBAL','PRODUCT']),version,productIds:z.array(z.uuid()).max(10)}).strict();
export const questionProductContextSchema=z.object({format:z.literal('questionnaire-product-v1'),product:productSnapshotSchema,evidence:z.array(productEvidenceScopeSchema).max(500)}).strict();
export type AnswerProductContext=z.infer<typeof answerProductContextSchema>;
export type QuestionProductContext=z.infer<typeof questionProductContextSchema>;
export function answerMatchesProduct(question:{productId?:string|null},answer:{productId?:string|null;productContext?:unknown}){
 if(!question.productId)return !answer.productId;
 const context=answerProductContextSchema.safeParse(answer.productContext);
 return context.success&&(context.data.mode==='GLOBAL'&&!answer.productId||context.data.mode==='PRODUCT'&&answer.productId===question.productId&&context.data.product.id===question.productId);
}
