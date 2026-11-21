import {billingPortal} from "../../../../lib/server/billing-service";
import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function POST(request:Request){try{const b=await readBody(request);return reply(await billingPortal(await context(request,b.organizationId,true)));}catch(e){return fail(e);}}
