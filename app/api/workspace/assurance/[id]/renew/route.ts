import {authorisedWorkspaceContext} from "../../../../../../lib/server/ai-auth";
import {assuranceConfigured,assuranceRenewal,renewAssurance} from "../../../../../../lib/server/assurance-service";
import {failure,reply,readBody} from "../../../../../../lib/server/intelligence-http";
import {IntelligenceError} from "../../../../../../lib/server/intelligence-service";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=120;
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{
    const organizationId=new URL(request.url).searchParams.get("organizationId"),{id}=await params;
    if(!uuid(organizationId)||!uuid(id))throw new IntelligenceError("Choose a valid organisation and evidence assessment");
    const ctx=await authorisedWorkspaceContext(request,organizationId);
    return reply(await assuranceRenewal(ctx,id));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{
    const body=await readBody(request,8192),{id}=await params;
    if(!uuid(body.organizationId)||!uuid(id))throw new IntelligenceError("Choose a valid organisation and evidence assessment");
    const {organizationId,...input}=body;
    const ctx=await authorisedWorkspaceContext(request,organizationId,["OWNER","ADMIN"]);
    return reply(await renewAssurance(ctx,id,input));
  }catch(error){return failure(error);}
}
