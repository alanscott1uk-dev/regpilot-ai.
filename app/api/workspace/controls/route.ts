import {mapControl} from "../../../../lib/server/control-service";
import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function POST(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await mapControl(ctx,body));}catch(e){return fail(e);}}
