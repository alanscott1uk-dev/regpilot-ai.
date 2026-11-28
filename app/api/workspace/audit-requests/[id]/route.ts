import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {changeAuditRequest} from "../../../../../lib/server/audit-request-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId")),id=validId((await params).id);return reply(await changeAuditRequest(ctx,id,await readBody(request,16000)));}catch(e){return fail(e);}}
