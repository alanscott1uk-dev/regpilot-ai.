import {vendorDetail,changeVendor} from "../../../../../lib/server/vendor-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
type Route={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Route){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true),id=validId((await params).id);return reply(await vendorDetail(ctx,id));}catch(e){return fail(e);}}
export async function PATCH(request:Request,{params}:Route){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true),id=validId((await params).id);return reply(await changeVendor(ctx,id,await readBody(request,6000)));}catch(e){return fail(e);}}
