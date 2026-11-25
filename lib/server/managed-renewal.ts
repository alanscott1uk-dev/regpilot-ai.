import type {EvidenceConnector,Prisma} from '@prisma/client';
import type {Observation} from '../connectors/observation';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hostedConnectSession} from '../connectors/hosted-oauth';
import {workspaceGrants,type Integration} from '../connectors/marketplace';
import {readRecordKeys} from '../connectors/operational-records';
import {connectorScopeHash} from './connector-verification';
import type {AuthorizedContext} from './authorization';
import {ADMIN,requireMember} from './workspace-member';
import {IntelligenceError,transaction} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';

function grantScope(ctx:AuthorizedContext,source:Integration,connectionId:string){
 return {organizationId:ctx.organizationId,entityType:'ManagedGrantRenewal',entityId:hashValue([source.provider,source.integration,connectionId])};
}
export async function beginManagedRenewal(ctx:AuthorizedContext,source:Integration,connectionId:string,key:string,fetcher:typeof fetch){
 const id=randomUUID();
 const session=await hostedConnectSession(ctx.organizationId,ctx.userId,{key,integration:source.integration},fetcher,
  {regpilot_integration:source.integration,regpilot_renewal:id},connectionId);
 await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  await tx.auditEvent.create({data:{...grantScope(ctx,source,connectionId),id,actorId:ctx.userId,action:'integration.renewal-started',details:{expiresAt:session.expiresAt}}});
 });
 return session;
}
export async function checkSyncAfterRenewal(tx:Prisma.TransactionClient,row:EvidenceConnector,reading:Observation):Promise<Observation>{
 const renewal=await tx.auditEvent.findFirst({where:{organizationId:row.organizationId,entityType:'EvidenceConnector',entityId:row.id,action:'connector.configured',AND:[
  {details:{path:['scopeHash'],equals:connectorScopeHash(row)}},{details:{path:['version'],equals:row.version}},
  {details:{path:['method'],equals:'HOSTED_REAUTHORISATION'}}]},select:{createdAt:true}});
 if(!renewal)return reading;
 return {...reading,checks:reading.checks.map(check=>{
  if(check.id!=='source-sync'||check.status!=='PASS')return check;
  const completed=check.observed.startsWith('FRESH · ')?Date.parse(check.observed.slice('FRESH · '.length)):NaN;
  if(completed>renewal.createdAt.getTime())return check;
  return {...check,status:'UNKNOWN',observed:check.observed+' · awaiting a sync after reauthorisation',
   nextStep:'Complete a new upstream sync, then collect the monitor again.'};
 })};
}
export async function verifyManagedRenewal(ctx:AuthorizedContext,source:Integration,connectionId:string,key:string,fetcher:typeof fetch){
 const [grant,...others]=await workspaceGrants(ctx.organizationId,source,key,fetcher,connectionId);
 if(!grant?.healthy||others.length||!grant.renewalId)throw new IntelligenceError('Finish authorisation with the provider, then verify this connection again.',409);
 const renewalId=grant.renewalId,scope=grantScope(ctx,source,connectionId);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const request=await tx.auditEvent.findFirst({where:{...scope,id:renewalId,action:'integration.renewal-started'},select:{id:true,createdAt:true,actorId:true}});
  if(!request||grant.renewedBy!==request.actorId)throw new IntelligenceError('The provider has not confirmed a renewal started by this workspace.',409);
  const where={...scope,action:'integration.renewal-verified',details:{path:['requestId'],equals:request.id}};
  const latest=await tx.auditEvent.findFirst({where:{...scope,action:'integration.renewal-started'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  if(latest?.id!==request.id)throw new IntelligenceError('Complete the most recent renewal for this connection.',409);
  const prior=await tx.auditEvent.findFirst({where,select:{id:true,details:true}});
  const saved=z.object({resumed:z.number().int().nonnegative()});
  if(prior)return {receiptId:prior.id,resumed:saved.parse(prior.details).resumed};
  const sources=await tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId,provider:'NANGO_SYNC',
   repository:'nango_sync:'+source.integration+':'+connectionId,enabled:false,failureCode:'CREDENTIAL_REJECTED',control:{enabled:true}}});
  let resumed=0;
  for(const row of sources){
   const target=readRecordKeys('NANGO_SYNC',row.repository,row.branch);
   if(target.reference?.split('/')[0]!==source.provider)continue;
   const scopeHash=connectorScopeHash(row);
   const events={organizationId:ctx.organizationId,entityType:'EvidenceConnector',entityId:row.id};
   const incident=await tx.auditEvent.findFirst({where:{...events,action:'connector.collection_failed',AND:[
    {details:{path:['code'],equals:'CREDENTIAL_REJECTED'}},{details:{path:['scopeHash'],equals:scopeHash}},
    {details:{path:['configVersion'],equals:row.version}},{details:{path:['step'],equals:'grant'}}]},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,createdAt:true}});
   if(!incident||incident.createdAt>request.createdAt)continue;
   const restored=await tx.evidenceConnector.updateMany({where:{id:row.id,organizationId:ctx.organizationId,version:row.version,enabled:false,failureCode:'CREDENTIAL_REJECTED',leaseToken:null},
    data:{version:{increment:1},configuredById:ctx.userId,enabled:true,attempts:0,nextRunAt:new Date(),failureCode:null}});
   if(!restored.count)throw new IntelligenceError('The monitor changed while renewing. Refresh its status.',409);
   await tx.auditEvent.create({data:{...events,actorId:ctx.userId,action:'connector.configured',details:{
    scopeHash,controlId:row.controlId,enabled:true,previousVersion:row.version,version:row.version+1,credentialReplaced:true,
    method:'HOSTED_REAUTHORISATION',requestId:request.id,incidentId:incident.id}}});
   resumed++;
  }
  const receipt=await tx.auditEvent.create({data:{...scope,actorId:ctx.userId,action:'integration.renewal-verified',details:{requestId:request.id,resumed}},select:{id:true}});
  return {receiptId:receipt.id,resumed};
 });
}
