import {NextResponse} from "next/server";
import {authorisedWorkspaceContext,AccessError} from "../../../../lib/server/ai-auth";
import {evidenceConfigured} from "../../../../lib/server/evidence-storage";
import {createEvidence,listEvidence} from "../../../../lib/server/evidence-service";
import {EvidenceError} from "../../../../lib/evidence/file-guard.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const valid=(x:unknown):x is string=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
async function limitedForm(request:Request){
 const contentType=request.headers.get("content-type")||"";
 if(!contentType.toLowerCase().startsWith("multipart/form-data;"))throw new EvidenceError("Multipart form data required",415);
 if(Number(request.headers.get("content-length")||0)>6_000_000)throw new EvidenceError("Upload exceeds 6 MB request limit",413);
 if(!request.body)throw new EvidenceError("Upload body missing",400);
 const reader=request.body.getReader();const buffers:Buffer[]=[];let size=0;
 while(true){
  const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;
  if(size>6_000_000){void reader.cancel();throw new EvidenceError("Upload exceeds 6 MB request limit",413);}
  buffers.push(Buffer.from(value));
 }
 const parsed=new Request("https://regpilot.invalid/upload",{
  method:"POST",headers:{"Content-Type":contentType},body:Buffer.concat(buffers) as unknown as BodyInit
 });
 return parsed.formData();
}
export async function GET(request:Request){
 if(!evidenceConfigured())return reply({error:"Private evidence pilot not configured"},503);
 try{
  const p=new URL(request.url).searchParams,orgId=p.get("organizationId"),taskId=p.get("obligationId");
  if(!valid(orgId)||!valid(taskId))return reply({error:"Invalid organisation or task"},400);
  const ctx=await authorisedWorkspaceContext(request,orgId);
  return reply({evidence:await listEvidence(ctx,taskId)});
 }catch(e){
  if(e instanceof AccessError||e instanceof EvidenceError)return reply({error:e.message},e.status);
  return reply({error:"Evidence listing unavailable"},503);
 }
}
export async function POST(request:Request){
 if(!evidenceConfigured())return reply({error:"Private evidence pilot not configured"},503);
 try{
  const form=await limitedForm(request);
  const orgId=form.get("organizationId"),taskId=form.get("obligationId"),file=form.get("file");
  if(!valid(orgId)||!valid(taskId))return reply({error:"Invalid organisation or task"},400);
  const ctx=await authorisedWorkspaceContext(request,orgId,["OWNER","ADMIN","EDITOR"]);
  if(!(file instanceof File))throw new EvidenceError("A PDF or Word attachment is required",415);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const record=await createEvidence(ctx,taskId,file.name,bytes);
  return reply({evidence:record},201);
 }catch(e){
  if(e instanceof AccessError||e instanceof EvidenceError)return reply({error:e.message},e.status);
  return reply({error:"Evidence upload unavailable or scanner not ready"},503);
 }
}
