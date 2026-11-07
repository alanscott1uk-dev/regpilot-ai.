import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportAccessCampaign} from "../../../../../../lib/server/access-review-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(r:Request,p:{params:Promise<{id:string}>}){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true),value=await exportAccessCampaign(c,validId((await p.params).id));return reply(value);}catch(e){return fail(e);}}
