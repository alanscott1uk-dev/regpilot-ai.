import {context,fail,reply,validId} from '../../../../../../lib/server/operations-http';
import {siteQualification} from '../../../../../../lib/server/site-qualification-service';
import {validationChangeReview} from '../../../../../../lib/server/validation-change-review';
import {softwareValidation} from '../../../../../../lib/server/software-validation';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);
  const id=validId((await params).id),packet=await siteQualification(ctx,id);
  const baseline=new URL(request.url).searchParams.get('baseline');
  if(baseline===null)return reply(await softwareValidation(packet.protocol.release));
  const [validation,changes]=await Promise.all([softwareValidation(packet.protocol.release),validationChangeReview(baseline,packet.protocol.release)]);
  const dossier=await siteQualification(ctx,id);
  return reply({format:'regpilot-site-release-review-v1',dossier,validation,changes});
 }catch(error){return fail(error);}
}
