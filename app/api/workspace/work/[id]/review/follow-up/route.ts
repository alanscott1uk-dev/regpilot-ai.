import {workspaceConfigured,authorisedWorkspaceContext} from '../../../../../../../lib/server/ai-auth';
import {createWorkReviewFollowUp} from '../../../../../../../lib/server/work-review-service';
import {reviewReply,reviewFailure} from '../../../../../../../lib/server/work-review-http';
import {workUuid,readWorkJson} from '../../../../../../../lib/work-hub.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request,route:{params:Promise<{id:string}>}){
 if(!workspaceConfigured())return reviewReply({error:'Private workspace not configured'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reviewReply({error:'JSON required'},415);
 try{
  const body=await readWorkJson(request) as Record<string,unknown>,{id}=await route.params;
  if(!body||typeof body!=='object'||Array.isArray(body)||!workUuid(body.organizationId)||!workUuid(id))return reviewReply({error:'Choose a valid organisation and task'},400);
  const {organizationId,...input}=body,ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN']);
  return reviewReply(await createWorkReviewFollowUp(ctx,id,input));
 }catch(error){return reviewFailure(error);}
}
