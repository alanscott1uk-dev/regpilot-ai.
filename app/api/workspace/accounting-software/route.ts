import {checkSupplierLedger} from "../../../../lib/server/accounting-supplier";
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
    const ctx=await context(request,organizationId,true);
    if(input.action==="SUPPLIER"){
      const {action,...check}=input;
      return reply({type:"supplier",organizationId:ctx.organizationId,receipt:await checkSupplierLedger(ctx,check)});
    }
    return reply(await accountingAction(ctx,input));
  } catch(e) {return fail(e);}
}
