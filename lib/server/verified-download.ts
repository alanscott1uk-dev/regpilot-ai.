/** A verified download is fully authorised and generated before any response bytes are exposed. */
export const VERIFIED_DOWNLOAD_CHUNK_BYTES=64*1024;
type DownloadOptions={filename:string;contentType:string;signal?:AbortSignal};

export async function verifiedDownloadResponse(generate:()=>Promise<Uint8Array>|Uint8Array,{filename,contentType,signal}:DownloadOptions):Promise<Response>{
 if(!/^[A-Za-z0-9_.-]{1,180}$/.test(filename)||filename.includes('..'))throw new Error('Use a server-generated download filename');
 signal?.throwIfAborted();
 // Generation performs the service's complete pre/post authority, scope and byte checks.
 // Nothing is streamed from storage or from an uncommitted verification operation.
 let bytes:Uint8Array|null=await generate();
 signal?.throwIfAborted();
 let offset=0,closed=false,onAbort:(()=>void)|undefined;
 const release=()=>{closed=true;bytes=null;if(onAbort)signal?.removeEventListener('abort',onAbort);};
 const body=new ReadableStream<Uint8Array>({
  start(controller){
   onAbort=()=>{if(closed)return;release();controller.error(signal?.reason||new DOMException('Download cancelled','AbortError'));};
   signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
  },
  pull(controller){
   if(closed)return;
   if(!bytes||offset===bytes.byteLength){release();controller.close();return;}
   const end=Math.min(offset+VERIFIED_DOWNLOAD_CHUNK_BYTES,bytes.byteLength);
   // Copy only the requested chunk: a cancelled reader cannot retain the entire backing buffer.
   const chunk=new Uint8Array(bytes.subarray(offset,end)),last=end===bytes.byteLength;offset=end;
   controller.enqueue(chunk);
   if(last){release();controller.close();}
  },
  cancel(){release();},
 },{highWaterMark:0});
 return new Response(body,{headers:{
  'Content-Type':contentType,'Content-Disposition':`attachment; filename="${filename}"`,
  'Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff',
 }});
}
