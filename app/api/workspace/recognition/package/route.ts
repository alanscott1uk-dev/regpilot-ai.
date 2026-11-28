import {context,readBody,reply,fail} from "../../../../../lib/server/operations-http";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {evidenceConfigured} from "../../../../../lib/server/evidence-storage";
import {recognitionPackageWorkspace,previewRecognitionPackage,exportRecognitionPackage} from "../../../../../lib/server/recognition-package-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(request:Request){
 try{
  const url=new URL(request.url),ctx=await context(request,url.searchParams.get("organizationId"),true);
  return reply(await recognitionPackageWorkspace(ctx,url.searchParams.get("trackId")||""));
 }catch(error){return fail(error);}
}
export async function POST(request:Request){
 try{
  const body=await readBody(request),ctx=await context(request,body.organizationId,true);
  const selection={trackId:body.trackId,evidenceIds:body.evidenceIds};
  if(body.action==="PREVIEW")return reply(await previewRecognitionPackage(ctx,selection));
  if(body.action!=="EXPORT")throw new IntelligenceError("Choose preview or export",400);
  if(!evidenceConfigured())throw new IntelligenceError("Private evidence services await verified activation",503);
  const result=await exportRecognitionPackage(ctx,{...selection,previewHash:body.previewHash,confirm:body.confirm});
  return new Response(new Uint8Array(result.bytes),{status:200,headers:{
   "Content-Type":"application/zip","Content-Disposition":"attachment; filename=\""+result.filename+"\"",
   "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-RegPilot-Archive-SHA256":result.sha256
  }});
 }catch(error){return fail(error);}
}
