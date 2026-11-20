import {context,reply,fail,readBody} from '../../../../../lib/server/operations-http';
import {researchWorkspaceQuestion} from '../../../../../lib/server/company-knowledge-service';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=60;
export async function POST(request:Request){
 try{
  const org=new URL(request.url).searchParams.get('organizationId');
  const user=await context(request,org,true);
  return reply(await researchWorkspaceQuestion(user,await readBody(request,8000)));
 }catch(error){return fail(error);}
}
