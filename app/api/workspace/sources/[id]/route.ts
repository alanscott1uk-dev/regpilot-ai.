import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,workspaceConfigured,AccessError} from "../../../../../lib/server/ai-auth";
import {reviewSourceSnapshot,RegulatoryWatchError} from "../../../../../lib/server/regulatory-watch";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:{id:string}};
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function PATCH(request:Request,{params}:Context){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return reply({error:"JSON required"},415);
 try{
  const raw=await request.text();if(raw.length>1600)return reply({error:"Review body too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedWorkspaceContext(request,data.organizationId||"",["OWNER","ADMIN"]);
  return reply({snapshot:await reviewSourceSnapshot(ctx,params.id,data)});
 }catch(e){
  if(e instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(e instanceof AccessError||e instanceof RegulatoryWatchError)return reply({error:e.message},e.status);
  return reply({error:"Unable to record source decision"},503);
 }
}
