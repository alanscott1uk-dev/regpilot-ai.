import {context,reply,fail,readBody} from '../../../../../lib/server/operations-http';
import {retryWatch} from '../../../../../lib/server/monitoring-recovery';
import {IntelligenceError} from '../../../../../lib/server/intelligence-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const body=await readBody(request,1024),ctx=await context(request,body.organizationId,true);
  if(Object.keys(body).some(key=>!['organizationId','sourceId','version'].includes(key))||typeof body.sourceId!=='string'||typeof body.version!=='number')throw new IntelligenceError('Choose a source and the current monitoring version');
  return reply(await retryWatch(ctx,{sourceId:body.sourceId,version:body.version}));
 }catch(error){return fail(error);}
}
