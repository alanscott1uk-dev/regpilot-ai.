import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
import {changeResponseAction} from "../../../../../../lib/server/change-response-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function PATCH(r:Request,p:{params:Promise<{id:string}>}){try{const ctx=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await changeResponseAction(ctx,validId((await p.params).id),await readBody(r,10000)));}catch(e){return fail(e);}}
