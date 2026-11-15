import {connectorControlIds} from './connector-scope';
import {Prisma,type EvidenceConnector,type AutomationEvent} from '@prisma/client';
import {IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {connectorProviderEnabled} from './connector-flags';
import {followUpVendorSignals} from './vendor-signals';
import {hashValue} from '../regulatory/intelligence';
import {observationOutcome,type Observation} from '../connectors/observation';
export class ReactionInvalid extends Error {constructor(public code:'INPUT_INTEGRITY_FAILED'|'EVENT_KIND_UNSUPPORTED'){super('Automation input requires review');}}
export class ReactionPaused extends Error{}
export async function followUpConnectorControls(tx:Prisma.TransactionClient,job:EvidenceConnector,reason:string,onlyControlIds?:string[]){
 const ids=onlyControlIds||await connectorControlIds(tx,job.organizationId,job.id,job.controlId);
 const controls=await tx.managedControl.findMany({where:{id:{in:ids},organizationId:job.organizationId,enabled:true},include:{owner:{select:{email:true}}},orderBy:{id:'asc'}});
 let created=0;
 for(const control of controls){
  try{await requireMember(tx,{organizationId:job.organizationId,userId:control.ownerId,role:'EDITOR'},WRITER);}catch(e){if(e instanceof IntelligenceError&&e.status===403)continue;throw e;}
  if(await tx.obligation.findFirst({where:{organizationId:job.organizationId,connectorId:job.id,controlId:control.id,status:{not:'COMPLETE'}}}))continue;
  await tx.obligation.create({data:{organizationId:job.organizationId,title:('Review connected evidence: '+control.title).slice(0,160),ownerName:control.owner.email,assigneeId:control.ownerId,controlId:control.id,connectorId:job.id,category:'Automated evidence follow-up',dueDate:new Date(),notes:reason+' Review the connection history in Operations. This is an operational review target, not a legal deadline or compliance verdict.'}});created++;
 }
 return created;
}

/** Database effects only. The queue commits effects and acknowledgement together. */
export async function applyConnectorReaction(tx:Prisma.TransactionClient,event:AutomationEvent):Promise<'DONE'|'CANCELLED'>{
 const job=await tx.evidenceConnector.findFirst({where:{id:event.connectorId,organizationId:event.organizationId}});
 if(!job||(!job.enabled&&event.kind!=='CONNECTOR_FAILED')||job.version!==event.configVersion)return 'CANCELLED';
 if(!connectorProviderEnabled(job.provider))throw new ReactionPaused();
 const ctx={organizationId:job.organizationId,userId:job.configuredById,role:'ADMIN' as const};
 try{await requireMember(tx,ctx,ADMIN);}catch(error){if(error instanceof IntelligenceError&&error.status===403)return 'CANCELLED';throw error;}
 const control=await tx.managedControl.findFirst({where:{id:job.controlId,organizationId:job.organizationId,enabled:true}});
 if(!control)return 'CANCELLED';
 if(event.kind==='CONNECTOR_OBSERVED'){
  const run=event.runId?await tx.connectorRun.findFirst({where:{id:event.runId,organizationId:job.organizationId,connectorId:job.id,configVersion:event.configVersion}}):null;
  if(!run||hashValue(run.result)!==run.resultHash||run.signalHash!==event.fingerprint)throw new ReactionInvalid('INPUT_INTEGRITY_FAILED');
  const observation=run.result as unknown as Observation;
  if(!observation||!Array.isArray(observation.checks)||hashValue({engine:observation.engine,checks:observation.checks})!==run.signalHash)throw new ReactionInvalid('INPUT_INTEGRITY_FAILED');
  if(observationOutcome(observation)!==run.outcome)throw new ReactionInvalid('INPUT_INTEGRITY_FAILED');
  if(run.outcome!=='OBSERVED'||event.changed)await followUpConnectorControls(tx,job,event.changed?'Observed signals changed since the last collection. Check the before/after values and remaining gaps.':'The collection contains failing or unknown signals requiring investigation.');
  await followUpVendorSignals(tx,ctx,job,event.fingerprint);
 }else if(event.kind==='CONNECTOR_FAILED'){
  // Recovered collections supersede old failures; do not create stale failure tasks.
  if(!event.reasonCode||job.failureCode!==event.reasonCode||job.lastSuccessAt&&job.lastSuccessAt>=event.createdAt)return 'CANCELLED';
  await followUpConnectorControls(tx,job,'Evidence collection failed. Earlier observations may be stale; check credentials, permissions and provider availability.');
  await followUpVendorSignals(tx,ctx,job,event.reasonCode,true);
 }else throw new ReactionInvalid('EVENT_KIND_UNSUPPORTED');
 return 'DONE';
}
