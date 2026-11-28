import {completeLoggerWindow} from '../temperature-window';
import type {Prisma} from '@prisma/client';
import {isTemperatureLogger} from '../connectors/record-catalogue';
import {monitoringProduct,completedManagedSync,publicMonitoringProducts,advancesUpstream} from '../connectors/monitoring-product';
import {missingMonitoringEvidence} from '../monitoring-criteria';
import {monitoringCalendar} from './monitoring-calendar';
import {monitoringDepth} from './monitoring-depth';
import {maxWorkspaceConnectorTargets} from '../connectors/capacity';
import {z} from 'zod';
import {ADMIN,requireMember} from './workspace-member';
import {IntelligenceError,transaction} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {verifiedObservation} from './connector-observation';
import {connectorScopeHash} from './connector-verification';
import {loggerReadingCurrent} from './logger-calibration';
import {connectorProviderEnabled} from './connector-flags';
import {observationCurrent} from '../connectors/observation';
import {readRecordKeys} from '../connectors/operational-records';
import {isModelConnector} from '../connectors/direct-model';

const loggerChecks=['logger-fresh','logger-temperature','logger-calibration'];
const required:Record<string,string[]>={UBIBOT:loggerChecks,TANDD_WEBSTORAGE:loggerChecks,BENCHLING:['lab-result','lab-entry','lab-decision','lab-authority'],OPENAI_PROJECT_MODEL:['model-access'],PRIVATE_AI_MODEL:['model-access']};

const category=z.enum(['CUSTOMER','STAGING','UNCONFIRMED']);
export const declaration=z.object({connectionId:z.uuid(),configVersion:z.number().int().positive(),category,confirm:z.literal(true)}).strict();
const attribution=z.object({scopeHash:z.string(),category,version:z.number().int().positive()});
const where=(organizationId:string,id:string)=>({organizationId,entityType:'EvidenceConnector',entityId:id});
export async function proofTargets(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  return tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId},select:{id:true,provider:true,repository:true,version:true,enabled:true},orderBy:{id:'asc'},take:maxWorkspaceConnectorTargets});
 });
}
export async function declareSource(ctx:AuthorizedContext,input:z.infer<typeof declaration>){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.evidenceConnector.findFirst({where:{organizationId:ctx.organizationId,id:input.connectionId,version:input.configVersion}});
  if(!row)throw new IntelligenceError('Refresh the connection before recording its source.',409);
  if(input.category==='CUSTOMER'&&publicMonitoringProducts.has(row.provider))throw new IntelligenceError('This publication is a public source. Customer ownership applies to an organisation’s own system.',409);
  if(row.configuredById===ctx.userId&&input.category==='CUSTOMER')throw new IntelligenceError('A second workspace administrator must confirm customer ownership.',403);
  const scopeHash=connectorScopeHash(row);
  const query={...where(ctx.organizationId,row.id),action:'connector.source-declared'};
  const previous=await tx.auditEvent.findFirst({where:query,orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const prior=attribution.safeParse(previous?.details).data;
  if(previous?.actorId===ctx.userId&&prior?.scopeHash===scopeHash&&prior?.version===row.version&&prior?.category===input.category)return {id:previous!.id};
  return tx.auditEvent.create({data:{...query,actorId:ctx.userId,details:{scopeHash,category:input.category,version:row.version}},select:{id:true}});
 });
}
export async function sourceOwnership(tx:Prisma.TransactionClient,ctx:AuthorizedContext,row:{id:string;provider:string;controlId:string;repository:string;branch:string;version:number;configuredById:string}){
 const mark=await tx.auditEvent.findFirst({where:{...where(ctx.organizationId,row.id),action:'connector.source-declared'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,actorId:true,details:true}});
 const info=attribution.safeParse(mark?.details).data;
 if(!mark?.actorId||info?.scopeHash!==connectorScopeHash(row)||info.version!==row.version)return null;
 try{await requireMember(tx,{...ctx,userId:mark.actorId},ADMIN);}
 catch(e){if(e instanceof IntelligenceError&&e.status===403)return null;throw e;}
 if(info.category==='CUSTOMER'&&(mark.actorId===row.configuredById||publicMonitoringProducts.has(row.provider)))return null;
 return {id:mark.id,actor:mark.actorId,category:info.category,scopeHash:info.scopeHash,version:info.version};
}
export async function customerSourceProof(ctx:AuthorizedContext,id:string,includeCalendar=true){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.evidenceConnector.findFirst({where:{organizationId:ctx.organizationId,id},include:{control:{select:{enabled:true}}}});
  if(!row)throw new IntelligenceError('Source connection unavailable.',404);
  const scopeHash=connectorScopeHash(row),audit=where(ctx.organizationId,id);
  const captures=await tx.connectorRun.findMany({where:{organizationId:ctx.organizationId,connectorId:id},orderBy:[{capturedAt:'desc'},{id:'desc'}],take:101,select:{id:true,configVersion:true,capturedAt:true,result:true,resultHash:true,signalHash:true,outcome:true}});
  const changes=await tx.auditEvent.findMany({where:{...audit,action:'connector.configured'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,select:{details:true,createdAt:true}});
  const versions=new Set([row.version]),rotations:{before:number;after:number;at:Date}[]=[];
  for(const change of changes.slice(0,50)){
   const d=change.details as {scopeHash?:string;version?:number;previousVersion?:number;credentialReplaced?:boolean}|null;
   if(d?.scopeHash!==scopeHash||typeof d.version!=='number')continue;
   versions.add(d.version);
   if(d.credentialReplaced&&typeof d.previousVersion==='number'){versions.add(d.previousVersion);rotations.push({before:d.previousVersion,after:d.version,at:change.createdAt});}
  }
  const managed=row.provider==='NANGO_SYNC';
  const usable=captures.slice(0,100).flatMap(run=>{
   const obs=verifiedObservation(run);
   if(!versions.has(run.configVersion)||!obs||!completeLoggerWindow(obs)||(!required[row.provider]&&(!obs.checks.length||obs.checks.some(c=>c.status==='UNKNOWN')))||!(required[row.provider]??[]).every(id=>obs.checks.some(c=>c.id===id&&(c.status==='PASS'||id==='logger-temperature'&&c.status==='FAIL'))))return [];
   const upstream=managed?completedManagedSync(obs,row.intervalHours):null;
   if(managed&&upstream===null)return [];
   const sample=obs.checks.find(c=>c.id==='logger-fresh')?.observed;
   return [{run,obs,sample,upstream}];
  });
  const latest=usable[0],now=Date.now();
  let current=!!latest&&row.control.enabled&&connectorProviderEnabled(row.provider)&&observationCurrent(latest.run,row,latest.run.id===captures[0]?.id,now);
  if(current&&managed)current=latest!.upstream!==null&&now-latest!.upstream<(row.intervalHours===1?1:24)*3600000;
  if(current&&isTemperatureLogger(row.provider))current=await loggerReadingCurrent(tx,row,latest!.obs,now);
  const repeat=current&&usable.some(old=>old.run.configVersion===row.version&&latest!.run.capturedAt.getTime()-old.run.capturedAt.getTime()>=row.intervalHours*3600000&&(!isTemperatureLogger(row.provider)||Date.parse(old.sample??'')<Date.parse(latest!.sample??''))&&(!managed||advancesUpstream(old.upstream,latest!.upstream)));
  const rotated=rotations.some(r=>r.after===row.version&&usable.some(a=>a.run.configVersion===r.before)&&usable.some(a=>a.run.configVersion===r.after&&(!managed||advancesUpstream(r.at.getTime(),a.upstream))));
  const recorded=(await sourceOwnership(tx,ctx,row))?.category??'UNCONFIRMED';
  const isModel=isModelConnector(row.provider);
  const binding=isModel?await tx.auditEvent.findFirst({where:{organizationId:ctx.organizationId,entityType:'WorkspaceAiProvider',entityId:ctx.organizationId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,action:true}}):null;
  const inference=binding?.action==='ai.provider-linked'?await tx.auditEvent.findFirst({where:{...audit,action:'ai.customer-inference',AND:[{details:{path:['version'],equals:row.version}},{details:{path:['bindingId'],equals:binding.id}}]},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}}):null;
  const depth=await monitoringDepth(tx,ctx.organizationId,id,scopeHash,row.version,row.intervalHours,captures,rotations);
  let managedSlug:string|undefined;
  if(row.provider==='PIPEDREAM_READ'&&latest){
   const target=readRecordKeys('PIPEDREAM_READ',row.repository,row.branch);
   managedSlug=(await import('../connectors/product-recipes')).recipeFor(target.scope,target.record)?.family;
  }
  if(managed){
   const basis=readRecordKeys('NANGO_SYNC',row.repository,row.branch).reference?.split('/');
   if(basis?.length===2&&z.uuid().safeParse(basis[1]).success&&latest)managedSlug=basis[0];
   const times=new Map(usable.map(r=>[r.run.id,r.upstream]));
   const pair=depth.cadenceReceipts;
   const older=pair&&times.get(pair.older),newer=pair&&times.get(pair.newer);
   if(!advancesUpstream(older,newer)){depth.cadence=false;depth.cadenceReceipts=null;}
   depth.recoveries=depth.recoveries.filter(r=>times.has(r.before)&&advancesUpstream(Date.parse(r.replacedAt),times.get(r.after)));
  }
  const productKey=monitoringProduct(row.provider,managedSlug);
  const gaps=missingMonitoringEvidence({productKey,category:recorded,current,repeat,rotated,cadence:depth.cadence,recovered:depth.recoveries.length>0,inference:isModel?!!inference:null});
  const qualifies=gaps.length===0;
  const calendar=includeCalendar?await monitoringCalendar(tx,ctx.organizationId,id,row.provider,scopeHash,now):null;
  return {depth,calendar,productKey,gaps,qualifies,connectorId:id,provider:row.provider,version:row.version,category:recorded,current,repeat,rotated,inference:isModel?!!inference:null,customerVerified:(!managed||!!productKey)&&recorded==='CUSTOMER'&&current&&repeat&&rotated&&(!isModel||!!inference),sourceReceiptId:current?latest!.run.id:null,inferenceReceiptId:inference?.id??null,intervalHours:row.intervalHours,historyTruncated:captures.length>100||changes.length>50,checkedAt:new Date(now).toISOString()};
 });
}

/** Re-evaluate active declarations on demand. Each response covers a bounded page. */
export async function customerBenchmarkPage(ctx:AuthorizedContext,after?:string){
 const page=await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  return tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId,provider:{notIn:[...publicMonitoringProducts]},OR:[{enabled:true},{failureCode:{not:null}}],...(after?{id:{gt:after}}:{})},orderBy:{id:'asc'},take:9,select:{id:true,repository:true,provider:true,enabled:true,failureCode:true}});
 });
 const connections=[];
 for(const {id,repository,provider,enabled,failureCode} of page.slice(0,8)){
  const p=await customerSourceProof(ctx,id,false);
  connections.push({id,target:repository,paused:!enabled,renewHostedAccount:provider==='NANGO_SYNC'&&failureCode==='CREDENTIAL_REJECTED',product:p.productKey??p.provider,qualified:p.qualifies,gaps:p.gaps,category:p.category,latestScheduledAt:p.depth.latestScheduledAt,cadenceReceipts:p.depth.cadenceReceipts,scheduledReads:p.depth.scheduledReads,
   failures:p.depth.failures.length,verifiedRecoveries:p.depth.recoveries.length,checkedAt:p.checkedAt});
 }
 return {organizationId:ctx.organizationId,target:500,connections,after:page.length>8?page[7].id:null};
}
