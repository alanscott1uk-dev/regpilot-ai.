import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
import {changeAccessItem} from "../../../../../../lib/server/access-review-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function PATCH(r:Request,p:{params:Promise<{id:string}>}){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await changeAccessItem(c,validId((await p.params).id),await readBody(r,6000)));}catch(e){return fail(e);}}
