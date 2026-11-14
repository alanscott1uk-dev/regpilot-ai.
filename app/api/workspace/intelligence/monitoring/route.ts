import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../../lib/server/ai-auth";
import {configureWatch} from "../../../../../lib/server/monitoring-service";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {failure,readBody,reply} from "../../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function PUT(request:Request){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.sourceId!=="string"||typeof body.enabled!=="boolean"||typeof body.intervalHours!=="number"||typeof body.version!=="number")throw new IntelligenceError("Choose valid monitoring settings");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN"]);
    return reply(await configureWatch(ctx,{sourceId:body.sourceId,enabled:body.enabled,intervalHours:body.intervalHours,version:body.version}));
  }catch(error){return failure(error);}
}
