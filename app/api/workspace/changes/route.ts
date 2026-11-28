import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
import {changeWorkspace,createChangeResponse} from "../../../../lib/server/change-response-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(r:Request){try{return reply(await changeWorkspace(await context(r,new URL(r.url).searchParams.get("organizationId"))));}catch(e){return fail(e);}}
export async function POST(r:Request){try{const ctx=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return reply(await createChangeResponse(ctx,await readBody(r,4000)),201);}catch(e){return fail(e);}}
