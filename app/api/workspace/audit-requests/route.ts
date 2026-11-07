import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
import {auditRequestWorkspace,createAuditRequest} from "../../../../lib/server/audit-request-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const q=new URL(request.url).searchParams,ctx=await context(request,q.get("organizationId"));return reply({requests:await auditRequestWorkspace(ctx,q.has("roomId")?validId(q.get("roomId")):undefined)});}catch(e){return fail(e);}}
export async function POST(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await createAuditRequest(ctx,await readBody(request,6000)),201);}catch(e){return fail(e);}}
