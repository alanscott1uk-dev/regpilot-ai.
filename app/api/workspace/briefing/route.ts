import {context,reply,fail} from "../../../../lib/server/operations-http";
import {fetchOperationalBrief} from "../../../../lib/server/briefing-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=30;
export async function GET(request:Request){
 try{
  const org=new URL(request.url).searchParams.get("organizationId");
  const ctx=await context(request,org);
  return reply(await fetchOperationalBrief(ctx));
 }catch(error){return fail(error);}
}
