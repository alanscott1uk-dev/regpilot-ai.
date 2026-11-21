import {NextResponse} from 'next/server';
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from '../../../../lib/server/ai-auth';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {workInbox,workTask,planWork,startWork,createWork} from '../../../../lib/server/work-hub-service';
import {parseWorkQuery,workUuid,WorkInputError,readWorkJson} from '../../../../lib/work-hub.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function failure(error:unknown){
 if(error instanceof AccessError||error instanceof IntelligenceError||error instanceof WorkInputError)return reply({error:error.message},error.status);
 if(error instanceof SyntaxError)return reply({error:'Invalid JSON'},400);
 return reply({error:'The work hub is temporarily unavailable. Retry without changing your selection.'},503);
}
export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 try{
  const params=new URL(request.url).searchParams,org=params.get('organizationId');
  if(!workUuid(org))return reply({error:'Invalid organisation'},400);
  const ctx=await authorisedWorkspaceContext(request,org,['OWNER','ADMIN','EDITOR','VIEWER']);
  const id=params.get('taskId');
  return reply(id?await workTask(ctx,id):await workInbox(ctx,parseWorkQuery(params)));
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'JSON required'},415);
 try{
  const body=await readWorkJson(request) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||!workUuid(body.organizationId))return reply({error:'Invalid organisation'},400);
  if(typeof body.operation!=='string'||!['preview','apply','start','create'].includes(body.operation))return reply({error:'Choose preview, apply, start or create'},400);
  const {organizationId,operation,...input}=body;
  const ctx=await authorisedWorkspaceContext(request,organizationId,['start','create'].includes(operation)?['OWNER','ADMIN','EDITOR']:['OWNER','ADMIN']);
  if(operation==='create')return reply(await createWork(ctx,input),201);
  return reply(operation==='start'?await startWork(ctx,input):await planWork(ctx,input,operation==='apply'));
 }catch(error){return failure(error);}
}
