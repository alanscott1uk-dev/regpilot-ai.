import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {reviewEvaluationAnswer,evaluationAnswerPreview,evaluationAnswerReview} from "../../../../../lib/server/evaluation-service";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=120;
export async function POST(request:Request){try{const p=new URL(request.url).searchParams;return reply(await reviewEvaluationAnswer(await context(request,p.get("organizationId"),true),await readBody(request,12000)));}catch(e){return fail(e);}}
export async function GET(request:Request){try{const p=new URL(request.url).searchParams,c=await context(request,p.get("organizationId"),true);return reply(p.has("reviewId")?await evaluationAnswerReview(c,validId(p.get("reviewId"))):await evaluationAnswerPreview(c,validId(p.get("caseId")),validId(p.get("draftRunId"))));}catch(e){return fail(e);}}
