import {z} from 'zod';

const fields={requestKey:z.uuid(),version:z.number().int().positive(),assignmentId:z.uuid(),notes:z.string().trim().min(10).max(800)};
export const qualityTrainingInput=z.discriminatedUnion('purpose',[
 z.object({purpose:z.literal('ISSUE_RETRAINING'),incidentKey:z.uuid(),requestKey:fields.requestKey,version:fields.version,notes:fields.notes}).strict(),
 z.object({...fields,purpose:z.literal('INCIDENT'),asOf:z.iso.datetime()}).strict(),
 z.object({...fields,purpose:z.literal('RETRAINING'),incidentKey:z.uuid()}).strict()
]);
export const trainingFindingSchema=z.object({
 issuedFromCase:z.boolean().optional(),purpose:z.enum(['INCIDENT','RETRAINING']),incidentKey:z.uuid().nullable(),asOf:z.iso.datetime(),notes:z.string(),
 assignmentId:z.uuid(),learnerId:z.uuid(),learner:z.string(),policyId:z.uuid(),procedure:z.string(),
 revisionId:z.uuid(),revision:z.number(),publishedRevision:z.number().nullable(),procedureSha256:z.string(),
 assignedAt:z.iso.datetime(),acknowledgedAt:z.iso.datetime().nullable(),outcome:z.enum(['NOT_YET_ASSIGNED','NO_DECISION','PASSED','EXPIRED','RETRAIN']),
 decisionAt:z.iso.datetime().nullable(),assessorId:z.uuid().nullable(),attemptId:z.uuid().nullable(),validUntil:z.string().nullable(),
 evidence:z.array(z.object({id:z.uuid(),filename:z.string(),sha256:z.string()}))
}).strict();
export type TrainingFinding=z.infer<typeof trainingFindingSchema>;
export type CaseTrainingRecord={key:string;cycle:number;recordedAt:string;recordedBy:string;finding:TrainingFinding};
export const trainingOutcome:Record<TrainingFinding['outcome'],string>={
 NOT_YET_ASSIGNED:'Assignment created later',NO_DECISION:'No assessed decision by this time',PASSED:'Recorded pass within its validity period',
 EXPIRED:'Recorded pass had expired',RETRAIN:'Assessor required further training'
};
