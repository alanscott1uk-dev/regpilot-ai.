import {servicesWorkspace,prepareServiceJob} from "../../../../lib/server/paid-service";
import {setPaidBudget} from "../../../../lib/server/paid-budget";
import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";export const maxDuration=60;
export async function GET(request:Request){try{return reply(await servicesWorkspace(await context(request,new URL(request.url).searchParams.get("organizationId"),true)));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const b=await readBody(request),ctx=await context(request,b.organizationId,true);return reply(await prepareServiceJob(ctx,b));}catch(e){return fail(e);}}
export async function PATCH(request:Request){try{const b=await readBody(request),ctx=await context(request,b.organizationId,true);return reply(await setPaidBudget(ctx,b.limitMicros as number,b.version as number,typeof b.remindersEnabled==="boolean"?b.remindersEnabled:undefined));}catch(e){return fail(e);}}
