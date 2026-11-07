import {z} from "zod";
import {authorisedWorkspaceContext,workspaceConfigured} from "../../../../../lib/server/ai-auth";
import {decideCandidate,IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {failure,readBody,reply} from "../../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
const decision=z.object({organizationId:z.string().uuid(),candidateKey:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(["ACCEPTED","DISMISSED"]),rationale:z.string().min(20).max(800),ownerName:z.string().max(80).optional(),title:z.string().max(160).optional(),dueDate:z.string().max(10).optional()});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
  try{
    const body=decision.safeParse(await readBody(request));
    if(!body.success)throw new IntelligenceError("Check the recommendation, decision and required review fields");
    const ctx=await authorisedWorkspaceContext(request,body.data.organizationId,["OWNER","ADMIN"]);
    return reply({decision:await decideCandidate(ctx,(await params).id,body.data)});
  }catch(e){return failure(e);}
}
