import {configureConnectorWebhook} from '../../../../../../lib/server/connector-webhooks';
import {context,readBody,reply,fail,validId} from '../../../../../../lib/server/operations-http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  // Authenticate from URL scope before accepting a signing secret in the body.
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);
  const id=validId((await params).id),body=await readBody(request);
  return reply(await configureConnectorWebhook(ctx,id,body));
 }catch(error){return fail(error);}
}
