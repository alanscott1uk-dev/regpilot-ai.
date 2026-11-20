import {authorisedWorkspaceContext,workspaceConfigured} from '../../../../lib/server/ai-auth';
import {reply,readBody,fail,validId} from '../../../../lib/server/operations-http';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {createQualityCase,investigateQualityCase,addQualityAction,prepareQualityEffectiveness,decideQualityEffectiveness,reopenQualityCase,qualityWorkspace} from '../../../../lib/server/capa-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 try{
  if(!workspaceConfigured())throw new IntelligenceError('Private workspace awaits activation',503);
  const params=new URL(request.url).searchParams,keys=['organizationId','caseId','requestKey','q','status','page','taskQ','taskPage'];
  if([...params.keys()].some(key=>!keys.includes(key)||params.getAll(key).length!==1))throw new IntelligenceError('Use one value for each supported quality queue filter');
  const ctx=await authorisedWorkspaceContext(request,validId(params.get('organizationId')));
  return reply(await qualityWorkspace(ctx,Object.fromEntries([...params.entries()].filter(([key])=>key!=='organizationId'))));
 }catch(error){return fail(error);}
}
export async function POST(request:Request){
 try{
  if(!workspaceConfigured())throw new IntelligenceError('Private workspace awaits activation',503);
  const {organizationId,action,caseId,reviewId,...input}=await readBody(request,16384);
  if(typeof action!=='string'||!['CREATE','INVESTIGATE','ADD_ACTION','PREPARE_EFFECTIVENESS','DECIDE_EFFECTIVENESS','REOPEN'].includes(action))throw new IntelligenceError('Choose a supported quality case action');
  const ctx=await authorisedWorkspaceContext(request,validId(organizationId),['DECIDE_EFFECTIVENESS','REOPEN'].includes(action)?['OWNER','ADMIN']:['OWNER','ADMIN','EDITOR']);
  if(action==='CREATE')return reply(await createQualityCase(ctx,input),201);
  if(action==='DECIDE_EFFECTIVENESS')return reply(await decideQualityEffectiveness(ctx,validId(reviewId),input));
  const id=validId(caseId);
  if(action==='INVESTIGATE')return reply(await investigateQualityCase(ctx,id,input));
  if(action==='ADD_ACTION')return reply(await addQualityAction(ctx,id,input));
  if(action==='PREPARE_EFFECTIVENESS')return reply(await prepareQualityEffectiveness(ctx,id,input));
  return reply(await reopenQualityCase(ctx,id,input));
 }catch(error){return fail(error);}
}
