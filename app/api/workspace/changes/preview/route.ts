import {context,reply,fail,validId} from "../../../../../lib/server/operations-http";
import {previewChangeResponse} from "../../../../../lib/server/change-response-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(r:Request){try{const q=new URL(r.url).searchParams,ctx=await context(r,q.get("organizationId"),true);return reply(await previewChangeResponse(ctx,validId(q.get("snapshotId"))));}catch(e){return fail(e);}}
