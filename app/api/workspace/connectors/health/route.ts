import {context,reply,fail} from "../../../../../lib/server/operations-http";
import {getConnectorHealth} from "../../../../../lib/server/connector-health-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"));
  return reply(await getConnectorHealth(ctx));
 }catch(e){return fail(e);}
}
