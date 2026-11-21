import {context,readBody,fail,reply} from "../../../../lib/server/operations-http";
import {createRecognitionAction,recognitionWorkspace} from "../../../../lib/server/recognition-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 try{const org=new URL(request.url).searchParams.get("organizationId");return reply(await recognitionWorkspace(await context(request,org)));}
 catch(e){return fail(e);}
}
export async function POST(request:Request){
 try{
  const data=await readBody(request);
  const ctx=await context(request,data.organizationId,true);
  return reply(await createRecognitionAction(ctx,String(data.trackId||"")),201);
 }catch(e){return fail(e);}
}
