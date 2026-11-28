import {policyDetail,changePolicy} from "../../../../../lib/server/policy-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
type Route={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Route){try{const q=new URL(request.url).searchParams,ctx=await context(request,q.get("organizationId"),true),id=validId((await params).id);return reply(await policyDetail(ctx,id,q.has("revisionId")?validId(q.get("revisionId")):undefined));}catch(e){return fail(e);}}
export async function PATCH(request:Request,{params}:Route){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true),id=validId((await params).id);return reply(await changePolicy(ctx,id,await readBody(request,12000)));}catch(e){return fail(e);}}
