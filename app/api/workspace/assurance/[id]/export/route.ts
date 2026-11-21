import {authorisedWorkspaceContext} from "../../../../../../lib/server/ai-auth";
import {assuranceConfigured,exportAssurance} from "../../../../../../lib/server/assurance-service";
import {failure,reply} from "../../../../../../lib/server/intelligence-http";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!assuranceConfigured())return reply({error:"Evidence assessment is awaiting activation"},503);
  try{const ctx=await authorisedWorkspaceContext(request,new URL(request.url).searchParams.get("organizationId")||""),body=await exportAssurance(ctx,(await params).id);return new Response(JSON.stringify(body,null,2),{headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"attachment; filename=regpilot-evidence-assessment.json"}});}catch(e){return failure(e);}
}
