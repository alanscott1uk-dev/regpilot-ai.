import {saveConnector} from "../../../../lib/server/connector-service";
import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function POST(request:Request){try{const {organizationId,...settings}=await readBody(request),ctx=await context(request,organizationId,true);return reply(await saveConnector(ctx,settings));}catch(e){return fail(e);}}
