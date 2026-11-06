import {NextResponse} from "next/server";
import {aiConfigured,AccessError,authorisedAiContext} from "../../../../lib/server/ai-auth";
import {reserveAiRequest,DailyLimitError} from "../../../../lib/server/ai-meter";
import {loadOfficialSource,SourceUnavailable} from "../../../../lib/server/ai-sources";
import {runRegPilotAi} from "../../../../lib/server/ai-model";
import {saveGeneratedReview} from "../../../../lib/server/ai-reviews";
import {validateAiRequest,InputError} from "../../../../lib/ai/contract.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function limitedBody(request:Request){
 const reader=request.body?.getReader();
 if(!reader)throw new InputError("Request body missing");
 const chunks:Uint8Array[]=[];let sum=0;
 while(true){
  const {done,value}=await reader.read();if(done)break;
  sum+=value.byteLength;if(sum>3_000_000){void reader.cancel();throw new InputError("Request exceeds 3 MB");}
  chunks.push(value);
 }
 return JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x))).toString("utf8"));
}
export async function GET(){
 return json({enabled:aiConfigured(),mode:"private-pilot",privacy:"Use fictional or non-sensitive data only. Model processing may occur outside the UK.",requiresAuth:true});
}
export async function POST(request:Request){
 if(!aiConfigured())return json({error:"Private AI pilot not configured"},503);
 if(!process.env.AI_GATEWAY_API_KEY&&!process.env.VERCEL_OIDC_TOKEN)return json({error:"AI Gateway authentication not configured"},503);
 const contentType=request.headers.get("content-type")||"";
 if(!contentType.toLowerCase().startsWith("application/json"))return json({error:"Send application/json"},415);
 const size=Number(request.headers.get("content-length")||"0");
 if(size>3_000_000)return json({error:"Request exceeds 3 MB"},413);
 let requestId:string|null=null;
 try{
  const raw=await limitedBody(request);
  const input=validateAiRequest(raw);
  const ctx=await authorisedAiContext(request,input.organizationId);
  const official=await loadOfficialSource(input.sourceId);
  requestId=await reserveAiRequest(ctx,input.mode);
  const ai=await runRegPilotAi(input,official);
  let reviewId:string|null=null,storageWarning:string|null=null;
  if(input.retainDraft){
   try{
    const stored=await saveGeneratedReview(ctx,{requestId,mode:input.mode,ai});
    reviewId=stored.id;
   }catch{
    // Never discard a paid AI result solely because the optional review save failed.
    storageWarning="Your AI review was generated but not saved to the team inbox. Download the draft before leaving.";
   }
  }
  return json({requestId,ai,reviewId,storageWarning});
 }catch(error){
  if(error instanceof InputError)return json({error:error.message},400);
  if(error instanceof AccessError)return json({error:error.message},error.status);
  if(error instanceof SourceUnavailable)return json({error:error.message},422);
  if(error instanceof DailyLimitError)return json({error:error.message},429);
  // Internal provider errors must never return credentials, submitted documents or provider payloads.
  return json({error:requestId?"AI generation unavailable or invalid; allowance was reserved. Retry later.":"AI service or organisation store unavailable."},503);
 }
}
