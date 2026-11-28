import {NextResponse} from 'next/server';
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from '../../../../lib/server/ai-auth';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {changeFrameworkAudit,frameworkWorkspace,frameworkCsv} from '../../../../lib/server/framework-audits';
import {readStarterProgrammeJson,StarterProgrammeInputError} from '../../../../lib/starter-programmes.mjs';
import {workUuid} from '../../../../lib/work-hub.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
function failure(e:unknown){
  if(e instanceof IntelligenceError||e instanceof AccessError||e instanceof StarterProgrammeInputError)return reply({error:e.message},e.status);
  if(e instanceof SyntaxError)return reply({error:'Invalid request body.'},400);
  return reply({error:'Framework audits are temporarily unavailable.'},503);
}
export async function GET(request:Request){
  if(!workspaceConfigured())return reply({error:'Private workspace not configured.'},503);
  try{
    const p=new URL(request.url).searchParams,org=p.get('organizationId'),framework=p.get('framework')??'',rawPage=p.get('page')??'1',format=p.get('format');
    if(!workUuid(org)||[...p.keys()].some(k=>!['organizationId','framework','q','page','format'].includes(k)||p.getAll(k).length!==1)||
      (format!==null&&format!=='csv')||(format==='csv'&&!framework)||!/^\d{1,6}$/.test(rawPage)||Number(rawPage)<1||framework.length>140||(p.get('q')??'').length>150)return reply({error:'Invalid framework audit request.'},400);
    const ctx=await authorisedWorkspaceContext(request,org,format==='csv'?['OWNER','ADMIN']:['OWNER','ADMIN','EDITOR','VIEWER']);
    const result=await frameworkWorkspace(ctx,framework,p.get('q')??'',Number(rawPage),format==='csv');
    return format==='csv'?new Response(frameworkCsv(result),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="regpilot-framework-audit.csv"'}}):reply(result);
  }catch(e){return failure(e);}
}
export async function POST(request:Request){
  if(!workspaceConfigured())return reply({error:'Private workspace not configured.'},503);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'JSON required.'},415);
  try{
    const body=await readStarterProgrammeJson(request) as Record<string,unknown>;
    if(!body||typeof body!=='object'||Array.isArray(body)||!workUuid(body.organizationId))return reply({error:'Choose an organisation.'},400);
    const {organizationId,...input}=body,ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN']);
    return reply(await changeFrameworkAudit(ctx,input));
  }catch(e){return failure(e);}
}
