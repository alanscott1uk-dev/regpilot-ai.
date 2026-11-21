import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {accessCampaignDetail,changeAccessCampaign} from "../../../../../lib/server/access-review-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
type Params={params:Promise<{id:string}>};
export async function GET(r:Request,p:Params){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await accessCampaignDetail(c,validId((await p.params).id)));}catch(e){return fail(e);}}
export async function PATCH(r:Request,p:Params){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await changeAccessCampaign(c,validId((await p.params).id),await readBody(r,16000)));}catch(e){return fail(e);}}
