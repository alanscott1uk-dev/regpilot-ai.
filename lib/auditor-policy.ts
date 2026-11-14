import {z} from "zod";
export const AUDIT_LIMITS={rooms:40,roomDays:90,guests:10,inviteDays:7,evidence:50,questions:100,dailyQuestions:20} as const;
export const auditPeriodSchema=z.object({from:z.iso.date(),to:z.iso.date()}).refine(p=>p.from<=p.to&&Date.parse(p.to)-Date.parse(p.from)<=366*86400000,"Choose an audit period of no more than 366 days");
export const roomDraftSchema=z.object({
 title:z.string().trim().min(3).max(160),purpose:z.string().trim().min(20).max(1200),
 questionnaireId:z.uuid().optional(),period:auditPeriodSchema.optional(),expiresAt:z.iso.datetime(),evidenceIds:z.array(z.uuid()).max(AUDIT_LIMITS.evidence).refine(v=>new Set(v).size===v.length,"Choose each file once")
}).refine(v=>v.evidenceIds.length>0||!!v.period||!!v.questionnaireId,"Choose evidence or define an audit period before creating an empty draft");
export const roomActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("PUBLISH"),version:z.number().int().positive(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),acknowledgeDisclosure:z.literal(true)}),
 z.object({action:z.literal("CLOSE"),version:z.number().int().positive()}),
 z.object({action:z.literal("INVITE"),version:z.number().int().positive(),email:z.email().trim().toLowerCase().max(254)}),
 z.object({action:z.literal("REVOKE"),grantId:z.uuid(),version:z.number().int().positive()}),
 z.object({action:z.literal("ANSWER"),questionId:z.uuid(),version:z.number().int().positive(),response:z.string().trim().min(10).max(4000)})
]);
export const guestActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("ACCEPT"),version:z.number().int().positive()}),
 z.object({action:z.literal("DECLINE"),version:z.number().int().positive()}),
 z.object({action:z.literal("QUESTION"),question:z.string().trim().min(10).max(2000),evidenceId:z.uuid().optional()}),
 z.object({action:z.literal("RESOLVE"),questionId:z.uuid(),version:z.number().int().positive()}),
 z.object({action:z.literal("REOPEN"),questionId:z.uuid(),version:z.number().int().positive()})
]);
export const samplingSummarySchema=z.object({method:z.literal("DETERMINISTIC_HASH"),seed:z.string().min(4).max(80),populationCount:z.number().int().nonnegative(),populationHash:z.string().length(64),sampleCount:z.number().int().nonnegative(),limitation:z.string()});
export const samplingPlanSchema=samplingSummarySchema.extend({sampleIds:z.array(z.uuid()).max(5)});
export const manifestSchema=z.object({
 version:z.literal(1),assurance:z.object({questionnaireId:z.uuid(),questionnaireVersion:z.number().int(),approvedHash:z.string(),title:z.string(),scope:z.string(),questions:z.array(z.object({reference:z.string(),question:z.string(),answer:z.string(),evidence:z.array(z.object({filename:z.string(),sha256:z.string()}))})).max(100)}).optional(),period:auditPeriodSchema.optional(),requests:z.array(z.object({id:z.uuid(),title:z.string().max(160),controlTitle:z.string().max(160),controlVersion:z.number().int().positive(),sampling:samplingSummarySchema.optional(),coverage:auditPeriodSchema,fileIds:z.array(z.uuid()).min(1).max(10),acceptedAt:z.iso.datetime()})).max(50).optional(),capturedAt:z.iso.datetime(),files:z.array(z.object({
  id:z.uuid(),obligationId:z.uuid(),taskTitle:z.string(),filename:z.string(),contentType:z.string(),sizeBytes:z.number().int().positive(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),reviewVersion:z.number().int().positive(),reviewedAt:z.iso.datetime()
 })).max(AUDIT_LIMITS.evidence)
});
export type AuditManifest=z.infer<typeof manifestSchema>;
export function evidenceStillShareable(file:AuditManifest["files"][number],current:{organizationId:string;obligationId:string;sha256:string;reviewVersion:number;reviewStatus:string;scanStatus:string;sizeBytes:number;contentType:string;uploadedById:string|null;reviewerId:string|null}|null|undefined,orgId:string){
 return !!current&&current.organizationId===orgId&&current.obligationId===file.obligationId&&current.sha256===file.sha256&&current.reviewVersion===file.reviewVersion&&current.reviewStatus==="APPROVED"&&current.scanStatus==="CLEAN"&&current.sizeBytes===file.sizeBytes&&current.contentType===file.contentType&&!!current.uploadedById&&!!current.reviewerId&&current.uploadedById!==current.reviewerId;
}

export const responseHistorySchema=z.array(z.object({response:z.string().max(4000),answeredAt:z.iso.datetime(),version:z.number().int().positive()})).max(20);
