import {handleStripeEvent} from "../../../../lib/server/billing-service";
import {serviceReady} from "../../../../lib/services/config";
import {ProviderError} from "../../../../lib/services/http";
import {reply,failure} from "../../../../lib/server/intelligence-http";
export const runtime="nodejs";
export async function POST(request:Request){
 if(!serviceReady("STRIPE"))return reply({error:"Billing awaits activation"},503);
 try{const reader=request.body?.getReader();if(!reader)return reply({error:"Body required"},400);const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200_000){await reader.cancel();return reply({error:"Event too large"},413);}chunks.push(value);}return reply(await handleStripeEvent(Buffer.concat(chunks).toString("utf8"),request.headers.get("stripe-signature")||""));}catch(e){if(e instanceof ProviderError)return reply({error:"Event verification failed"},400);return failure(e);}
}
