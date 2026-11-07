import {authorisedWorkspaceContext} from "../../../../lib/server/ai-auth";
import {assuranceConfigured,assuranceWorkspace,prepareAssurance} from "../../../../lib/server/assurance-service";
import {failure,reply,readBody} from "../../../../lib/server/intelligence-http";
import {IntelligenceError} from "../../../../lib/server/intelligence-service";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=120;
export async function GET(request:Request){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{const url=new URL(request.url),ctx=await authorisedWorkspaceContext(request,url.searchParams.get("organizationId")||"");return reply(await assuranceWorkspace(ctx,url.searchParams.get("taskId")||undefined));}catch(e){return failure(e);}
}
export async function POST(request:Request){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.taskId!=="string"||typeof body.method!=="string"||!Array.isArray(body.evidenceIds)||body.evidenceIds.some(id=>typeof id!=="string"))throw new IntelligenceError("Choose a task, method and evidence files");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN","EDITOR"]);
    return reply(await prepareAssurance(ctx,{taskId:body.taskId,evidenceIds:body.evidenceIds as string[],method:body.method,consent:body.consent}),201);
  }catch(e){return failure(e);}
}
