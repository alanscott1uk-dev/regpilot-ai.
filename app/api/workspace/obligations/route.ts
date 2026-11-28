import {NextResponse} from "next/server";
import {workspaceConfigured,authorisedWorkspaceContext,AccessError} from "../../../../lib/server/ai-auth";
import {listObligations,createObligation} from "../../../../lib/server/obligation-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const validId=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 try{
  const organizationId=new URL(request.url).searchParams.get("organizationId");
  if(!validId(organizationId))return reply({error:"Invalid organisation"},400);
  const ctx=await authorisedWorkspaceContext(request,organizationId!);
  return reply({items:await listObligations(ctx)});
 }catch(error){
  if(error instanceof AccessError)return reply({error:error.message},error.status);
  return reply({error:"Could not load organisation tasks"},503);
 }
}
export async function POST(request:Request){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return reply({error:"JSON required"},415);
 try{
  const raw=await request.text();if(raw.length>4500)return reply({error:"Request exceeds size limit"},413);
  const input=JSON.parse(raw);
  if(!validId(input.organizationId))return reply({error:"Invalid organisation"},400);
  const ctx=await authorisedWorkspaceContext(request,input.organizationId,["OWNER","ADMIN","EDITOR"]);
  const item=await createObligation(ctx,{
   title:input.title,category:input.category,ownerName:input.ownerName,
   dueDate:input.dueDate,notes:input.notes,sourceUrl:input.sourceUrl,sourceCheckedAt:input.sourceCheckedAt
  });
  return reply({item},201);
 }catch(error){
  if(error instanceof AccessError)return reply({error:error.message},error.status);
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(error instanceof Error&&(/Invalid input|Invalid date|Invalid source URL|Source date requires/.test(error.message)))return reply({error:error.message},400);
  return reply({error:"Could not create organisation task"},503);
 }
}
