import {context,fail,reply,validId} from '../../../../../lib/server/operations-http';
import {programmeCrosswalk} from '../../../../../lib/server/programme-reference-review';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams,c=await context(request,params.get('organizationId'),true);
  return reply(await programmeCrosswalk(c,validId(params.get('annexId')),validId(params.get('combinedId'))));
 }catch(error){return fail(error);}
}
