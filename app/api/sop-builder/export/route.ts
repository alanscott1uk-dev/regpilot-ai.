import {buildSopDocument} from "../../../../lib/server/sop-document";
import {failure,readBody} from "../../../../lib/server/intelligence-http";
import {DOCX_MIME} from "../../../../lib/evidence/file-guard.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
export async function POST(request:Request){
  try{
    const {filename,bytes}=await buildSopDocument(await readBody(request,192*1024));
    return new Response(new Uint8Array(bytes),{headers:{
      "Content-Type":DOCX_MIME,"Content-Disposition":`attachment; filename="${filename}"`,
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    }});
  }catch(error){return failure(error);}
}
