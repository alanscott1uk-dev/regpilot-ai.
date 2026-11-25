import {context,fail,reply,validId} from '../../../../../../lib/server/operations-http';
import {siteQualification} from '../../../../../../lib/server/site-qualification-service';
import {softwareValidation} from '../../../../../../lib/server/software-validation';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);
  const packet=await siteQualification(ctx,validId((await params).id));
  return reply(await softwareValidation(packet.protocol.release));
 }catch(error){return fail(error);}
}
