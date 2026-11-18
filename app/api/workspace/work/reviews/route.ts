import {workspaceConfigured,authorisedWorkspaceContext} from '../../../../../lib/server/ai-auth';
import {workReviewQueue} from '../../../../../lib/server/work-review-service';
import {reviewReply,reviewFailure} from '../../../../../lib/server/work-review-http';
import {workUuid} from '../../../../../lib/work-hub.mjs';
import {parseWorkReviewQuery} from '../../../../../lib/work-review.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){
 if(!workspaceConfigured())return reviewReply({error:'Private workspace not configured'},503);
 try{
  const params=new URL(request.url).searchParams,organizationId=params.get('organizationId');
  if(!workUuid(organizationId))return reviewReply({error:'Choose a valid organisation'},400);
  const ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN','EDITOR','VIEWER']);
  return reviewReply(await workReviewQueue(ctx,parseWorkReviewQuery(params)));
 }catch(error){return reviewFailure(error);}
}
