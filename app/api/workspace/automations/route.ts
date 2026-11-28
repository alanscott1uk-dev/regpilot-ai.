import {context,reply,fail,readBody,validId} from '../../../../lib/server/operations-http';
import {automationHealth,replayAutomationEvent} from '../../../../lib/server/automation-queue';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'));return reply(await automationHealth(ctx));}catch(error){return fail(error);}
}
export async function POST(request:Request){
 try{
  const body=await readBody(request,1024),ctx=await context(request,body.organizationId,true);
  return reply(await replayAutomationEvent(ctx,validId(body.id),body.version as number));
 }catch(error){return fail(error);}
}
