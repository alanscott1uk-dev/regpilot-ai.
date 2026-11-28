import "./helpers/paid-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHmac} from "node:crypto";
import {db} from "../lib/server/db";
import {transaction} from "../lib/server/intelligence-service";
import {reservePaid,setPaidBudget} from "../lib/server/paid-budget";
import {prepareServiceJob,queueServiceJob,claimServiceJob,executeServiceJob,servicesWorkspace,redactServiceJob,generateReminderJobs} from "../lib/server/paid-service";
import {handleStripeEvent,billingPortal} from "../lib/server/billing-service";
import {createEvidence,reviewEvidence} from "../lib/server/evidence-service";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";
import type {AuthorizedContext} from "../lib/server/authorization";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";

test("paid-service workflows: inert drafts, atomic budgets, approved OCR, owned reminders, tenant fencing and signed billing",async()=>{
 const suffix=randomUUID(),users=await Promise.all(["owner","reviewer","recipient","outside"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}}))),orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional paid services "+n+suffix}}))),ids=orgs.map(o=>o.id);
 const owner:AuthorizedContext={organizationId:ids[0],userId:users[0].id,role:"OWNER"},reviewer:AuthorizedContext={...owner,userId:users[1].id,role:"ADMIN"},recipient:AuthorizedContext={...owner,userId:users[2].id,role:"EDITOR"},outside:AuthorizedContext={organizationId:ids[1],userId:users[3].id,role:"OWNER"};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_APP_ORIGIN:"https://app.example.invalid",REGPILOT_OCR_ENABLED:"true",AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:"https://fixture.cognitiveservices.azure.com",AZURE_DOCUMENT_INTELLIGENCE_KEY:"fictional-key",REGPILOT_EMAIL_ENABLED:"true",RESEND_API_KEY:"fictional-key",REGPILOT_EMAIL_FROM:"reminders@example.invalid",REGPILOT_STRIPE_ENABLED:"true",STRIPE_SECRET_KEY:"sk_test_fictional",STRIPE_WEBHOOK_SECRET:"whsec_fictional",STRIPE_PRICE_ID:"price_fictional",REGPILOT_OCR_RESERVE_MICROS:"1000",REGPILOT_EMAIL_RESERVE_MICROS:"1000",REGPILOT_STRIPE_RESERVE_MICROS:"1000"});
 const objects=new Map<string,Uint8Array>(),store:EvidenceObjectStore={async put(k,b){objects.set(k,Uint8Array.from(b));},async get(k){return Uint8Array.from(objects.get(k)!);},async remove(k){objects.delete(k);}};
 const task=()=>db.obligation.create({data:{organizationId:ids[0],title:"Fictional private task",category:"Testing",ownerName:users[2].email,assigneeId:recipient.userId,dueDate:new Date("2020-01-01")}});
 try{
  await db.membership.createMany({data:[owner,reviewer,recipient,outside]});const initial=await task();
  const e=await createEvidence(recipient,initial.id,"fictional.pdf",fixturePdf([["Fictional scanned record requiring human review."]]),{storage:store,scan:async()=>({status:"CLEAN",engine:"fixture"})});
  await assert.rejects(()=>prepareServiceJob(owner,{kind:"OCR",targetId:e.id},store),(x:any)=>x.status===409);
  await reviewEvidence(reviewer,e.id,{decision:"APPROVED",version:1,notes:"Independently inspected the fictional original PDF and its intended test scope."},store);
  process.env.REGPILOT_PAID_SERVICES_ENABLED="false";
  const ocr=await prepareServiceJob(owner,{kind:"OCR",targetId:e.id},store),email=await prepareServiceJob(owner,{kind:"EMAIL",targetId:initial.id}),checkout=await prepareServiceJob(owner,{kind:"STRIPE"});
  assert.equal(ocr.status,"DRAFT");assert.equal((await prepareServiceJob(owner,{kind:"OCR",targetId:e.id},store)).id,ocr.id);
  await assert.rejects(()=>queueServiceJob(owner,ocr.id,1,true),(x:any)=>x.status===503);assert.equal(await claimServiceJob(),null);assert.equal(await db.paidReservation.count({where:{organizationId:ids[0]}}),0);
  assert.equal((await generateReminderJobs()).created,0);await assert.rejects(()=>prepareServiceJob(outside,{kind:"OCR",targetId:e.id},store),(x:any)=>x.status===409);await assert.rejects(()=>prepareServiceJob(recipient,{kind:"EMAIL",targetId:initial.id}),(x:any)=>x.status===403);
  await setPaidBudget(owner,1500,0);process.env.REGPILOT_PAID_SERVICES_ENABLED="true";
  const reservations=await Promise.allSettled([transaction(owner,tx=>reservePaid(tx,owner,"EMAIL","limit-a")),transaction(owner,tx=>reservePaid(tx,owner,"EMAIL","limit-b"))]);assert.equal(reservations.filter(r=>r.status==="fulfilled").length,1);assert.equal(await db.paidReservation.count({where:{organizationId:ids[0]}}),1);
  await setPaidBudget(owner,1000000,1);
  const repeats=await Promise.all([transaction(owner,tx=>reservePaid(tx,owner,"EMAIL","same-operation")),transaction(owner,tx=>reservePaid(tx,owner,"EMAIL","same-operation"))]);assert.equal(repeats[0].id,repeats[1].id);
  process.env.REGPILOT_PAID_PLATFORM_MONTHLY_MICROS="2000";await assert.rejects(()=>transaction(outside,tx=>reservePaid(tx,outside,"EMAIL","platform-limit")),(x:any)=>x.status===429);process.env.REGPILOT_PAID_PLATFORM_MONTHLY_MICROS="2000000000";
  await assert.rejects(()=>transaction(owner,tx=>reservePaid(tx,owner,"OCR","same-operation")),(x:any)=>x.status===409);
  await assert.rejects(()=>setPaidBudget(reviewer,1000,2),(x:any)=>x.status===403);
  await assert.rejects(()=>queueServiceJob(owner,ocr.id,1,false),(x:any)=>x.status===400);
  await assert.rejects(()=>queueServiceJob(outside,ocr.id,1,true),(x:any)=>x.status===409);
  await queueServiceJob(owner,ocr.id,1,true);await queueServiceJob(owner,email.id,1,true);await queueServiceJob(owner,checkout.id,1,true);
  const jobs=await Promise.all([claimServiceJob(),claimServiceJob(),claimServiceJob()]);assert.equal(new Set(jobs.map(j=>j!.id)).size,3);
  let sent=0,starts=0;const operation="https://fixture.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-read/analyzeResults/"+randomUUID()+"?api-version=2024-11-30";
  for(const job of jobs){assert.ok(job);const outcome=await executeServiceJob(job,{storage:store,start:async(bytes,pages)=>{starts++;assert.ok(bytes.length);assert.equal(pages,1);return operation;},email:async input=>{sent++;assert.equal(input.recipient,users[2].email);return {providerId:"mail_fixture",status:"ACCEPTED_BY_PROVIDER",limitation:"Fixture"};},checkout:async input=>{assert.equal(input.organizationId,ids[0]);return {providerId:"cs_test_fictional",url:"https://checkout.stripe.com/c/pay/fictional",status:"AWAITING_CUSTOMER_CHECKOUT",limitation:"Fixture"};}});assert.equal(outcome,job.kind==="OCR"?"POLLING":"SUCCEEDED");}
  assert.equal(starts,1);assert.equal(sent,1);assert.equal(await executeServiceJob(jobs[0]!,{start:async()=>{throw Error("replay must not run");}}),"SUPERSEDED");
  await db.serviceJob.update({where:{id:ocr.id},data:{leaseUntil:new Date(0)}});const pending=(await claimServiceJob())!;assert.equal(await executeServiceJob(pending,{poll:async()=>null}),"POLLING");await db.serviceJob.update({where:{id:ocr.id},data:{leaseUntil:new Date(0)}});const finishing=(await claimServiceJob())!;
  assert.equal(await executeServiceJob(finishing,{poll:async()=>({engine:"fixture-ocr",pages:[{page:1,text:"Fictional OCR draft"}],characters:20,pageCount:1,limitations:["Fixture only"]})}),"SUCCEEDED");
  const view=await servicesWorkspace(owner);assert.equal(view.jobs.find(j=>j.id===ocr.id)?.status,"SUCCEEDED");assert.doesNotMatch(JSON.stringify(view),/fictional-key|whsec_fictional|leaseToken/);assert.equal((await servicesWorkspace(outside)).jobs.length,0);
  // Owner-authorised recurring reminder policy deduplicates concurrent worker runs.
  await task();await task();await setPaidBudget(owner,1000000,2,true);const generated=await Promise.all([generateReminderJobs(),generateReminderJobs()]);assert.equal(generated.reduce((sum,r)=>sum+r.created,0),2);
  const automatic=await db.serviceJob.findMany({where:{organizationId:ids[0],status:"QUEUED",kind:"EMAIL"}});assert.equal(automatic.length,2);for(const job of automatic)await redactServiceJob(owner,job.id,job.version);
  // Reassignment between queueing and collection prevents delivery to the previous owner.
  const reassignedTask=await task(),reassigned=await prepareServiceJob(owner,{kind:"EMAIL",targetId:reassignedTask.id});await queueServiceJob(owner,reassigned.id,1,true);await db.obligation.update({where:{id:reassignedTask.id},data:{assigneeId:reviewer.userId}});assert.equal(await executeServiceJob((await claimServiceJob())!,{email:async()=>{throw Error("must not send");}}),"ATTENTION");
  // Redaction during an external operation fences its returned content.
  const redactTask=await task(),redact=await prepareServiceJob(owner,{kind:"EMAIL",targetId:redactTask.id});await queueServiceJob(owner,redact.id,1,true);const redacting=(await claimServiceJob())!;assert.equal(await executeServiceJob(redacting,{email:async()=>{await redactServiceJob(owner,redact.id,redacting.version);return {providerId:"mail_late",status:"ACCEPTED_BY_PROVIDER",limitation:"Fixture"};}}),"SUPERSEDED");assert.equal((await db.serviceJob.findUniqueOrThrow({where:{id:redact.id}})).result,null);
  const revokedTask=await task(),revoked=await prepareServiceJob(owner,{kind:"EMAIL",targetId:revokedTask.id});await queueServiceJob(owner,revoked.id,1,true);const revoking=(await claimServiceJob())!;
  assert.equal(await executeServiceJob(revoking,{email:async()=>{await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"VIEWER"}});return {providerId:"mail_revoked",status:"ACCEPTED_BY_PROVIDER",limitation:"Fixture"};}}),"ATTENTION");assert.equal((await db.serviceJob.findUniqueOrThrow({where:{id:revoked.id}})).result,null);await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"OWNER"}});
  // Signed events are bound to the server-created checkout; replay and old events do not grant access.
  const now=Math.floor(Date.now()/1000),sub={id:"sub_fictional",customer:"cus_fictional",livemode:false,status:"active",metadata:{organizationId:ids[0],jobId:checkout.id}};
  const event=(id:string,type:string,created=now)=>({id,type,created,livemode:false,data:{object:type==="checkout.session.completed"?{id:"cs_test_fictional",subscription:sub.id,client_reference_id:ids[0],metadata:sub.metadata}:{id:sub.id,metadata:sub.metadata}}});
  const send=async(value:any,subscription=sub)=>{const body=JSON.stringify(value),sig="t="+now+",v1="+createHmac("sha256","whsec_fictional").update(now+"."+body).digest("hex");return handleStripeEvent(body,sig,async()=>subscription);};
  await send(event("evt_first","checkout.session.completed"));assert.equal((await db.billingAccount.findUniqueOrThrow({where:{organizationId:ids[0]}})).status,"active");assert.equal((await send(event("evt_first","checkout.session.completed"))).duplicate,true);
  await send(event("evt_old","customer.subscription.updated",now-1),{...sub,status:"past_due"});assert.equal((await db.billingAccount.findUniqueOrThrow({where:{organizationId:ids[0]}})).status,"active");
  await assert.rejects(()=>send(event("evt_wrong","customer.subscription.updated"),{...sub,metadata:{...sub.metadata,organizationId:ids[1]}}));
  await assert.rejects(()=>billingPortal(reviewer,async()=>{throw Error("must not call");}),(x:any)=>x.status===403);const portal=await billingPortal(owner,async customer=>{assert.equal(customer,"cus_fictional");return {url:"https://billing.stripe.com/p/session/fixture"};});assert.match(portal.url,/billing.stripe.com/);
  await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"ADMIN"}});const demoted=await servicesWorkspace(owner);assert.equal(demoted.role,"ADMIN");assert.equal(demoted.billing,null);assert.ok(demoted.jobs.every(j=>j.kind!=="STRIPE"));await assert.rejects(()=>redactServiceJob(owner,checkout.id,2),(x:any)=>x.status===403);await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"OWNER"}});
  await assert.rejects(()=>prepareServiceJob(owner,{kind:"STRIPE"}),(x:any)=>x.status===409);assert.equal(await db.membership.count({where:{organizationId:ids[0]}}),3,"billing never changes membership");
  await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"VIEWER"}});assert.equal((await generateReminderJobs()).paused,1);await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:owner.userId}},data:{role:"OWNER"}});
  await redactServiceJob(owner,ocr.id,(await db.serviceJob.findUniqueOrThrow({where:{id:ocr.id}})).version);assert.equal((await db.serviceJob.findUniqueOrThrow({where:{id:ocr.id}})).result,null);
  process.env.REGPILOT_PAID_SERVICES_ENABLED="false";await assert.rejects(()=>send(event("evt_disabled","customer.subscription.updated")),(x:any)=>x.status===503);
  const audit=await db.auditEvent.findMany({where:{organizationId:ids[0]}});assert.doesNotMatch(JSON.stringify(audit),/Fictional OCR draft|fictional-key|whsec_/);
 }finally{for(const name of ["billingEvent","billingAccount","serviceJob","paidReservation","paidBudget","auditEvent","evidence","obligation","membership"] as const)await (db[name] as any).deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});}
});
