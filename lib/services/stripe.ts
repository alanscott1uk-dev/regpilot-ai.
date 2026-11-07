import {createHmac,timingSafeEqual} from "node:crypto";
import {serviceReady,appOrigin} from "./config";
import {ProviderError,checkedJson} from "./http";
const version="2026-10-28.endive";
export function stripeHeaders(){return {Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,"Stripe-Version":version};}
export function verifyStripeEvent(body:string,signature:string,now=Date.now()){
 const secret=process.env.STRIPE_WEBHOOK_SECRET;if(!secret||body.length>200_000||signature.length>2000)throw new ProviderError("INVALID_SIGNATURE");
 const pieces=signature.split(",").map(p=>p.trim().split("=")),ts=pieces.filter(p=>p[0]==="t");if(ts.length!==1||!/^\d{10}$/.test(ts[0][1]||""))throw new ProviderError("INVALID_SIGNATURE");
 const timestamp=Number(ts[0][1]);if(Math.abs(now/1000-timestamp)>300)throw new ProviderError("EXPIRED_SIGNATURE");
 const wanted=createHmac("sha256",secret).update(timestamp+"."+body).digest();
 if(!pieces.some(([k,v])=>k==="v1"&&/^[a-f0-9]{64}$/.test(v||"")&&timingSafeEqual(wanted,Buffer.from(v,"hex"))))throw new ProviderError("INVALID_SIGNATURE");
 let event;try{event=JSON.parse(body);}catch{throw new ProviderError("INVALID_EVENT");}
 const live=process.env.STRIPE_SECRET_KEY?.includes("_live_")===true;
 if(typeof event.id!=="string"||!/^evt_[A-Za-z0-9]+$/.test(event.id)||event.id.length>120||typeof event.type!=="string"||event.type.length>100||!Number.isSafeInteger(event.created)||event.livemode!==live||!event.data?.object)throw new ProviderError("INVALID_EVENT");return event;
}
export async function createCheckout(input:{jobId:string;organizationId:string;customerId?:string},fetcher:typeof fetch=fetch){
 if(!serviceReady("STRIPE"))throw new ProviderError("SERVICE_DISABLED");
 const form=new URLSearchParams({mode:"subscription","line_items[0][price]":process.env.STRIPE_PRICE_ID!,"line_items[0][quantity]":"1",client_reference_id:input.organizationId,"metadata[organizationId]":input.organizationId,"metadata[jobId]":input.jobId,"subscription_data[metadata][organizationId]":input.organizationId,"subscription_data[metadata][jobId]":input.jobId,success_url:appOrigin()+"/team/services?checkout=returned",cancel_url:appOrigin()+"/team/services?checkout=cancelled"});if(input.customerId)form.set("customer",input.customerId);
 const response=await fetcher("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{...stripeHeaders(),"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":"regpilot-checkout-"+input.jobId},body:form.toString(),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)}),data=await checkedJson(response,40000);
 if(typeof data.id!=="string"||!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(data.id)||typeof data.url!=="string")throw new ProviderError("INVALID_RESPONSE");const url=new URL(data.url);if(url.origin!=="https://checkout.stripe.com"||url.username||url.password)throw new ProviderError("UNSAFE_CHECKOUT");
 return {providerId:data.id,url:url.href,status:"AWAITING_CUSTOMER_CHECKOUT",limitation:"Returning from checkout does not activate services or prove payment. Subscription state comes from verified events."};
}
export async function readSubscription(id:string,fetcher:typeof fetch=fetch){if(!serviceReady("STRIPE"))throw new ProviderError("SERVICE_DISABLED");if(!/^sub_[A-Za-z0-9]+$/.test(id))throw new ProviderError("INVALID_SUBSCRIPTION");return checkedJson(await fetcher("https://api.stripe.com/v1/subscriptions/"+id,{headers:stripeHeaders(),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)}),80000);}
export async function createPortal(customerId:string,requestId:string,fetcher:typeof fetch=fetch){if(!serviceReady("STRIPE"))throw new ProviderError("SERVICE_DISABLED");if(!/^cus_[A-Za-z0-9]+$/.test(customerId))throw new ProviderError("INVALID_CUSTOMER");const data=await checkedJson(await fetcher("https://api.stripe.com/v1/billing_portal/sessions",{method:"POST",headers:{...stripeHeaders(),"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":"regpilot-portal-"+requestId},body:new URLSearchParams({customer:customerId,return_url:appOrigin()+"/team/services"}).toString(),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)}),40000);const url=new URL(data.url);if(url.origin!=="https://billing.stripe.com"||url.username||url.password)throw new ProviderError("UNSAFE_PORTAL");return {url:url.href};}
