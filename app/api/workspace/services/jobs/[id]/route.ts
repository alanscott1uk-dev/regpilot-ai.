import {queueServiceJob,redactServiceJob} from "../../../../../../lib/server/paid-service";
import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const b=await readBody(request),ctx=await context(request,b.organizationId,true),id=validId((await params).id);return reply(b.action==="REDACT"?await redactServiceJob(ctx,id,b.version as number):b.action==="QUEUE"?await queueServiceJob(ctx,id,b.version as number,b.consent===true):{error:"Unknown action"},b.action==="QUEUE"||b.action==="REDACT"?200:400);}catch(e){return fail(e);}}
