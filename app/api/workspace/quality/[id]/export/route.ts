import {qualityInspectionText} from '../../../../../../lib/quality-inspection';
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
  if(query.getAll('organizationId').length!==1||[...query.keys()].some(key=>!['organizationId','format'].includes(key)))throw new IntelligenceError('Choose one company');
  const format=query.get('format')??'json';
  if(query.getAll('format').length>1||!['json','text'].includes(format))throw new IntelligenceError('Choose JSON or text for the export');
  const id=validId((await params).id),ctx=await authorisedWorkspaceContext(request,validId(query.get('organizationId')));
  const record=await exportQualityCase(ctx,id);
  const readable=format==='text';
  return new Response(readable?qualityInspectionText(record):JSON.stringify(record,null,2),{headers:{'Content-Type':readable?'text/plain; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="regpilot-quality-${id}.${readable?'txt':'json'}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return fail(error);}
}
