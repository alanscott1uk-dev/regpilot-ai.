import {draftRequirements,importIntelligenceCandidates} from "../../../../../lib/server/library-service";
import {context,reply,fail,readBody} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";export const maxDuration=120;
export async function POST(request:Request){try{const body=await readBody(request,64*1024),ctx=await context(request,body.organizationId);return reply(await (body.runId?importIntelligenceCandidates(ctx,body):draftRequirements(ctx,body)),201);}catch(e){return fail(e);}}
