import {policyInbox} from "../../../../lib/server/policy-service";
import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
export async function GET(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"));return reply({assignments:await policyInbox(ctx)});}catch(e){return fail(e);}}
