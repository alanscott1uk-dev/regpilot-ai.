import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../../lib/server/ai-auth";
import {saveBusinessProfile,IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {db} from "../../../../../lib/server/db";
import {failure,readBody,reply} from "../../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function PUT(request:Request){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.version!=="number")throw new IntelligenceError("Choose an organisation and profile version");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN"]);
    return reply({profile:await saveBusinessProfile(ctx,body,body.version)});
  }catch(e){return failure(e);}
}

export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 try{
  const org=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedWorkspaceContext(request,org);
  const profile=await db.businessProfile.findUnique({where:{organizationId:ctx.organizationId},
   select:{activities:true,jurisdictions:true,version:true,updatedAt:true}});
  return reply({profile});
 }catch(e){return failure(e);}
}
