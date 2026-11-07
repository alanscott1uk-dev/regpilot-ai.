import {disconnectConnector,requestConnectorRun} from "../../../../../lib/server/connector-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
export const runtime="nodejs";
export async function PATCH(request:Request,args:{params:Promise<{id:string}>}){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true),id=validId((await args.params).id);if(!Number.isInteger(body.version)||Number(body.version)<1)throw new IntelligenceError("Invalid version");if(body.action==="DISCONNECT")return reply(await disconnectConnector(ctx,id,Number(body.version)));if(body.action==="COLLECT")return reply(await requestConnectorRun(ctx,id,Number(body.version)));throw new IntelligenceError("Unknown connector action");}catch(e){return fail(e);}}
