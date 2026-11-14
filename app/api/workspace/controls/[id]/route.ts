import {configureControl} from "../../../../../lib/server/control-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function PATCH(request:Request,args:{params:Promise<{id:string}>}){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await configureControl(ctx,validId((await args.params).id),body));}catch(e){return fail(e);}}
