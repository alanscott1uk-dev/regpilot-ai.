import {workspaceCatalogue} from "../../../../lib/server/publication-catalogue";
import {requireMember,WRITER} from "../../../../lib/server/workspace-member";
import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,workspaceConfigured,AccessError} from "../../../../lib/server/ai-auth";
import {checkOfficialSource,listSourceSnapshots,RegulatoryWatchError} from "../../../../lib/server/regulatory-watch";
import {SourceUnavailable} from "../../../../lib/server/ai-sources";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=40;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 try{
  const org=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedWorkspaceContext(request,org);
  const [snapshots,catalogue]=await Promise.all([listSourceSnapshots(ctx),workspaceCatalogue(ctx)]);return reply({snapshots,catalogue});
 }catch(e){
  if(e instanceof AccessError||e instanceof RegulatoryWatchError)return reply({error:e.message},e.status);
  return reply({error:"Source history unavailable"},503);
 }
}
export async function POST(request:Request){
 if(!workspaceConfigured())return reply({error:"Private workspace not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return reply({error:"JSON required"},415);
 try{
  const raw=await request.text();if(raw.length>700)return reply({error:"Source check request too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedWorkspaceContext(request,data.organizationId||"",["OWNER","ADMIN","EDITOR"]);
  const result=await checkOfficialSource(ctx,data.sourceId,undefined,async tx=>{await requireMember(tx,ctx,WRITER);});
  return reply(result);
 }catch(e){
  if(e instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(e instanceof AccessError||e instanceof RegulatoryWatchError)return reply({error:e.message},e.status);
  if(e instanceof SourceUnavailable)return reply({error:e.message},503);
  return reply({error:"Official source could not be checked"},503);
 }
}
