import {coverageImpact} from "../../../../../lib/server/coverage-service";
import {context,reply,fail,readBody} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{return reply(await coverageImpact(await context(request,new URL(request.url).searchParams.get("organizationId"))));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await coverageImpact(ctx,true));}catch(e){return fail(e);}}
