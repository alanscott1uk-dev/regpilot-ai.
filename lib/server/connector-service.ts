import {collectVercel,collectSupabase,vercelTarget,supabaseTarget} from "../connectors/infrastructure";
import {followUpVendorSignals} from "./vendor-signals";
import {Prisma,type EvidenceConnector} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {connectorsEnabled,microsoft365Enabled,googleWorkspaceEnabled,gitlabEnabled,cloudflareEnabled,companiesHouseEnabled,vercelEnabled,supabaseEnabled,connectorProviderEnabled} from "./connector-flags";
export {connectorsEnabled,microsoft365Enabled,googleWorkspaceEnabled,gitlabEnabled,cloudflareEnabled,companiesHouseEnabled,vercelEnabled,supabaseEnabled} from "./connector-flags";
import {collectGitlab,gitlabTarget} from "../connectors/gitlab";
import {collectCloudflare,cloudflareTarget} from "../connectors/cloudflare";
import {collectCompaniesHouse,companiesHouseTarget} from "../connectors/companies-house";
import {validCredential} from "../connectors/bounded-http";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {encryptConnectorSecret,decryptConnectorSecret} from "./connector-secret";
import {collectGithub,githubTarget,CollectionError} from "../connectors/github";
import {collectGoogleWorkspace,googleTarget,googleCredentials} from "../connectors/google-workspace";
import {collectMicrosoft365,microsoftTarget} from "../connectors/microsoft365";
import {observationOutcome,observationCurrent,signalChanges,type Observation} from "../connectors/observation";
import {hashValue} from "../regulatory/intelligence";
const j=(v:unknown)=>v as Prisma.InputJsonValue;

const schema=githubTarget.extend({provider:z.literal("GITHUB").default("GITHUB"),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),token:z.string().regex(/^github_pat_[A-Za-z0-9_]{20,240}$/).optional(),enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)])});


const googleSchema=googleTarget.extend({provider:z.literal("GOOGLE_WORKSPACE"),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),clientSecret:googleCredentials.shape.clientSecret.optional(),refreshToken:googleCredentials.shape.refreshToken.optional(),enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)]),consent:z.literal(true)}).refine(v=>!!v.clientSecret===!!v.refreshToken,"Rotate both Google credentials together");
const microsoftSchema=microsoftTarget.extend({provider:z.literal("MICROSOFT365"),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),clientSecret:z.string().min(16).max(512).regex(/^[^\r\n\0]+$/).optional(),enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)]),consent:z.literal(true)});
const extraFields={controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),token:z.string().refine(validCredential).optional(),enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)]),consent:z.literal(true)};
const extraSchema=z.discriminatedUnion("provider",[
 vercelTarget.extend({...extraFields,provider:z.literal("VERCEL")}),
 supabaseTarget.extend({...extraFields,provider:z.literal("SUPABASE")}),
 gitlabTarget.extend({...extraFields,provider:z.literal("GITLAB")}),
 cloudflareTarget.extend({...extraFields,provider:z.literal("CLOUDFLARE")}),
 companiesHouseTarget.extend({...extraFields,provider:z.literal("COMPANIES_HOUSE")})
]);
type Collector=(target:{provider?:string;repository:string;branch:string},secret:string)=>Promise<Observation>;
export const collectConfiguredConnector:Collector=async(target,secret)=>{
 if(!connectorProviderEnabled(target.provider||"GITHUB"))throw new CollectionError("PROVIDER_DISABLED");
 if(target.provider==="VERCEL"&&target.repository.startsWith("vercel:"))return collectVercel({projectId:target.repository.slice(7),teamId:target.branch},secret);
 if(target.provider==="SUPABASE"&&target.repository.startsWith("supabase:"))return collectSupabase({projectRef:target.repository.slice(9),providerOrganizationId:target.branch},secret);
 if(target.provider==="GITHUB"||target.provider===undefined)return collectGithub(target,secret);
 if(target.provider==="GITLAB"&&target.repository.startsWith("gitlab:"))return collectGitlab({projectPath:target.repository.slice(7),branch:target.branch},secret);
 if(target.provider==="CLOUDFLARE"&&target.repository.startsWith("cloudflare:"))return collectCloudflare({zoneId:target.repository.slice(11),accountId:target.branch},secret);
 if(target.provider==="COMPANIES_HOUSE"&&target.repository.startsWith("companieshouse:"))return collectCompaniesHouse({companyNumber:target.repository.slice(15)},secret);
 if(target.provider==="MICROSOFT365"){
  if(!microsoft365Enabled())throw new CollectionError("PROVIDER_DISABLED");
  if(!target.repository.startsWith("microsoft365:"))throw new CollectionError("INVALID_TARGET");
  return collectMicrosoft365({tenantId:target.repository.slice(13),clientId:target.branch},secret);
 }
 if(target.provider==="GOOGLE_WORKSPACE"){
  if(!googleWorkspaceEnabled())throw new CollectionError("PROVIDER_DISABLED");
  if(!target.repository.startsWith("googleworkspace:"))throw new CollectionError("INVALID_TARGET");
  return collectGoogleWorkspace({customerId:target.repository.slice(16),clientId:target.branch},secret);
 }
 throw new CollectionError("PROVIDER_UNSUPPORTED");
};
export async function saveConnector(ctx:AuthorizedContext,input:unknown){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence connectors await activation",503);
 const provider=(input as {provider?:string})?.provider,microsoft=provider==="MICROSOFT365",google=provider==="GOOGLE_WORKSPACE",extra=["GITLAB","CLOUDFLARE","COMPANIES_HOUSE","VERCEL","SUPABASE"].includes(provider||"");
 const parsed=(extra?extraSchema:google?googleSchema:microsoft?microsoftSchema:schema).safeParse(input);if(!parsed.success)throw new IntelligenceError("Check the provider, target, credentials, control and version");
 if(microsoft&&!microsoft365Enabled())throw new IntelligenceError("Microsoft 365 collection awaits activation",503);
 if(google&&!googleWorkspaceEnabled())throw new IntelligenceError("Google Workspace collection awaits activation",503);
 if(extra&&!connectorProviderEnabled(provider!))throw new IntelligenceError("This provider awaits activation",503);
 const raw=parsed.data;if(raw.provider==="COMPANIES_HOUSE"&&raw.token?.includes(":"))throw new IntelligenceError("Use a valid Companies House API key");
 const v=raw.provider==="VERCEL"?{...raw,repository:"vercel:"+raw.projectId,branch:raw.teamId}:raw.provider==="SUPABASE"?{...raw,repository:"supabase:"+raw.projectRef,branch:raw.providerOrganizationId}:raw.provider==="GITLAB"?{...raw,repository:"gitlab:"+raw.projectPath}:raw.provider==="CLOUDFLARE"?{...raw,repository:"cloudflare:"+raw.zoneId.toLowerCase(),branch:raw.accountId.toLowerCase()}:raw.provider==="COMPANIES_HOUSE"?{...raw,repository:"companieshouse:"+raw.companyNumber,branch:"profile"}:raw.provider==="MICROSOFT365"?{...raw,repository:"microsoft365:"+raw.tenantId.toLowerCase(),branch:raw.clientId.toLowerCase(),token:raw.clientSecret}:raw.provider==="GOOGLE_WORKSPACE"?{...raw,repository:"googleworkspace:"+raw.customerId,branch:raw.clientId,token:raw.clientSecret?JSON.stringify({clientSecret:raw.clientSecret,refreshToken:raw.refreshToken}):undefined}:raw;
 const repository=google||raw.provider==="COMPANIES_HOUSE"||raw.provider==="VERCEL"?v.repository:v.repository.toLowerCase();
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);
  const control=await tx.managedControl.findFirst({where:{id:v.controlId,organizationId:ctx.organizationId,enabled:true}});if(!control)throw new IntelligenceError("Choose an active control from this organisation",404);
  const old=v.id?await tx.evidenceConnector.findFirst({where:{id:v.id,organizationId:ctx.organizationId}}):null;
  if(v.id&&!old)throw new IntelligenceError("Connector not found",404);
  if(old&&old.provider!==v.provider)throw new IntelligenceError("Create a separate connection when changing provider",409);
  if((old?.version||0)!==v.version)throw new IntelligenceError("Connector settings changed",409);
  if(!v.token&&!old?.encryptedSecret)throw new IntelligenceError("A restricted provider credential is required");
  if(old&&!v.token&&(old.repository!==repository||old.branch!==v.branch))throw new IntelligenceError("Supply a newly scoped credential when changing target");
  if(!old&&await tx.evidenceConnector.count({where:{organizationId:ctx.organizationId}})>=20)throw new IntelligenceError("Connector limit reached",429);
  const id=old?.id||randomUUID();const data={provider:v.provider,controlId:v.controlId,repository,branch:v.branch,configuredById:ctx.userId,enabled:v.enabled,intervalHours:v.intervalHours,encryptedSecret:v.token?encryptConnectorSecret(v.token,ctx.organizationId,id):old!.encryptedSecret,nextRunAt:new Date(),leaseToken:null,leaseUntil:null,attempts:0,failureCode:null};
  if(!old&&await tx.evidenceConnector.findUnique({where:{organizationId_repository_branch:{organizationId:ctx.organizationId,repository:data.repository,branch:data.branch}}}))throw new IntelligenceError("This target already has a connector",409);
  const saved=old?await tx.evidenceConnector.update({where:{id},data:{...data,version:{increment:1}}}):await tx.evidenceConnector.create({data:{id,organizationId:ctx.organizationId,...data}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.configured",entityType:"EvidenceConnector",entityId:id,details:{version:saved.version,controlId:v.controlId,enabled:v.enabled,credentialRotated:!!v.token}}});return {id,version:saved.version};
 });
}
export async function disconnectConnector(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const changed=await tx.evidenceConnector.updateMany({where:{id,organizationId:ctx.organizationId,version},data:{enabled:false,encryptedSecret:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Connector changed",409);await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.disconnected",entityType:"EvidenceConnector",entityId:id,details:{}}});return {id};});}
export async function requestConnectorRun(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version,enabled:true}});if(!row)throw new IntelligenceError("Active connector not found or changed",409);if(row.leaseUntil&&row.leaseUntil>new Date())throw new IntelligenceError("A collection is already running",409);if(row.lastSuccessAt&&Date.now()-row.lastSuccessAt.getTime()<300000)throw new IntelligenceError("Wait five minutes between successful collections",429);await tx.evidenceConnector.update({where:{id},data:{nextRunAt:new Date()}});return {id};});}
/**
 * Read-only, operator-triggered LIVE provider verification.
 * Claims only the exact organisation-scoped connection, never an unrelated queued job.
 * Reuses the normal encrypted-secret collector, lease fencing, evidence and audit path.
 * A successful observation verifies connectivity/target at that moment, not compliance.
 */
export async function verifyConnectorNow(ctx:AuthorizedContext,id:string,version:number,collector:Collector=collectConfiguredConnector){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence collectors await activation",503);
 if(!z.uuid().safeParse(id).success||!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid connector selection");
 const now=new Date(),token=randomUUID();
 const job=await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const record=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version}});
  if(!record)throw new IntelligenceError("Connection not found or settings changed",404);
  if(!record.enabled||!connectorProviderEnabled(record.provider)||!record.encryptedSecret)throw new IntelligenceError("Active provider and credential required",409);
  if(record.lastSuccessAt&&now.getTime()-record.lastSuccessAt.getTime()<300000)throw new IntelligenceError("Wait five minutes before another successful verification",429);
  const claim=await tx.evidenceConnector.updateMany({where:{
   id,organizationId:ctx.organizationId,version,enabled:true,encryptedSecret:{not:null},
   OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]
  },data:{leaseToken:token,leaseUntil:new Date(now.getTime()+90000),attempts:{increment:1},nextRunAt:now}});
  if(claim.count!==1)throw new IntelligenceError("This connection is already being verified or was changed",409);
  return tx.evidenceConnector.findUniqueOrThrow({where:{id}});
 });
 const outcome=await executeConnector(job,collector);
 return {connectorId:id,version,observed:outcome==="OBSERVED"||outcome==="FOLLOW_UP"||outcome==="INCOMPLETE",
  outcome,verifiedAt:new Date().toISOString(),
  note:"Read-only observation only. Inspect the saved signals, collection limits, and required human review."};
}
export async function claimConnector():Promise<EvidenceConnector|null>{
 if(!connectorsEnabled())return null;const token=randomUUID(),microsoft=microsoft365Enabled(),google=googleWorkspaceEnabled(),gitlab=gitlabEnabled(),cloudflare=cloudflareEnabled(),registry=companiesHouseEnabled(),vercel=vercelEnabled(),supabase=supabaseEnabled();const rows=await db.$queryRaw<EvidenceConnector[]>`WITH due AS (SELECT id FROM "EvidenceConnector" WHERE enabled=true AND (provider='GITHUB' OR (provider='MICROSOFT365' AND ${microsoft}) OR (provider='GOOGLE_WORKSPACE' AND ${google}) OR (provider='GITLAB' AND ${gitlab}) OR (provider='CLOUDFLARE' AND ${cloudflare}) OR (provider='COMPANIES_HOUSE' AND ${registry}) OR (provider='VERCEL' AND ${vercel}) OR (provider='SUPABASE' AND ${supabase})) AND "encryptedSecret" IS NOT NULL AND "nextRunAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW()) ORDER BY "nextRunAt",id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "EvidenceConnector" c SET "leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',attempts=c.attempts+1,"updatedAt"=NOW() FROM due WHERE c.id=due.id RETURNING c.*`;return rows[0]||null;
}
class Superseded extends Error{}
async function followUp(tx:Prisma.TransactionClient,job:EvidenceConnector,reason:string){
 const control=await tx.managedControl.findFirst({where:{id:job.controlId,organizationId:job.organizationId,enabled:true},include:{owner:{select:{email:true}}}});
 if(!control)return false;
 const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:job.organizationId,userId:control.ownerId}}});
 if(!owner||owner.role==="VIEWER")return false;
 if(await tx.obligation.findFirst({where:{organizationId:job.organizationId,connectorId:job.id,status:{not:"COMPLETE"}}}))return false;
 await tx.obligation.create({data:{organizationId:job.organizationId,title:("Review connected evidence: "+control.title).slice(0,160),ownerName:control.owner.email,assigneeId:control.ownerId,controlId:control.id,connectorId:job.id,category:"Automated evidence follow-up",dueDate:new Date(),notes:reason+" Review the connection history in Operations. This is an operational review target, not a legal deadline or compliance verdict."}});
 return true;
}
async function assertJob(tx:Prisma.TransactionClient,job:EvidenceConnector){
 if(!connectorProviderEnabled(job.provider))throw new Superseded();
 const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "EvidenceConnector" WHERE id=${job.id}::uuid AND "organizationId"=${job.organizationId}::uuid AND enabled=true AND version=${job.version} AND "leaseToken"=${job.leaseToken}::uuid AND "leaseUntil">NOW() FOR UPDATE`;
 if(!rows.length)throw new Superseded();
 await requireMember(tx,{organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"},ADMIN);
 const control=await tx.managedControl.findFirst({where:{id:job.controlId,organizationId:job.organizationId,enabled:true},include:{owner:{select:{email:true}}}});if(!control)throw new IntelligenceError("Control is paused",403);
 const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:job.organizationId,userId:control.ownerId}}});if(!owner||owner.role==="VIEWER")throw new IntelligenceError("Control ownership needs review",403);return control;
}
export async function executeConnector(job:EvidenceConnector,collector:Collector=collectConfiguredConnector){
 const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"};
 try{
  await transaction(ctx,tx=>assertJob(tx,job));if(job.attempts>3)throw new CollectionError("INTERRUPTED_REPEATEDLY");
  if(!job.encryptedSecret)throw new CollectionError("CREDENTIAL_UNAVAILABLE");
  const result=await collector({provider:job.provider,repository:job.repository,branch:job.branch},decryptConnectorSecret(job.encryptedSecret,job.organizationId,job.id));
  const outcome=observationOutcome(result),signalHash=hashValue({engine:result.engine,checks:result.checks});
  return await transaction(ctx,async tx=>{await assertJob(tx,job);
   const previous=await tx.connectorRun.findFirst({where:{organizationId:job.organizationId,connectorId:job.id},orderBy:[{capturedAt:"desc"},{id:"desc"}]});
   const changes=previous&&previous.configVersion===job.version&&hashValue(previous.result)===previous.resultHash?signalChanges(result,previous.result as unknown as Observation):[];
   await tx.connectorRun.create({data:{organizationId:job.organizationId,connectorId:job.id,leaseToken:job.leaseToken!,configVersion:job.version,result:j(result),resultHash:hashValue(result),signalHash,outcome}});
   if(outcome!=="OBSERVED"||changes.length)await followUp(tx,job,changes.length?"Observed signals changed since the last collection. Check the before/after values and remaining gaps.":"The collection contains failing or unknown signals requiring investigation.");
   await followUpVendorSignals(tx,ctx,job,signalHash);
   await tx.evidenceConnector.update({where:{id:job.id},data:{leaseToken:null,leaseUntil:null,attempts:0,lastSuccessAt:new Date(),failureCode:null,nextRunAt:new Date(Date.now()+job.intervalHours*3600000)}});
   await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.evidence_collected",entityType:"EvidenceConnector",entityId:job.id,details:{outcome,resultHash:hashValue(result),configVersion:job.version,changedChecks:changes.map(c=>c.id)}}});return outcome;
  });
 }catch(error){
  if(error instanceof Superseded||!connectorProviderEnabled(job.provider))return "SUPERSEDED";
  const code=error instanceof CollectionError?error.code:error instanceof IntelligenceError&&error.status===403?"PERMISSION_REVOKED":"COLLECTION_FAILED";
  const throttled=code==="RATE_LIMITED",retryAfter=error instanceof CollectionError?error.retryAfterSeconds:undefined;
  const paused=!throttled&&job.attempts>=3||code==="PERMISSION_REVOKED"||code==="CREDENTIAL_REJECTED";
  return transaction(ctx,async tx=>{const changed=await tx.evidenceConnector.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,version:job.version,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,failureCode:code,enabled:!paused,...(throttled?{attempts:Math.max(0,job.attempts-1)}:{}),nextRunAt:new Date(Date.now()+(throttled?Math.max(60,Math.min(86400,retryAfter||60))*1000:(job.attempts===1?5:30)*60000))}});if(!changed.count)return "SUPERSEDED";
   if(code!=="PERMISSION_REVOKED"&&connectorsEnabled()){
    try{await requireMember(tx,ctx,ADMIN);await followUp(tx,job,"Evidence collection failed. Earlier observations may be stale; check credentials, permissions and provider availability.");await followUpVendorSignals(tx,ctx,job,code,true);}catch(e){if(!(e instanceof IntelligenceError&&e.status===403))throw e;}
   }
   await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.collection_failed",entityType:"EvidenceConnector",entityId:job.id,details:{code,paused}}});return paused?"ATTENTION":"RETRY_SCHEDULED";
  });
 }
}
export async function runConnectorBatch(limit=2,parallelism=1){
 if(!connectorsEnabled())throw new IntelligenceError("Connectors await activation",503);
 if(!Number.isInteger(limit)||limit<1||limit>6||!Number.isInteger(parallelism)||parallelism<1||parallelism>2)
  throw new IntelligenceError("Connector worker bounds invalid",400);
 let claimed=0;const collected:Array<{index:number;outcome:string}>=[];
 const deadline=Date.now()+20000;
 async function worker(){while(connectorsEnabled()&&Date.now()<deadline&&claimed<limit){
  const index=claimed++;const job=await claimConnector();if(!job)return;
  collected.push({index,outcome:await executeConnector(job)});
 }}
 await Promise.all(Array.from({length:Math.min(limit,parallelism)},()=>worker()));
 collected.sort((a,b)=>a.index-b.index);
 return {processed:collected.length,outcomes:collected.map(x=>x.outcome),limitReached:collected.length===limit};
}
export async function exportConnectorRun(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx);const row=await tx.connectorRun.findFirst({where:{id,organizationId:ctx.organizationId},include:{connector:{select:{provider:true,version:true,enabled:true,lastSuccessAt:true,failureCode:true,intervalHours:true}}}});if(!row)throw new IntelligenceError("Observation not found",404);if(hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Observation integrity check failed",409);
  const latest=await tx.connectorRun.findFirst({where:{organizationId:ctx.organizationId,connectorId:row.connectorId},orderBy:[{capturedAt:"desc"},{id:"desc"}],select:{id:true}});
  const current=connectorProviderEnabled(row.connector.provider)&&observationCurrent(row,row.connector,latest?.id===row.id);
  return {format:"regpilot-connector-observation-v1",id:row.id,capturedAt:row.capturedAt,result:row.result,resultHash:row.resultHash,currentAtExport:!!current,limitation:"Integrity hash is not a digital signature. A point-in-time observation does not establish compliance."};
 });
}
