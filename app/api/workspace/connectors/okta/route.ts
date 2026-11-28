import {context,fail,reply,readBody} from "../../../../../lib/server/operations-http";
import {oktaEnabled} from "../../../../../lib/server/connector-flags";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {nangoConfig,oktaConnections,oktaConnectSession,findOktaGroups} from "../../../../../lib/connectors/nango-okta";

export const runtime="nodejs";
function config(){
  if (!oktaEnabled()) throw new IntelligenceError("Okta collection awaits activation",503);
  return nangoConfig();
}
export async function GET(request:Request){
  try {
    const params=new URL(request.url).searchParams,ctx=await context(request,params.get("organizationId"),true);
    const connectionId=params.get("connectionId"),query=params.get("query");
    if(connectionId!==null || query!==null)
      return reply({groups:await findOktaGroups(ctx.organizationId,connectionId||"",query||"",config())});
    return reply({connections:await oktaConnections(ctx.organizationId,config())});
  } catch(error){return fail(error);}
}
export async function POST(request:Request){
  try {
    const body=await readBody(request),ctx=await context(request,body.organizationId,true);
    return reply(await oktaConnectSession(ctx.organizationId,ctx.userId,config()),201);
  } catch(error){return fail(error);}
}
