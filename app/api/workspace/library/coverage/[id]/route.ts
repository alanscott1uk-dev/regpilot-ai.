import {coverageDetail,reviewCoverage,redactCoverage} from "../../../../../../lib/server/coverage-service";
import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
import {z} from "zod";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"));return reply(await coverageDetail(ctx,validId((await params).id)));}catch(e){return fail(e);}}
export async function PATCH(request:Request,{params}:Params){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await reviewCoverage(ctx,validId((await params).id),body));}catch(e){return fail(e);}}
export async function DELETE(request:Request,{params}:Params){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await redactCoverage(ctx,validId((await params).id),z.number().int().positive().parse(body.version)));}catch(e){return fail(e);}}
