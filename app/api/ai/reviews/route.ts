import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,workspaceConfigured,AccessError} from "../../../../lib/server/ai-auth";
import {listAiReviewRecords,ReviewStoreError} from "../../../../lib/server/ai-reviews";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:"Private AI pilot not configured"},503);
 try{
  const organizationId=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedWorkspaceContext(request,organizationId);
  return reply({reviews:await listAiReviewRecords(ctx)});
 }catch(error){
  if(error instanceof AccessError||error instanceof ReviewStoreError)return reply({error:error.message},error.status);
  return reply({error:"AI review history unavailable"},503);
 }
}
