import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {manageAuditRoom,changeAuditRoom} from "../../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await manageAuditRoom(ctx,validId((await params).id)));}catch(e){return fail(e);}}
export async function PATCH(request:Request,{params}:Params){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await changeAuditRoom(ctx,validId((await params).id),await readBody(request,6000)));}catch(e){return fail(e);}}
