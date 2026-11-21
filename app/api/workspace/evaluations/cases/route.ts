import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {createEvaluationCase,decideEvaluationCase} from "../../../../../lib/server/evaluation-service";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=120;
export async function POST(request:Request){try{const p=new URL(request.url).searchParams;return reply(await createEvaluationCase(await context(request,p.get("organizationId")),await readBody(request,16000)));}catch(e){return fail(e);}}
export async function PATCH(request:Request){try{const p=new URL(request.url).searchParams;return reply(await decideEvaluationCase(await context(request,p.get("organizationId"),true),validId(p.get("caseId")),await readBody(request,8000)));}catch(e){return fail(e);}}
