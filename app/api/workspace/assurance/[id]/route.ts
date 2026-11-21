import {authorisedWorkspaceContext} from "../../../../../lib/server/ai-auth";
import {assuranceConfigured,reviewAssurance} from "../../../../../lib/server/assurance-service";
import {failure,reply,readBody} from "../../../../../lib/server/intelligence-http";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=60;
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{
    const body=await readBody(request);
    if(typeof body.organizationId!=="string"||typeof body.decision!=="string"||typeof body.version!=="number"||typeof body.notes!=="string"||(body.passageKeys!==undefined&&(!Array.isArray(body.passageKeys)||body.passageKeys.some(k=>typeof k!=="string"))))throw new IntelligenceError("Enter a valid assessment decision");
    const ctx=await authorisedWorkspaceContext(request,body.organizationId,["OWNER","ADMIN"]);
    return reply(await reviewAssurance(ctx,(await params).id,{decision:body.decision,version:body.version,notes:body.notes,passageKeys:body.passageKeys as string[]|undefined,validUntil:typeof body.validUntil==="string"?body.validUntil:undefined,scopeConfirmed:body.scopeConfirmed,originalsChecked:body.originalsChecked}));
  }catch(e){return failure(e);}
}
