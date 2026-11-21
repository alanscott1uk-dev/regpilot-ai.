import {context,reply,fail} from "../../../../lib/server/operations-http";
import {knowledgeWorkspace} from "../../../../lib/server/company-knowledge-service";
export const runtime="nodejs",dynamic="force-dynamic";
export async function GET(request:Request){try{const params=new URL(request.url).searchParams;return reply(await knowledgeWorkspace(await context(request,params.get("organizationId"))));}catch(error){return fail(error);}}
