import {verifiedByteStream} from "./verified-download";
import {contentDispositionFilename} from "../evidence/file-guard.mjs";

export function auditFileResponse(file:{bytes:Uint8Array;filename:string;contentType:string;sha256:string},signal:AbortSignal,includeLength=false){
  const headers=new Headers({
    "Content-Type":file.contentType,"Content-Disposition":'attachment; filename="'+contentDispositionFilename(file.filename)+'"',
    "Content-Digest":"sha-256=:"+Buffer.from(file.sha256,"hex").toString("base64")+":",
    "Cache-Control":"private, no-store, no-transform","X-Content-Type-Options":"nosniff","X-Download-Options":"noopen",
    "Content-Security-Policy":"default-src 'none'; sandbox","Referrer-Policy":"no-referrer"
  });
  if(includeLength)headers.set("Content-Length",String(file.bytes.byteLength));
  return new Response(verifiedByteStream(file.bytes,signal),{headers});
}
