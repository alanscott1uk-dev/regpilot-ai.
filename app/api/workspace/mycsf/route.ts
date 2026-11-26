import {NextResponse} from 'next/server';
import {z} from 'zod';
import {AccessError,authorisedWorkspaceContext,workspaceConfigured} from '../../../../lib/server/ai-auth';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';
import {changeMyCsf,myCsfWorkspace} from '../../../../lib/server/mycsf-service';
import {hitrustTiers} from '../../../../lib/audit-catalogue/hitrust';
import {readStarterProgrammeJson,StarterProgrammeInputError} from '../../../../lib/starter-programmes.mjs';
import {EvidenceError} from '../../../../lib/evidence/file-guard.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function failure(e:unknown){
 if(e instanceof AccessError||e instanceof IntelligenceError||e instanceof EvidenceError||e instanceof StarterProgrammeInputError)return response({error:e.message},e.status);
 if(e instanceof SyntaxError||e instanceof z.ZodError)return response({error:'Invalid MyCSF request.'},400);
 return response({error:'MyCSF is temporarily unavailable.'},503);
}
const query=z.object({organizationId:z.uuid(),tier:z.enum(hitrustTiers),connection:z.uuid().optional(),q:z.string().max(150).default(''),evidenceQuery:z.string().max(150).default(''),page:z.string().regex(/^[1-9]\d{0,4}$/).default('1')}).strict();
export async function GET(request:Request){
 if(!workspaceConfigured())return response({error:'Private workspace not configured.'},503);
 try{const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length!==1))return response({error:'Duplicate parameter.'},400);
  const p=query.parse(Object.fromEntries(params));const ctx=await authorisedWorkspaceContext(request,p.organizationId);
  return response(await myCsfWorkspace(ctx,p.tier,p.connection,p.q,Number(p.page),p.evidenceQuery));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 if(!workspaceConfigured())return response({error:'Private workspace not configured.'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response({error:'JSON required.'},415);
 try{const raw=await readStarterProgrammeJson(request);if(!raw||typeof raw!=='object'||Array.isArray(raw))return response({error:'Invalid request.'},400);
  const {organizationId,...command}=raw as Record<string,unknown>;const ctx=await authorisedWorkspaceContext(request,z.uuid().parse(organizationId),['OWNER','ADMIN']);return response(await changeMyCsf(ctx,command));
 }catch(e){return failure(e);}
}
