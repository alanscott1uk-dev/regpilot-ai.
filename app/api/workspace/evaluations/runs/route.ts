import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {runEvaluation,evaluationRun} from "../../../../../lib/server/evaluation-service";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=120;
export async function POST(request:Request){try{const p=new URL(request.url).searchParams;return reply(await runEvaluation(await context(request,p.get("organizationId")),await readBody(request,8000)));}catch(e){return fail(e);}}
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;return reply(await evaluationRun(await context(request,p.get("organizationId")),{...(p.has("runId")?{runId:validId(p.get("runId"))}:{}),...(p.has("requestKey")?{requestKey:validId(p.get("requestKey"))}:{})}));}catch(e){return fail(e);}}
