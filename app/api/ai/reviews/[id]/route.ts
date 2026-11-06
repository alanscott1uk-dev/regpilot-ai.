import {NextResponse} from "next/server";
import {authorisedAiContext,aiConfigured,AccessError} from "../../../../../lib/server/ai-auth";
import {readAiReviewRecord,updateAiReviewDecision,ReviewStoreError} from "../../../../../lib/server/ai-reviews";
import {ReviewPolicyError} from "../../../../../lib/ai/review-policy.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:{id:string}};
const reply=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request,{params}:Context){
 if(!aiConfigured())return reply({error:"Private AI pilot not configured"},503);
 try{
  const organizationId=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedAiContext(request,organizationId);
  return reply({review:await readAiReviewRecord(ctx,params.id)});
 }catch(error){
  if(error instanceof AccessError||error instanceof ReviewStoreError)return reply({error:error.message},error.status);
  return reply({error:"AI review unavailable"},503);
 }
}
export async function PATCH(request:Request,{params}:Context){
 if(!aiConfigured())return reply({error:"Private AI pilot not configured"},503);
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return reply({error:"Expected JSON"},415);
 try{
  const raw=await request.text();if(raw.length>1500)return reply({error:"Review decision too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedAiContext(request,data.organizationId||"");
  return reply({review:await updateAiReviewDecision(ctx,params.id,data)});
 }catch(error){
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(error instanceof AccessError||error instanceof ReviewStoreError||error instanceof ReviewPolicyError)return reply({error:error.message},error.status);
  return reply({error:"Could not record review decision"},503);
 }
}
