import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../../lib/server/ai-auth";
import {createSemanticRun,semanticConfigured} from "../../../../../lib/server/semantic-service";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {failure,readBody,reply} from "../../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function POST(request:Request){
  if(!workspaceConfigured()||!semanticConfigured())return reply({error:"AI interpretation is not enabled for this pilot"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.snapshotId!=="string")throw new IntelligenceError("Choose an organisation and source");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN","EDITOR"]);
    return reply(await createSemanticRun(ctx,body.snapshotId,body.consent),201);
  }catch(error){return failure(error);}
}
