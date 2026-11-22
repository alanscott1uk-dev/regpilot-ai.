import {partnerRecordSchema,partnerOutcome} from './partner-records';
import {z} from 'zod';

export const CUSTOMER_API_VERSION='2026-11-20';
export const CUSTOMER_API_SCOPES=['controls:read','tasks:read','regulatory:read','evidence:read','observations:read','observations:write'] as const;
export type CustomerApiScope=typeof CUSTOMER_API_SCOPES[number];
export const CUSTOMER_API_LIMITS={activeCredentials:20,controls:50,page:100,defaultPage:25,requestsPerKeyMinute:60,requestsPerCompanyMinute:300,credentialDays:90,observationDays:7,checks:20,pendingObservations:500,dailyObservations:200,bodyBytes:32768,cursorMinutes:60} as const;
const scopes=z.array(z.enum(CUSTOMER_API_SCOPES)).min(1).max(CUSTOMER_API_SCOPES.length).refine(values=>new Set(values).size===values.length);
export const createCustomerCredentialInput=z.object({name:z.string().trim().min(3).max(100),scopes,controlIds:z.array(z.uuid()).max(CUSTOMER_API_LIMITS.controls).refine(values=>new Set(values).size===values.length),expiresAt:z.iso.datetime(),requestKey:z.uuid(),confirm:z.literal(true)}).strict().superRefine((value,context)=>{if(value.scopes.some(scope=>scope!=='regulatory:read')&&!value.controlIds.length)context.addIssue({code:'custom',path:['controlIds'],message:'Select the controls this credential may access'});});
export const changeCustomerCredentialInput=z.object({action:z.enum(['ROTATE','REVOKE']),version:z.number().int().positive(),requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export const customerObservationInput=z.object({partnerRecord:partnerRecordSchema.optional(),controlId:z.uuid(),externalId:z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),observedAt:z.iso.datetime(),validUntil:z.iso.datetime(),summary:z.string().trim().min(20).max(1200),checks:z.array(z.object({key:z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),label:z.string().trim().min(3).max(160),status:z.enum(['PASS','FAIL','UNKNOWN']),observed:z.string().trim().max(400),detail:z.string().trim().max(600).default('')}).strict()).min(1).max(CUSTOMER_API_LIMITS.checks).refine(values=>new Set(values.map(value=>value.key)).size===values.length) }).strict().superRefine((v,ctx)=>{
 const specialist=v.partnerRecord?.record;
 if(specialist?.kind==='EPCIS_TRANSFER'&&[specialist.shipping,specialist.receiving].some(doc=>Date.parse(doc.creationDate)>Date.parse(v.observedAt)))ctx.addIssue({code:'custom',message:'The comparison observation must follow creation of both EPCIS documents'});
 if(specialist?.kind==='LOGGER_WINDOW'&&Date.parse(specialist.windowEnd)!==Date.parse(v.observedAt))ctx.addIssue({code:'custom',message:'Set observedAt to the end of the logger window'});
 if(specialist?.kind==='SPECIALIST_ATTESTATION'&&(v.summary!=='Specialist decision supplied by the authorised source.'||v.checks.length!==1||v.checks[0].key!=='specialist-decision'||v.checks[0].label!=='Specialist decision'||v.checks[0].observed!==specialist.decision||v.checks[0].detail!==''||v.partnerRecord?.sourceUrl)){
  ctx.addIssue({code:'custom',message:'For a specialist record use the fixed summary and decision check. Keep case notes and case links in the specialist system.'});
 }
});
export type CustomerObservationInput=z.infer<typeof customerObservationInput>;
export const reviewCustomerObservationInput=z.object({decision:z.enum(['ACKNOWLEDGE','FOLLOW_UP','REJECT']),version:z.number().int().positive(),notes:z.string().trim().min(20).max(1600),ownerId:z.uuid().optional(),dueDate:z.iso.date().optional(),requestKey:z.uuid(),confirm:z.literal(true)}).strict().superRefine((value,context)=>{if(value.decision==='FOLLOW_UP'&&(!value.ownerId||!value.dueDate))context.addIssue({code:'custom',message:'Choose an owner and due date for the follow-up'});if(value.decision!=='FOLLOW_UP'&&(value.ownerId||value.dueDate))context.addIssue({code:'custom',message:'An owner and date apply only to a follow-up task'});});
export const groupFollowUpInput=z.object({
 records:z.array(z.object({id:z.uuid(),version:z.number().int().positive(),receiptHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict())
  .min(2).max(20).refine(records=>new Set(records.map(row=>row.id)).size===records.length),
 ownerId:z.uuid(),dueDate:z.iso.date(),notes:z.string().trim().min(20).max(1600),requestKey:z.uuid(),confirm:z.literal(true)
}).strict();
export function reportedObservationOutcome(input:CustomerObservationInput){const outcomes=input.checks.map(check=>check.status);if(input.partnerRecord)outcomes.push(partnerOutcome(input.partnerRecord,input.observedAt));return outcomes.includes('FAIL')?'REPORTED_FAILURE':outcomes.includes('UNKNOWN')?'REPORTED_UNKNOWN':'REPORTED_PASS';}
export const CUSTOMER_API_SCOPE_LABELS:Record<CustomerApiScope,string>={'controls:read':'Read granted controls','tasks:read':'Read tasks for granted controls','regulatory:read':'Read reviewed regulatory source metadata','evidence:read':'Read reviewed file metadata for granted controls','observations:read':'Read this client’s submitted observations','observations:write':'Submit observations for granted controls'};
