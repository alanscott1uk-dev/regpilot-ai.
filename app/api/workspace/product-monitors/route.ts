import {context,reply,fail,readBody} from '../../../../lib/server/operations-http';
import {productMonitorCommand} from '../../../../lib/server/product-monitor-service';
import {CollectionError} from '../../../../lib/connectors/collection-error';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const {organizationId,...command}=await readBody(request);
  const ctx=await context(request,organizationId,true);
  return reply(await productMonitorCommand(ctx,command));
 }catch(e){
  if(e instanceof CollectionError)return reply({error:'Product read could not complete',code:e.code,step:e.step??null},e.code==='RATE_LIMITED'?429:409);
  return fail(e);
 }
}
