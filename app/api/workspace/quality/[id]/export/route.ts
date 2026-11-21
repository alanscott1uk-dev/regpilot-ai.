import {authorisedWorkspaceContext,workspaceConfigured} from '../../../../../../lib/server/ai-auth';
import {fail,validId} from '../../../../../../lib/server/operations-http';
import {IntelligenceError} from '../../../../../../lib/server/intelligence-service';
import {exportQualityCase} from '../../../../../../lib/server/capa-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  if(!workspaceConfigured())throw new IntelligenceError('Private workspace awaits activation',503);
  const query=new URL(request.url).searchParams;
  if(query.getAll('organizationId').length!==1||[...query.keys()].some(key=>key!=='organizationId'))throw new IntelligenceError('Choose one company');
  const id=validId((await params).id),ctx=await authorisedWorkspaceContext(request,validId(query.get('organizationId')));
  return new Response(JSON.stringify(await exportQualityCase(ctx,id),null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="regpilot-quality-${id}.json"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return fail(error);}
}
