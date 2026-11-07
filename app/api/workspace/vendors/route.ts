import {vendorWorkspace,createVendor} from "../../../../lib/server/vendor-service";
import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
export async function GET(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await vendorWorkspace(ctx));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await createVendor(ctx,await readBody(request)),201);}catch(e){return fail(e);}}
