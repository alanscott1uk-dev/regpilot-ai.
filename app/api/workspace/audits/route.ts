import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
import {auditWorkspace,createAuditRoom} from "../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{return reply(await auditWorkspace(await context(request,new URL(request.url).searchParams.get("organizationId"),true)));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await createAuditRoom(ctx,await readBody(request,12000)),201);}catch(e){return fail(e);}}
