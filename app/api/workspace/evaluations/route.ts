import {context,reply,fail} from "../../../../lib/server/operations-http";
import {evaluationWorkspace} from "../../../../lib/server/evaluation-service";
export const runtime="nodejs",dynamic="force-dynamic";
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;return reply(await evaluationWorkspace(await context(request,p.get("organizationId"))));}catch(e){return fail(e);}}
