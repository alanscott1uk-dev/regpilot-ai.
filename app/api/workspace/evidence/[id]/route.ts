import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,AccessError} from "../../../../../lib/server/ai-auth";
import {evidenceConfigured} from "../../../../../lib/server/evidence-storage";
import {downloadEvidence,reviewEvidence} from "../../../../../lib/server/evidence-service";
import {EvidenceError} from "../../../../../lib/evidence/file-guard.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
type Context={params:Promise<{id:string}>};
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request,{params}:Context){
 if(!evidenceConfigured())return reply({error:"Private evidence pilot not configured"},503);
 try{
  const orgId=new URL(request.url).searchParams.get("organizationId")||"";
  const ctx=await authorisedWorkspaceContext(request,orgId);
  const file=await downloadEvidence(ctx,(await params).id);
  return new Response(new Uint8Array(file.bytes),{headers:{
   "Content-Type":file.contentType,
   "Content-Disposition":'attachment; filename="'+file.filename+'"',
   "Content-Length":String(file.bytes.byteLength),
   "Cache-Control":"private, no-store, max-age=0",
   "X-Content-Type-Options":"nosniff",
   "ETag":'"'+file.sha256+'"',
   "X-Download-Options":"noopen",
   "Content-Security-Policy":"default-src 'none'; sandbox"
  }});
 }catch(e){
  if(e instanceof AccessError||e instanceof EvidenceError)return reply({error:e.message},e.status);
  return reply({error:"Secure evidence download failed"},503);
 }
}
export async function PATCH(request:Request,{params}:Context){
 if(!evidenceConfigured())return reply({error:"Private evidence pilot not configured"},503);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return reply({error:"JSON required"},415);
 try{
  const raw=await request.text();if(raw.length>1400)return reply({error:"Review request too large"},413);
  const data=JSON.parse(raw);
  const ctx=await authorisedWorkspaceContext(request,data.organizationId||"",["OWNER","ADMIN"]);
  return reply({evidence:await reviewEvidence(ctx,(await params).id,data)});
 }catch(e){
  if(e instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  if(e instanceof AccessError||e instanceof EvidenceError)return reply({error:e.message},e.status);
  return reply({error:"Evidence review unavailable"},503);
 }
}
