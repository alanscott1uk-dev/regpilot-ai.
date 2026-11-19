import {NextResponse} from 'next/server';
import {authorisedWorkspaceContext,AccessError} from '../../../../../lib/server/ai-auth';
import {evidenceConfigured} from '../../../../../lib/server/evidence-storage';
import {IntelligenceError} from '../../../../../lib/server/intelligence-service';
import {evidenceLibrary} from '../../../../../lib/server/evidence-library-service';
import {parseEvidenceLibraryQuery,EvidenceLibraryInputError} from '../../../../../lib/evidence-library.mjs';
import {workUuid} from '../../../../../lib/work-hub.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){
 if(!evidenceConfigured())return reply({error:'Private evidence pilot not configured'},503);
 try{
  const params=new URL(request.url).searchParams,query=parseEvidenceLibraryQuery(params),organizationId=params.get('organizationId');
  if(!workUuid(organizationId))return reply({error:'Invalid organisation'},400);
  const ctx=await authorisedWorkspaceContext(request,organizationId,['OWNER','ADMIN','EDITOR','VIEWER']);
  return reply(await evidenceLibrary(ctx,query));
 }catch(error){
  if(error instanceof AccessError||error instanceof IntelligenceError||error instanceof EvidenceLibraryInputError)return reply({error:error.message},error.status);
  return reply({error:'Evidence library is temporarily unavailable. Refresh without changing your selection.'},503);
 }
}
