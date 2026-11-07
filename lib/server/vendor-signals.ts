import {Prisma,type EvidenceConnector} from "@prisma/client";
import {z} from "zod";
import {IntelligenceError} from "./intelligence-service";
import {hashValue} from "../regulatory/intelligence";
import {observationCurrent} from "../connectors/observation";
import {connectorProviderEnabled} from "./connector-flags";
import {allowedEmail} from "../ai/security.mjs";
import type {AuthorizedContext} from "./authorization";
const observationSchema=z.object({engine:z.literal("companies-house-profile-1.0.0"),sourceUrl:z.url(),capturedAt:z.iso.datetime(),checks:z.array(z.object({id:z.string().max(80),label:z.string().max(200),status:z.enum(["PASS","FAIL","UNKNOWN"]),observed:z.string().max(500),nextStep:z.string().max(1000)})).min(1).max(20),limitations:z.array(z.string().max(1500)).max(10)});
export const vendorSignalSchema=z.object({connectorId:z.uuid(),configVersion:z.number().int().positive(),signalHash:z.string().length(64),runId:z.uuid(),capturedAt:z.iso.datetime(),resultHash:z.string().length(64),observation:observationSchema});
export async function vendorSignal(tx:Prisma.TransactionClient,organizationId:string,id:string){
 const c=await tx.evidenceConnector.findFirst({where:{id,organizationId,provider:"COMPANIES_HOUSE"},include:{runs:{orderBy:[{capturedAt:"desc"},{id:"desc"}],take:1}}});
 if(!c)throw new IntelligenceError("Linked Companies House connection is unavailable",409);
 const run=c.runs[0];if(!run)return {current:false,reason:"Waiting for the first successful collection",snapshot:null,companyNumber:c.repository.slice(15)};
 if(hashValue(run.result)!==run.resultHash)throw new IntelligenceError("Supplier signal integrity check failed",409);
 const o=observationSchema.parse(run.result);
 if(o.sourceUrl!=="https://find-and-update.company-information.service.gov.uk/company/"+c.repository.slice(15)||hashValue({engine:o.engine,checks:o.checks})!==run.signalHash)throw new IntelligenceError("Supplier signal identity or integrity changed",409);
 const current=connectorProviderEnabled(c.provider)&&observationCurrent(run,c,true);
 return {current,reason:current?"Current register observation":c.failureCode?"Collection failed; earlier observation is historical":!c.enabled||!connectorProviderEnabled(c.provider)?"Collection is paused or awaiting activation":"Observation is stale or belongs to earlier connection settings",companyNumber:c.repository.slice(15),snapshot:vendorSignalSchema.parse({connectorId:c.id,configVersion:run.configVersion,signalHash:run.signalHash,runId:run.id,capturedAt:run.capturedAt.toISOString(),resultHash:run.resultHash,observation:o})};
}
export function sameVendorSignal(a:z.infer<typeof vendorSignalSchema>,b:z.infer<typeof vendorSignalSchema>){return a.connectorId===b.connectorId&&a.configVersion===b.configVersion&&a.signalHash===b.signalHash;}
/** One owned investigation for a signal and accepted-review baseline, including collection failures. */
export async function followUpVendorSignals(tx:Prisma.TransactionClient,ctx:AuthorizedContext,job:EvidenceConnector,fingerprint:string,failed=false){
 if(job.provider!=="COMPANIES_HOUSE")return;
 const vendors=await tx.vendor.findMany({where:{organizationId:ctx.organizationId,active:true,signalConnectorId:job.id},include:{owner:{select:{email:true}},reviews:{where:{status:"ACCEPTED"},orderBy:{createdAt:"desc"},take:1,select:{id:true,signalSnapshot:true,vendorVersion:true,validUntil:true}}},take:201});
 if(vendors.length>200)throw new IntelligenceError("Supplier monitoring scope exceeds the supported bound",409);
 for(const v of vendors){
  const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:v.ownerId}}});if(!owner||owner.role==="VIEWER"||!allowedEmail(v.owner.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))continue;
  const previous=v.reviews[0],reviewed=previous?.signalSnapshot?vendorSignalSchema.parse(previous.signalSnapshot):null;
  if(!failed&&previous?.vendorVersion===v.version&&previous.validUntil.toISOString().slice(0,10)>=new Date().toISOString().slice(0,10)&&reviewed?.connectorId===job.id&&reviewed.configVersion===job.version&&reviewed.signalHash===fingerprint)continue;
  const automationKey=hashValue({kind:"vendor-register-signal",vendorId:v.id,vendorVersion:v.version,connectorVersion:job.version,fingerprint,failed,baselineReviewId:previous?.id||null});
  if(await tx.obligation.findUnique({where:{organizationId_automationKey:{organizationId:ctx.organizationId,automationKey}}}))continue;
  const task=await tx.obligation.create({data:{organizationId:ctx.organizationId,vendorSignalId:v.id,automationKey,title:("Review supplier register signal: "+v.name).slice(0,160),category:"Supplier register monitoring",assigneeId:v.ownerId,ownerName:v.owner.email,dueDate:new Date(),notes:failed?"Collection is unavailable. Inspect the connection and register, then prepare an independent supplier review; previous observations may be stale.":"The latest public register signals have not been accepted in a current supplier review. Verify the exact legal entity and changes, assess the supporting evidence and obtain independent sign-off. Register signals do not establish creditworthiness or predict failure."}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:"Vendor",entityId:v.id,action:"vendor.signal_follow_up",details:{taskId:task.id,connectorId:job.id,failed}}});
 }
}
