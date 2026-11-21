import {workspaceConfigured,authorisedWorkspaceContext} from '../../../../../../lib/server/ai-auth';
import {workReviewDetail} from '../../../../../../lib/server/work-review-service';
import {reviewReply,reviewFailure} from '../../../../../../lib/server/work-review-http';
import {workUuid} from '../../../../../../lib/work-hub.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request,route:{params:Promise<{id:string}>}){
 if(!workspaceConfigured())return reviewReply({error:'Private workspace not configured'},503);
 try{
  const organizationId=new URL(request.url).searchParams.get('organizationId'),{id}=await route.params;
  if(!workUuid(organizationId)||!workUuid(id))return reviewReply({error:'Choose a valid organisation and task'},400);
  const ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN','EDITOR','VIEWER']);
  return reviewReply(await workReviewDetail(ctx,id));
 }catch(error){return reviewFailure(error);}
}
