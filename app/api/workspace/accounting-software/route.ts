import {context,reply,readBody,fail} from "../../../../lib/server/operations-http";
import {accountingWorkspace,accountingAction} from "../../../../lib/server/accounting-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"));
    return reply(await accountingWorkspace(ctx));
  } catch(e) {return fail(e);}
}
export async function POST(request:Request) {
  try {
    const {organizationId,...input}=await readBody(request,2048);
    return reply(await accountingAction(await context(request,organizationId,true),input));
  } catch(e) {return fail(e);}
}
