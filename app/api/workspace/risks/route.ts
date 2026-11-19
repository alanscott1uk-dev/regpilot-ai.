import {authorisedWorkspaceContext,workspaceConfigured} from '../../../../lib/server/ai-auth';
import {reply,readBody,fail,validId} from '../../../../lib/server/operations-http';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {createRisk,updateRisk,addRiskTreatment,prepareRiskReview,decideRiskReview,archiveRisk,riskWorkspace} from '../../../../lib/server/risk-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:Request){
 try{
  if(!workspaceConfigured())throw new IntelligenceError('Private workspace awaits activation',503);
  const params=new URL(request.url).searchParams;
  const keys=['organizationId','riskId','requestKey','q','status','page','taskQ','taskPage'];
  if(keys.some(key=>params.getAll(key).length>1))throw new IntelligenceError('Use one value for each risk register filter');
  const organizationId=validId(params.get('organizationId'));
  const ctx=await authorisedWorkspaceContext(request,organizationId);
  const query=Object.fromEntries([...params].filter(([key])=>keys.includes(key)&&key!=='organizationId'));
  return reply(await riskWorkspace(ctx,query));
 }catch(error){return fail(error);}
}

export async function POST(request:Request){
 try{
  if(!workspaceConfigured())throw new IntelligenceError('Private workspace awaits activation',503);
  const {organizationId,action,riskId,reviewId,...input}=await readBody(request,16384);
  if(!['CREATE','UPDATE','TREATMENT','PREPARE_REVIEW','DECIDE_REVIEW','ARCHIVE','REOPEN'].includes(String(action)))throw new IntelligenceError('Choose a supported risk action');
  const ctx=await authorisedWorkspaceContext(request,validId(organizationId),['DECIDE_REVIEW','ARCHIVE','REOPEN'].includes(String(action))?['OWNER','ADMIN']:['OWNER','ADMIN','EDITOR']);
  if(action==='CREATE')return reply(await createRisk(ctx,input),201);
  if(action==='DECIDE_REVIEW')return reply(await decideRiskReview(ctx,validId(reviewId),input));
  const id=validId(riskId);
  if(action==='UPDATE')return reply(await updateRisk(ctx,id,input));
  if(action==='TREATMENT')return reply(await addRiskTreatment(ctx,id,input));
  if(action==='PREPARE_REVIEW')return reply(await prepareRiskReview(ctx,id,input));
  return reply(await archiveRisk(ctx,id,input,action==='REOPEN'));
 }catch(error){return fail(error);}
}
