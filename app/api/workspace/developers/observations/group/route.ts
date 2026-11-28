import {context,reply,fail,readBody} from '../../../../../../lib/server/operations-http';
import {groupObservationFollowUps} from '../../../../../../lib/server/customer-api-service';

export const runtime='nodejs',dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);
  return reply(await groupObservationFollowUps(ctx,await readBody(request,12288)));
 }catch(error){return fail(error);}
}
