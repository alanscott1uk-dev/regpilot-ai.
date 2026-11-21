import {context,validId,readBody,reply,fail} from "../../../../../../lib/server/operations-http";
import {inspectEvidence} from "../../../../../../lib/server/document-inspection";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const body=await readBody(request,1000),ctx=await context(request,body.organizationId);return reply(await inspectEvidence(ctx,validId((await params).id)));}
  catch(e){return fail(e);}
}
