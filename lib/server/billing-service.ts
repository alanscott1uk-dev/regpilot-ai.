import {createPortal as defaultPortal} from "../services/stripe";
import {requireMember} from "./workspace-member";
import {reservePaid} from "./paid-budget";
import {transaction,IntelligenceError} from "./intelligence-service";
import {db} from "./db";
import {verifyStripeEvent,readSubscription} from "../services/stripe";
import {serviceReady} from "../services/config";
import {ProviderError} from "../services/http";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function handleStripeEvent(body:string,signature:string,lookup:typeof readSubscription=readSubscription){
 if(!serviceReady("STRIPE"))throw new IntelligenceError("Billing awaits activation",503);
 const event=verifyStripeEvent(body,signature),object=event.data.object;
 if(await db.billingEvent.findUnique({where:{id:event.id}}))return {received:true,duplicate:true};
 if(!["checkout.session.completed","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type))return {received:true,ignored:true};
 const jobId=object.metadata?.jobId,org=object.metadata?.organizationId;if(!uuid.test(jobId||"")||!uuid.test(org||""))return {received:true,ignored:true};
 const job=await db.serviceJob.findFirst({where:{id:jobId,organizationId:org,kind:"STRIPE"}});if(!job)return {received:true,ignored:true};
 if(!job.providerId)throw new IntelligenceError("Checkout correlation is pending",503);
 if(event.type==="checkout.session.completed"&&(object.id!==job.providerId||object.client_reference_id!==org))throw new ProviderError("BILLING_SCOPE_MISMATCH");
 const subId=event.type==="checkout.session.completed"?object.subscription:object.id;if(typeof subId!=="string"||!/^sub_[A-Za-z0-9]+$/.test(subId))throw new ProviderError("INVALID_SUBSCRIPTION");
 const subscription=await lookup(subId);
 if(subscription.id!==subId||subscription.metadata?.organizationId!==org||subscription.metadata?.jobId!==job.id||typeof subscription.customer!=="string"||!/^cus_[A-Za-z0-9]+$/.test(subscription.customer)||subscription.livemode!==event.livemode||!["incomplete","incomplete_expired","trialing","active","past_due","canceled","unpaid","paused"].includes(subscription.status))throw new ProviderError("BILLING_SCOPE_MISMATCH");
 return transaction({organizationId:org,userId:job.createdById,role:"OWNER"},async tx=>{
  if(!serviceReady("STRIPE"))throw new IntelligenceError("Billing activation changed",503);
  if(await tx.billingEvent.findUnique({where:{id:event.id}}))return {received:true,duplicate:true};
  const account=await tx.billingAccount.findUnique({where:{organizationId:org}});
  // Do not let a second subscription or another customer silently replace a binding.
  if(account&&(account.customerId!==subscription.customer||account.subscriptionId&&account.subscriptionId!==subId))throw new ProviderError("BILLING_SCOPE_MISMATCH");
  await tx.billingEvent.create({data:{id:event.id,organizationId:org,eventType:event.type}});
  if(!account||event.created>=account.lastEventAt)await tx.billingAccount.upsert({where:{organizationId:org},create:{organizationId:org,customerId:subscription.customer,subscriptionId:subId,status:subscription.status,lastEventAt:event.created},update:{status:subscription.status,lastEventAt:event.created}});
  await tx.auditEvent.create({data:{organizationId:org,actorId:job.createdById,action:"billing.subscription_observed",entityType:"BillingAccount",entityId:org,details:{eventId:event.id,status:subscription.status}}});
  return {received:true};
 });
}
export async function billingPortal(ctx:import("./authorization").AuthorizedContext,create:typeof import("../services/stripe").createPortal=defaultPortal){
 if(!serviceReady("STRIPE"))throw new IntelligenceError("Billing awaits activation",503);const id=crypto.randomUUID();
 const account=await transaction(ctx,async tx=>{await requireMember(tx,ctx,["OWNER"]);const row=await tx.billingAccount.findUnique({where:{organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError("No billing account",404);await reservePaid(tx,ctx,"STRIPE","portal:"+id);return row;});
 const result=await create(account.customerId,id);await transaction(ctx,tx=>requireMember(tx,ctx,["OWNER"]));if(!serviceReady("STRIPE"))throw new IntelligenceError("Billing activation changed",503);return result;
}
