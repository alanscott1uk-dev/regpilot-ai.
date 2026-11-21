import {prepareVendorReview} from "../../../../../../lib/server/vendor-service";
import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true),id=validId((await params).id);return reply(await prepareVendorReview(ctx,id,await readBody(request,20000)),201);}catch(e){return fail(e);}}
