import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {changeResponseDetail,closeChangeResponse} from "../../../../../lib/server/change-response-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
type Params={params:Promise<{id:string}>};
export async function GET(r:Request,p:Params){try{const ctx=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await changeResponseDetail(ctx,validId((await p.params).id)));}catch(e){return fail(e);}}
export async function PATCH(r:Request,p:Params){try{const ctx=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return reply(await closeChangeResponse(ctx,validId((await p.params).id),await readBody(r,4000)));}catch(e){return fail(e);}}
