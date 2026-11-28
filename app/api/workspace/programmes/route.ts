import {NextResponse} from 'next/server';
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from '../../../../lib/server/ai-auth';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {planStarterProgramme,starterProgrammeWorkspace} from '../../../../lib/server/starter-programme-service';
import {StarterProgrammeInputError,readStarterProgrammeJson} from '../../../../lib/starter-programmes.mjs';
import {workUuid} from '../../../../lib/work-hub.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function failure(error:unknown){if(error instanceof AccessError||error instanceof IntelligenceError||error instanceof StarterProgrammeInputError)return reply({error:error.message},error.status);if(error instanceof SyntaxError)return reply({error:'Invalid JSON'},400);return reply({error:'Starter programmes are temporarily unavailable. Check the saved programme before trying another creation request.'},503);}
export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 try{const params=new URL(request.url).searchParams,org=params.get('organizationId'),programmeId=params.get('programmeId');if(!workUuid(org)||params.getAll('organizationId').length!==1||params.getAll('programmeId').length>1||params.has('programmeId')&&!workUuid(programmeId))return reply({error:'Invalid company or starter programme'},400);const ctx=await authorisedWorkspaceContext(request,org,['OWNER','ADMIN','EDITOR','VIEWER']);return reply(await starterProgrammeWorkspace(ctx,programmeId||undefined));}catch(error){return failure(error);}
}
export async function POST(request:Request){
 if(!workspaceConfigured())return reply({error:'Private workspace not configured'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'JSON required'},415);
 try{const body=await readStarterProgrammeJson(request) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body)||!workUuid(body.organizationId)||!['preview','apply'].includes(String(body.operation)))return reply({error:'Choose a company and preview or apply operation'},400);const {organizationId,operation,...input}=body,ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN']);return reply(await planStarterProgramme(ctx,input,operation==='apply'));}catch(error){return failure(error);}
}
