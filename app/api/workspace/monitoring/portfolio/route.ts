import {configureWatchPortfolio} from "../../../../../lib/server/watch-portfolio";
import {context,readBody,reply,fail} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=30;
// No unauthenticated bulk creation, arbitrary URLs, or automatic applicability decisions.
export async function POST(request:Request){
 try{
  const body=await readBody(request);
  const ctx=await context(request,body.organizationId,true);
  return reply(await configureWatchPortfolio(ctx,{sourceIds:body.sourceIds,enabled:body.enabled,intervalHours:body.intervalHours}));
 }catch(e){return fail(e);}
}
