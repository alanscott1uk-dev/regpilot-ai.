import {saveLibraryFacts} from "../../../../../lib/server/library-service";
import {context,reply,fail,readBody} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";
export async function PUT(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await saveLibraryFacts(ctx,body));}catch(e){return fail(e);}}
