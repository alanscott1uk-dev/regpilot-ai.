import {acknowledgePolicy} from "../../../../../lib/server/policy-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId")),id=validId((await params).id);return reply(await acknowledgePolicy(ctx,id,await readBody(request)));}catch(e){return fail(e);}}
