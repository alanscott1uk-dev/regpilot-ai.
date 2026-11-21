import {acceptProgramme,redactProgramme} from "../../../../../lib/server/programme-service";
import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";export const maxDuration=60;
export async function PATCH(request:Request,args:{params:Promise<{id:string}>}){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true),id=validId((await args.params).id);if(body.decision!=="ACCEPTED"&&body.decision!=="REDACTED")return reply({error:"Choose an explicit import decision"},400);return reply(body.decision==="REDACTED"?await redactProgramme(ctx,id,Number(body.version)):await acceptProgramme(ctx,id,body));}catch(e){return fail(e);}}
