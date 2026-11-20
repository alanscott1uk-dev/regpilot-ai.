import {z} from 'zod';
export const EVALUATION_ENGINE='reviewed-evaluation-1.0.0';
export const EVALUATION_LIMITS={activeCases:50,caseHistory:100,runHistory:100,dailyRuns:40,attempts:2,processingMs:120000} as const;
export const evaluationCaseSpec=z.object({title:z.string().trim().min(5).max(160),query:z.string().trim().min(3).max(1200),productId:z.uuid().nullable().default(null),expectedEvidenceIds:z.array(z.uuid()).max(10).refine(ids=>new Set(ids).size===ids.length,'Choose each source once'),expectNoSupport:z.boolean(),guidance:z.string().trim().min(30).max(3000),category:z.enum(['NORMAL','NO_SUPPORT','PRODUCT_BOUNDARY','ADVERSARIAL','REGRESSION'])}).strict().refine(spec=>spec.expectNoSupport?spec.expectedEvidenceIds.length===0:spec.expectedEvidenceIds.length>0,'Specify relevant evidence or an expected no-support outcome');
export const createEvaluationCaseInput=z.object({specification:evaluationCaseSpec,requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export const decideEvaluationCaseInput=z.object({action:z.enum(['APPROVE','REJECT','RETIRE']),version:z.number().int().positive(),notes:z.string().trim().min(20).max(2000),requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export const runEvaluationInput=z.object({caseId:z.uuid(),method:z.enum(['CONTENT','SEMANTIC']),requestKey:z.uuid(),retryOfId:z.uuid().optional(),confirm:z.literal(true)}).strict();
export const answerRubric=z.object({correctness:z.enum(['PASS','PARTIAL','FAIL']),completeness:z.enum(['PASS','PARTIAL','FAIL']),grounding:z.enum(['PASS','PARTIAL','FAIL']),abstention:z.enum(['PASS','PARTIAL','FAIL'])}).strict();
export const reviewEvaluationAnswerInput=z.object({caseId:z.uuid(),draftRunId:z.uuid(),rubric:answerRubric,rationale:z.string().trim().min(30).max(3000),requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export type EvaluationSpec=z.infer<typeof evaluationCaseSpec>;
/** Document-level metrics: deduplicate chunks, preserve rank, never label lexical scores as accuracy. */
export function retrievalMetrics(expectedIds:string[],returnedIds:string[],expectNoSupport:boolean){
 const expected=[...new Set(expectedIds)],retrieved=[...new Set(returnedIds)].slice(0,10),relevant=retrieved.filter(id=>expected.includes(id)),first=retrieved.findIndex(id=>expected.includes(id));
 if(expectNoSupport&&expected.length||!expectNoSupport&&!expected.length)throw Error('Invalid reference outcome');
 return {retrievedDocumentIds:retrieved,relevantReturned:relevant.length,expectedDocuments:expected.length,recallAt10:expectNoSupport?null:relevant.length/expected.length,precisionReturned:retrieved.length?relevant.length/retrieved.length:null,reciprocalRank:expectNoSupport?null:first<0?0:1/(first+1),noSupportCorrect:expectNoSupport?retrieved.length===0:null};
}
export const EVALUATION_RUBRIC={correctness:'Does the answer agree with the reviewed reference and original evidence?',completeness:'Does it address every material part of this question without omitting a required qualification?',grounding:'Does every material factual claim have a valid supporting citation?',abstention:'Does it acknowledge missing support and avoid answering beyond the evidence?'} as const;
