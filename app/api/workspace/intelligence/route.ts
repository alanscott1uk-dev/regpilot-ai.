import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../lib/server/ai-auth";
import {createIntelligenceRun,getIntelligenceWorkspace,getSourceImpact,IntelligenceError} from "../../../../lib/server/intelligence-service";
import {failure,readBody,reply} from "../../../../lib/server/intelligence-http";
import {listWatches,monitoringEnabled} from "../../../../lib/server/monitoring-service";
import {semanticConfigured,semanticActivity} from "../../../../lib/server/semantic-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const ctx=await authorisedWorkspaceContext(request,new URL(request.url).searchParams.get("organizationId")||"");
    const [workspace,watches,semanticRequests,sourceImpact]=await Promise.all([getIntelligenceWorkspace(ctx),listWatches(ctx),semanticActivity(ctx),getSourceImpact(ctx)]);
    return reply({...workspace,watches,semanticRequests,sourceImpact,monitoringEnabled:monitoringEnabled(),semanticEnabled:semanticConfigured()});
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
