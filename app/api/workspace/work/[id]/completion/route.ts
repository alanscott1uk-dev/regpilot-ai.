import {NextResponse} from 'next/server';
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from '../../../../../../lib/server/ai-auth';
import {IntelligenceError} from '../../../../../../lib/server/intelligence-service';
import {workCompletion,completeWork} from '../../../../../../lib/server/work-completion-service';
import {EvidenceError} from '../../../../../../lib/evidence/file-guard.mjs';
import {workUuid,WorkInputError,readWorkJson} from '../../../../../../lib/work-hub.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type RouteContext={params:Promise<{id:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function failure(error:unknown){
 if(error instanceof AccessError||error instanceof IntelligenceError||error instanceof WorkInputError||error instanceof EvidenceError)return reply({error:error.message},error.status);
 if(error instanceof SyntaxError)return reply({error:'Invalid JSON'},400);
 return reply({error:'Completion could not be verified. Refresh the task and review its completion check before confirming again.'},503);
}
export async function GET(request:Request,route:RouteContext){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 try{
  const organizationId=new URL(request.url).searchParams.get('organizationId'),{id}=await route.params;
  if(!workUuid(organizationId)||!workUuid(id))return reply({error:'Choose a valid organisation and task'},400);
  const ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN','EDITOR','VIEWER']);
  return reply(await workCompletion(ctx,id));
 }catch(error){return failure(error);}
}
export async function POST(request:Request,route:RouteContext){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'JSON required'},415);
 try{
  const body=await readWorkJson(request) as Record<string,unknown>,{id}=await route.params;
  if(!body||typeof body!=='object'||Array.isArray(body)||!workUuid(body.organizationId)||!workUuid(id))return reply({error:'Choose a valid organisation and task'},400);
  const {organizationId,...input}=body;
  const ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN','EDITOR']);
  return reply(await completeWork(ctx,id,input));
 }catch(error){return failure(error);}
}
