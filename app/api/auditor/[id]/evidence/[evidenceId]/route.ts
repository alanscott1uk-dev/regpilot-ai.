import {verifyAiIdentity} from "../../../../../../lib/server/ai-auth";
import {fail,validId} from "../../../../../../lib/server/operations-http";
import {downloadAuditEvidence} from "../../../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(request:Request,{params}:{params:Promise<{id:string;evidenceId:string}>}){
 try{
  const identity=await verifyAiIdentity(request),p=await params;
  const file=await downloadAuditEvidence(identity,validId(p.id),validId(p.evidenceId));
  return new Response(new Uint8Array(file.bytes),{headers:{"Content-Type":file.contentType,"Content-Disposition":'attachment; filename="'+file.filename+'"',"Content-Length":String(file.bytes.byteLength),"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","X-Download-Options":"noopen","Content-Security-Policy":"default-src 'none'; sandbox","Referrer-Policy":"no-referrer"}});
 }catch(e){return fail(e);}
}
