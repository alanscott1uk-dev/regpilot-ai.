import {context,reply,fail,readBody} from '../../../../../lib/server/operations-http';
import {testConnectedControl} from '../../../../../lib/server/control-policy';
export const runtime='nodejs',dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);
  return reply(await testConnectedControl(ctx,await readBody(request)));
 }catch(error){return fail(error);}
}
