import {verificationReceipt} from '../../../../../../lib/server/connector-verification';
import {context,reply,fail,validId} from '../../../../../../lib/server/operations-http';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'));
  const response=reply(await verificationReceipt(ctx,validId((await params).id)));
  response.headers.set('Content-Disposition','attachment; filename="regpilot-connection-verification.json"');
  return response;
 }catch(error){return fail(error);}
}
