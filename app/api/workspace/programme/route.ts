import {prepareProgramme} from "../../../../lib/server/programme-service";
import {context,reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";export const maxDuration=120;
export async function POST(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId);return reply(await prepareProgramme(ctx,body),201);}catch(e){return fail(e);}}
