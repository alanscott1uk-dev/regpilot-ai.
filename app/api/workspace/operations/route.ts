import {operationsWorkspace} from "../../../../lib/server/operations-service";
import {generateDueReviews} from "../../../../lib/server/control-service";
import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const params=new URL(request.url).searchParams;const ctx=await context(request,params.get("organizationId"));return reply(await operationsWorkspace(ctx,params.has("importId")?validId(params.get("importId")):undefined));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await generateDueReviews(ctx));}catch(e){return fail(e);}}
