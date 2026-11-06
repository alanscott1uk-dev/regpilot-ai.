import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../lib/server/ai-auth";
import {createIntelligenceRun,getIntelligenceWorkspace,IntelligenceError} from "../../../../lib/server/intelligence-service";
import {failure,readBody,reply} from "../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const ctx=await authorisedWorkspaceContext(request,new URL(request.url).searchParams.get("organizationId")||"");
    return reply(await getIntelligenceWorkspace(ctx));
  }catch(e){return failure(e);}
}
export async function POST(request:Request){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.snapshotId!=="string")throw new IntelligenceError("Choose an organisation and source snapshot");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN","EDITOR"]);
    return reply(await createIntelligenceRun(ctx,body.snapshotId),201);
  }catch(e){return failure(e);}
}
