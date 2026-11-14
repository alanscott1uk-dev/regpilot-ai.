import {NextResponse} from "next/server";
import {AccessError} from "./ai-auth";
import {IntelligenceError} from "./intelligence-service";
export const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export function failure(error:unknown){
  if(error instanceof AccessError||error instanceof IntelligenceError)return reply({error:error.message},error.status);
  if(error instanceof SyntaxError)return reply({error:"Invalid JSON"},400);
  return reply({error:"Intelligence workspace unavailable"},503);
}
export async function readBody(request:Request,maxBytes=4096):Promise<Record<string,unknown>> {
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new IntelligenceError("JSON required",415);
  const reader=request.body?.getReader();if(!reader)throw new IntelligenceError("Request body required");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new IntelligenceError(`Request exceeds ${maxBytes/1024} KB`,413);}chunks.push(value);}
  const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!data||typeof data!=="object"||Array.isArray(data))throw new IntelligenceError("A JSON object is required");
  return data;
}
