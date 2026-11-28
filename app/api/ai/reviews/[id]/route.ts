import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,workspaceConfigured,AccessError} from "../../../../../lib/server/ai-auth";
import {readAiReviewRecord,updateAiReviewDecision,redactAiReviewContent,ReviewStoreError} from "../../../../../lib/server/ai-reviews";
import {ReviewPolicyError} from "../../../../../lib/ai/review-policy.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
const reply=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request,{params}:Context){
 if(!workspaceConfigured())return reply({error:"Private AI pilot not configured"},503);
 try{
  const organizationId=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedWorkspaceContext(request,organizationId);
  return reply({review:await readAiReviewRecord(ctx,(await params).id)});
 }catch(error){
  if(error instanceof AccessError||error instanceof ReviewStoreError)return reply({error:error.message},error.status);
  return reply({error:"AI review unavailable"},503);
 }
}
export async function PATCH(request:Request,{params}:Context){
 if(!workspaceConfigured())return reply({error:"Private AI pilot not configured"},503);
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return reply({error:"Expected JSON"},415);
 try{
  const raw=await request.text();if(raw.length>1500)return reply({error:"Review decision too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedWorkspaceContext(request,data.organizationId||"");
  return reply({review:await updateAiReviewDecision(ctx,(await params).id,data)});
 }catch(error){
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(error instanceof AccessError||error instanceof ReviewStoreError||error instanceof ReviewPolicyError)return reply({error:error.message},error.status);
  return reply({error:"Could not record review decision"},503);
 }
}

/** Redact saved generation output even when billable AI has been disabled. */
export async function DELETE(request:Request,{params}:Context){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return reply({error:"Expected JSON"},415);
 try{
  const raw=await request.text();
  if(raw.length>450)return reply({error:"Redaction request too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedWorkspaceContext(request,data.organizationId||"");
  const result=await redactAiReviewContent(ctx,(await params).id,data.version);
  return reply({redaction:result});
 }catch(error){
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(error instanceof AccessError||error instanceof ReviewStoreError)
   return reply({error:error.message},error.status);
  return reply({error:"Could not redact saved review"},503);
 }
}
