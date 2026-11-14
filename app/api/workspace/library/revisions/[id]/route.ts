import {reviewRevision,decideApplicability,redactRevision} from "../../../../../../lib/server/library-service";
import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
import {z} from "zod";
export const runtime="nodejs";export const maxDuration=120;
type Params={params:Promise<{id:string}>};
export async function PATCH(request:Request,{params}:Params){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true),id=validId((await params).id);return reply(await (body.action==="APPLICABILITY"?decideApplicability(ctx,id,body):reviewRevision(ctx,id,body)));}catch(e){return fail(e);}}
export async function DELETE(request:Request,{params}:Params){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await redactRevision(ctx,validId((await params).id),z.number().int().positive().parse(body.version)));}catch(e){return fail(e);}}
