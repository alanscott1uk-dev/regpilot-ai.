import {receiveConnectorWebhook} from '../../../../../../lib/server/connector-webhooks';
import {WebhookError} from '../../../../../../lib/connectors/webhook-signature';
import {reply} from '../../../../../../lib/server/intelligence-http';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=15;
export async function POST(request:Request,{params}:{params:Promise<{provider:string;id:string}>}){
 try{
  const {provider,id}=await params;
  if(provider!=='github'&&provider!=='gitlab')return reply({error:'Webhook rejected'},404);
  const result=await receiveConnectorWebhook(request,provider==='github'?'GITHUB':'GITLAB',id);
  return reply(result,202);
 }catch(error){return reply({error:error instanceof WebhookError?error.message:'Webhook unavailable'},error instanceof WebhookError?error.status:503);}
}
