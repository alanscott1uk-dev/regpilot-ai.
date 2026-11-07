import {Prisma,type EvidenceConnector} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {encryptConnectorSecret,decryptConnectorSecret} from "./connector-secret";
import {collectGithub,connectorOutcome,githubTarget,CollectionError,type GithubObservation} from "../connectors/github";
import {hashValue} from "../regulatory/intelligence";
const j=(v:unknown)=>v as Prisma.InputJsonValue;
export const connectorsEnabled=()=>process.env.REGPILOT_CONNECTORS_ENABLED==="true"&&/^[a-f\d]{64}$/i.test(process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY||"");
const schema=githubTarget.extend({controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),token:z.string().regex(/^github_pat_[A-Za-z0-9_]{20,240}$/).optional(),enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)])});
export async function saveConnector(ctx:AuthorizedContext,input:unknown){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence connectors await activation",503);
 const parsed=schema.safeParse(input);if(!parsed.success)throw new IntelligenceError("Check the repository, branch, control, version and fine-grained token");const v=parsed.data;
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);
  const control=await tx.managedControl.findFirst({where:{id:v.controlId,organizationId:ctx.organizationId,enabled:true}});if(!control)throw new IntelligenceError("Choose an active control from this organisation",404);
  const old=v.id?await tx.evidenceConnector.findFirst({where:{id:v.id,organizationId:ctx.organizationId}}):null;
  if(v.id&&!old)throw new IntelligenceError("Connector not found",404);
  if((old?.version||0)!==v.version)throw new IntelligenceError("Connector settings changed",409);
  if(!v.token&&!old?.encryptedSecret)throw new IntelligenceError("A restricted fine-grained token is required");
  if(old&&!v.token&&(old.repository!==v.repository.toLowerCase()||old.branch!==v.branch))throw new IntelligenceError("Supply a newly scoped token when changing target");
  if(!old&&await tx.evidenceConnector.count({where:{organizationId:ctx.organizationId}})>=20)throw new IntelligenceError("Connector limit reached",429);
  const id=old?.id||randomUUID();const data={controlId:v.controlId,repository:v.repository.toLowerCase(),branch:v.branch,configuredById:ctx.userId,enabled:v.enabled,intervalHours:v.intervalHours,encryptedSecret:v.token?encryptConnectorSecret(v.token,ctx.organizationId,id):old!.encryptedSecret,nextRunAt:new Date(),leaseToken:null,leaseUntil:null,attempts:0,failureCode:null};
  if(!old&&await tx.evidenceConnector.findUnique({where:{organizationId_repository_branch:{organizationId:ctx.organizationId,repository:data.repository,branch:data.branch}}}))throw new IntelligenceError("This repository branch already has a connector",409);
  const saved=old?await tx.evidenceConnector.update({where:{id},data:{...data,version:{increment:1}}}):await tx.evidenceConnector.create({data:{id,organizationId:ctx.organizationId,...data}});
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.configured",entityType:"EvidenceConnector",entityId:id,details:{version:saved.version,controlId:v.controlId,enabled:v.enabled,credentialRotated:!!v.token}}});return {id,version:saved.version};
 });
}
export async function disconnectConnector(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const changed=await tx.evidenceConnector.updateMany({where:{id,organizationId:ctx.organizationId,version},data:{enabled:false,encryptedSecret:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Connector changed",409);await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.disconnected",entityType:"EvidenceConnector",entityId:id,details:{}}});return {id};});}
export async function requestConnectorRun(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version,enabled:true}});if(!row)throw new IntelligenceError("Active connector not found or changed",409);if(row.leaseUntil&&row.leaseUntil>new Date())throw new IntelligenceError("A collection is already running",409);if(row.lastSuccessAt&&Date.now()-row.lastSuccessAt.getTime()<300000)throw new IntelligenceError("Wait five minutes between successful collections",429);await tx.evidenceConnector.update({where:{id},data:{nextRunAt:new Date()}});return {id};});}
export async function claimConnector():Promise<EvidenceConnector|null>{
 const token=randomUUID();const rows=await db.$queryRaw<EvidenceConnector[]>`WITH due AS (SELECT id FROM "EvidenceConnector" WHERE enabled=true AND "encryptedSecret" IS NOT NULL AND "nextRunAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW()) ORDER BY "nextRunAt",id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "EvidenceConnector" c SET "leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',attempts=c.attempts+1,"updatedAt"=NOW() FROM due WHERE c.id=due.id RETURNING c.*`;return rows[0]||null;
}
class Superseded extends Error{}
async function assertJob(tx:Prisma.TransactionClient,job:EvidenceConnector){
 if(!connectorsEnabled())throw new Superseded();
 const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "EvidenceConnector" WHERE id=${job.id}::uuid AND "organizationId"=${job.organizationId}::uuid AND enabled=true AND version=${job.version} AND "leaseToken"=${job.leaseToken}::uuid AND "leaseUntil">NOW() FOR UPDATE`;
 if(!rows.length)throw new Superseded();
 await requireMember(tx,{organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"},ADMIN);
 const control=await tx.managedControl.findFirst({where:{id:job.controlId,organizationId:job.organizationId,enabled:true},include:{owner:{select:{email:true}}}});if(!control)throw new IntelligenceError("Control is paused",403);
 const owner=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:job.organizationId,userId:control.ownerId}}});if(!owner||owner.role==="VIEWER")throw new IntelligenceError("Control ownership needs review",403);return control;
}
export async function executeConnector(job:EvidenceConnector,collector:typeof collectGithub=collectGithub){
 const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"};
 try{
  await transaction(ctx,tx=>assertJob(tx,job));if(job.attempts>3)throw new CollectionError("INTERRUPTED_REPEATEDLY");
  if(!job.encryptedSecret)throw new CollectionError("CREDENTIAL_UNAVAILABLE");
  const result=await collector({repository:job.repository,branch:job.branch},decryptConnectorSecret(job.encryptedSecret,job.organizationId,job.id));
  const outcome=connectorOutcome(result),signalHash=hashValue({engine:result.engine,checks:result.checks});
  return await transaction(ctx,async tx=>{const control=await assertJob(tx,job);
   await tx.connectorRun.create({data:{organizationId:job.organizationId,connectorId:job.id,leaseToken:job.leaseToken!,configVersion:job.version,result:j(result),resultHash:hashValue(result),signalHash,outcome}});
   if(outcome!=="OBSERVED"&&!await tx.obligation.findFirst({where:{organizationId:job.organizationId,connectorId:job.id,status:{not:"COMPLETE"}}})){
    await tx.obligation.create({data:{organizationId:job.organizationId,title:("Review repository evidence: "+control.title).slice(0,160),ownerName:control.owner.email,assigneeId:control.ownerId,controlId:control.id,connectorId:job.id,category:"Automated evidence follow-up",dueDate:new Date(),automationKey:hashValue({connector:job.id,lease:job.leaseToken}),notes:"Review the recorded repository observations and limitations. Missing or failing signals require investigation; this is not a legal deadline or compliance verdict."}});
   }
   await tx.evidenceConnector.update({where:{id:job.id},data:{leaseToken:null,leaseUntil:null,attempts:0,lastSuccessAt:new Date(),failureCode:null,nextRunAt:new Date(Date.now()+job.intervalHours*3600000)}});
   await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.evidence_collected",entityType:"EvidenceConnector",entityId:job.id,details:{outcome,resultHash:hashValue(result),configVersion:job.version}}});return outcome;
  });
 }catch(error){
  if(error instanceof Superseded)return "SUPERSEDED";
  const code=error instanceof CollectionError?error.code:error instanceof IntelligenceError&&error.status===403?"PERMISSION_REVOKED":"COLLECTION_FAILED";
  const paused=job.attempts>=3||code==="PERMISSION_REVOKED"||code==="CREDENTIAL_REJECTED";
  return transaction(ctx,async tx=>{const changed=await tx.evidenceConnector.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,version:job.version,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,failureCode:code,enabled:!paused,nextRunAt:new Date(Date.now()+(job.attempts===1?5:30)*60000)}});if(!changed.count)return "SUPERSEDED";
   await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.collection_failed",entityType:"EvidenceConnector",entityId:job.id,details:{code,paused}}});return paused?"ATTENTION":"RETRY_SCHEDULED";
  });
 }
}
export async function runConnectorBatch(){if(!connectorsEnabled())throw new IntelligenceError("Connectors await activation",503);const outcomes:string[]=[];for(let i=0;i<2;i++){if(!connectorsEnabled())break;const job=await claimConnector();if(!job)break;outcomes.push(await executeConnector(job));}return {processed:outcomes.length,outcomes};}
export async function exportConnectorRun(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx);const row=await tx.connectorRun.findFirst({where:{id,organizationId:ctx.organizationId},include:{connector:{select:{version:true,enabled:true,lastSuccessAt:true,failureCode:true,intervalHours:true}}}});if(!row)throw new IntelligenceError("Observation not found",404);if(hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Observation integrity check failed",409);
  const latest=await tx.connectorRun.findFirst({where:{organizationId:ctx.organizationId,connectorId:row.connectorId},orderBy:[{capturedAt:"desc"},{id:"desc"}],select:{id:true}});
  const current=latest?.id===row.id&&row.configVersion===row.connector.version&&row.connector.enabled&&!row.connector.failureCode&&Date.now()-row.capturedAt.getTime()<row.connector.intervalHours*3600000;
  return {format:"regpilot-connector-observation-v1",id:row.id,capturedAt:row.capturedAt,result:row.result,resultHash:row.resultHash,currentAtExport:!!current,limitation:"Integrity hash is not a digital signature. A point-in-time observation does not establish compliance."};
 });
}
