import {z} from 'zod';
import {trainingCriteriaSchema,trainingQuizSchema} from './training';

export const POLICY_EFFECTIVITY_LIMITS={active:100,requirements:10,assignments:100,readers:100,challengeMinutes:15,scheduledDays:180} as const;
export const DOCUMENT_ATTESTATION_MEANING='AUTHORISE_SCHEDULED_RELEASE' as const;
export const DOCUMENT_ATTESTATION_TEXT='I authorise this exact procedure revision and release plan to become effective at or after the stated time only when every recorded readiness gate passes.';
export const POLICY_EFFECTIVITY_SCOPE='Recorded document authorisation with fresh email authentication and explicit effectivity gates. Regulated electronic-signature qualification and validated deployment require separate organisational assessment; this record does not establish either.';
const unique=(values:string[])=>new Set(values).size===values.length;
export const plannedTrainingInput=z.object({requirementId:z.uuid(),baseVersion:z.number().int().positive(),objective:z.string().trim().min(30).max(1600),criteria:trainingCriteriaSchema,quiz:trainingQuizSchema,passPercent:z.number().int().min(50).max(100),dueDays:z.number().int().min(1).max(90),validDays:z.number().int().min(1).max(730)}).strict();
export const preparePolicyReleaseSchema=z.object({requestKey:z.uuid(),policyId:z.uuid(),revisionId:z.uuid(),policyVersion:z.number().int().positive(),revisionVersion:z.number().int().positive(),plannedEffectiveAt:z.iso.datetime(),trainingMode:z.enum(['NONE','READ_AND_ACKNOWLEDGE','COMPETENCE']),changeReason:z.string().trim().min(40).max(1600),readerIds:z.array(z.uuid()).min(1).max(POLICY_EFFECTIVITY_LIMITS.readers).refine(unique),training:z.array(plannedTrainingInput).max(POLICY_EFFECTIVITY_LIMITS.requirements).refine(rows=>unique(rows.map(row=>row.requirementId))),confirm:z.literal(true)}).strict();
export const signatureChallengeSchema=z.object({requestKey:z.uuid(),version:z.number().int().positive(),meaning:z.literal(DOCUMENT_ATTESTATION_MEANING),reason:z.string().trim().min(40).max(1600),confirm:z.literal(true)}).strict();
export const signPolicyReleaseSchema=z.object({requestKey:z.uuid(),version:z.number().int().positive(),challengeId:z.uuid(),targetHash:z.string().regex(/^[a-f0-9]{64}$/),meaning:z.literal(DOCUMENT_ATTESTATION_MEANING),confirm:z.literal(true)}).strict();
export const checkPolicyReleaseSchema=z.object({requestKey:z.uuid(),version:z.number().int().positive(),confirm:z.literal(true)}).strict();
export const cancelPolicyReleaseSchema=z.object({requestKey:z.uuid(),version:z.number().int().positive(),reason:z.string().trim().min(40).max(1600),confirm:z.literal(true)}).strict();
export const policyEffectivityQuerySchema=z.object({policyId:z.uuid().optional(),releaseId:z.uuid().optional(),challengeId:z.uuid().optional(),requestKey:z.uuid().optional(),page:z.coerce.number().int().min(1).max(1000).default(1)}).strict();
export type PlannedTrainingInput=z.infer<typeof plannedTrainingInput>;
export type PreparePolicyRelease=z.infer<typeof preparePolicyReleaseSchema>;

export const releaseTrainingPlanSchema=plannedTrainingInput.extend({curriculumId:z.uuid(),curriculumTitle:z.string().max(160),ownerId:z.uuid(),baseHash:z.string().regex(/^[a-f0-9]{64}$/),snapshot:z.unknown(),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),enrolments:z.array(z.object({id:z.uuid(),userId:z.uuid(),version:z.number().int().positive()}).strict()).max(100)}).strict();
export const policyReleasePlanSchema=z.object({format:z.literal('regpilot-policy-release-v1'),policyId:z.uuid(),policyTitle:z.string().max(160),previousRevision:z.number().int().nonnegative(),revisionId:z.uuid(),revisionNumber:z.number().int().positive(),revisionSummary:z.string().max(1200),fileHash:z.string().regex(/^[a-f0-9]{64}$/),contentSha256:z.string().regex(/^[a-f0-9]{64}$/),plannedEffectiveAt:z.iso.datetime(),trainingMode:z.enum(['NONE','READ_AND_ACKNOWLEDGE','COMPETENCE']),changeReason:z.string().max(1600),readerIds:z.array(z.uuid()).min(1).max(100).refine(unique),training:z.array(releaseTrainingPlanSchema).max(10)}).strict();
export type PolicyReleasePlan=z.infer<typeof policyReleasePlanSchema>;
