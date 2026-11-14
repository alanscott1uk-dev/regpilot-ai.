import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
import {accessWorkspace,createAccessCampaign} from "../../../../lib/server/access-review-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(r:Request){try{return reply(await accessWorkspace(await context(r,new URL(r.url).searchParams.get("organizationId"))));}catch(e){return fail(e);}}
export async function POST(r:Request){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return reply(await createAccessCampaign(c,await readBody(r,220000)),201);}catch(e){return fail(e);}}
