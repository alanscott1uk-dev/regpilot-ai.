import {NextResponse} from "next/server";
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from "../../../../../lib/server/ai-auth";
import {changeObligationStatus} from "../../../../../lib/server/obligation-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:{id:string}};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const valid=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export async function PATCH(request:Request,{params}:Context){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return reply({error:"JSON required"},415);
 if(!valid(params.id))return reply({error:"Invalid task ID"},400);
 try{
  const text=await request.text();if(text.length>800)return reply({error:"Request too large"},413);
  const input=JSON.parse(text);
  if(!valid(input.organizationId))return reply({error:"Invalid organisation"},400);
  if(!["OPEN","IN_PROGRESS","COMPLETE"].includes(input.status))return reply({error:"Invalid status"},400);
  const ctx=await authorisedWorkspaceContext(request,input.organizationId,["OWNER","ADMIN","EDITOR"]);
  const updated=await changeObligationStatus(ctx,params.id,input.status,{completionRationale:typeof input.completionRationale==="string"?input.completionRationale:""});
  if(!updated)return reply({error:"Task not found"},404);
  return reply({item:updated});
 }catch(error){
  if(error instanceof AccessError)return reply({error:error.message},error.status);
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(error instanceof Error&&/Completion requires|rationale too long/.test(error.message))return reply({error:error.message},409);
  return reply({error:"Cannot change task status"},503);
 }
}
