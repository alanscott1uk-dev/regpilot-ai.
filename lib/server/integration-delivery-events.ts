import {partnerValidity} from '../partner-records';
import {Prisma,type ConnectorRun,type CustomerApiObservation,type EvidenceConnector} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DELIVERY_LIMITS,DELIVERY_VERSION,deliveryEnvelopeSchema,type DeliveryEnvelope} from '../integration-delivery';
import {customerObservationInput,reportedObservationOutcome} from '../customer-api';
import {hashValue} from '../regulatory/intelligence';
import {workspaceConfigured} from './ai-auth';
import {verifiedObservation} from './connector-observation';
import {completionParticipants} from './work-completion-service';
import {ADMIN,WRITER} from './workspace-member';
export const outboundIntegrationsEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_OUTBOUND_INTEGRATIONS_ENABLED==='true';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Tx=Prisma.TransactionClient;

/** Called inside the source mutation transaction. Events cannot be committed
 * without their mutation, and retries cannot produce a second delivery. */
export async function enqueueIntegrationEvent(tx:Tx,envelope:DeliveryEnvelope,options:{endpointId?:string;expiresAt?:Date}={}){
 if(!outboundIntegrationsEnabled())return null;
 const payload=deliveryEnvelopeSchema.parse(envelope),organizationId=payload.organizationId,probe=payload.type==='endpoint.probe';
 const endpoints=await tx.integrationEndpoint.findMany({where:{organizationId,state:{not:'REVOKED'},expiresAt:{gt:new Date()},...(options.endpointId?{id:options.endpointId}:{eventTypes:{has:payload.type},controls:{some:{controlId:{in:payload.controlIds}}}})},include:{controls:{select:{controlId:true}}},take:DELIVERY_LIMITS.activeEndpoints});
 if(!endpoints.length)return null;
 const key=hashValue({type:payload.type,source:payload.source}),old=await tx.integrationEvent.findUnique({where:{organizationId_eventKey:{organizationId,eventKey:key}}});
 if(old)return old.id;
 const eligible=endpoints.filter(endpoint=>probe||endpoint.state==='ACTIVE'&&endpoint.verifiedVersion===endpoint.version);
 const skipped=endpoints.filter(endpoint=>!eligible.some(row=>row.id===endpoint.id));
 if(skipped.length)await tx.integrationEndpoint.updateMany({where:{organizationId,id:{in:skipped.map(row=>row.id)}},data:{skippedCount:{increment:1},lastSkippedAt:new Date()}});
 if(!eligible.length)return null;
 const event=await tx.integrationEvent.create({data:{id:payload.id,organizationId,eventKey:key,eventType:payload.type,sourceKind:payload.source.kind,sourceId:payload.source.id,sourceVersion:payload.source.version,controlIds:payload.controlIds,payload:json(payload),payloadHash:hashValue(payload),occurredAt:new Date(payload.occurredAt),expiresAt:options.expiresAt??new Date(Date.now()+DELIVERY_LIMITS.eventHours*3600000)}});
 for(const endpoint of eligible){
  const controlIds=probe?[]:payload.controlIds.filter(id=>endpoint.controls.some(grant=>grant.controlId===id));
  if(!probe&&!controlIds.length)continue;
  const pending=await tx.integrationDelivery.count({where:{endpointId:endpoint.id,state:{in:['PENDING','SENDING']}}}),full=pending>=DELIVERY_LIMITS.pendingPerEndpoint;
  const scoped=deliveryEnvelopeSchema.parse({...payload,controlIds});
  await tx.integrationDelivery.create({data:{organizationId,endpointId:endpoint.id,eventId:event.id,endpointVersion:endpoint.version,secretVersion:endpoint.secretVersion,controlIds,payload:json(scoped),payloadHash:hashValue(scoped),...(full?{state:'DEAD',lastErrorCode:'QUEUE_CAPACITY',finishedAt:new Date()}:{})}});
  if(full)await tx.integrationEndpoint.update({where:{id:endpoint.id},data:{state:'PAUSED',failureCode:'QUEUE_CAPACITY',lastFailureAt:new Date()}});
 }
 return event.id;
}

export async function enqueueCustomerObservationDelivery(tx:Tx,row:CustomerApiObservation,reviewed=false){
 if(!outboundIntegrationsEnabled())return;
 const input=customerObservationInput.parse(row.payload),base={apiVersion:DELIVERY_VERSION,id:randomUUID(),organizationId:row.organizationId,occurredAt:(reviewed?row.reviewedAt!:row.receivedAt).toISOString(),source:{kind:'CUSTOMER_OBSERVATION' as const,id:row.id,version:reviewed?row.version:1},controlIds:[row.controlId]},data={observationId:row.id,credentialId:row.credentialId,...(input.partnerRecord&&row.partnerKey?{partner:{series:row.partnerKey,revision:input.partnerRecord.revision,state:input.partnerRecord.state}}:{}),reportedOutcome:reportedObservationOutcome(input),validUntil:row.validUntil.toISOString()};
 const envelope=deliveryEnvelopeSchema.parse(reviewed?{...base,type:'customer.observation.reviewed',data:{...data,decision:row.status,followUpTaskId:row.followUpTaskId}}:{...base,type:'customer.observation.received',data});
 await enqueueIntegrationEvent(tx,envelope,{expiresAt:new Date(Math.min(row.validUntil.getTime(),Date.now()+DELIVERY_LIMITS.eventHours*3600000))});
}
async function connectorControlIds(tx:Tx,connector:Pick<EvidenceConnector,'id'|'organizationId'|'controlId'>){const links=await tx.connectorControlLink.findMany({where:{organizationId:connector.organizationId,connectorId:connector.id},select:{controlId:true},take:499});return [...new Set([connector.controlId,...links.map(link=>link.controlId)])].sort();}
export async function enqueueConnectorObservationDelivery(tx:Tx,connector:EvidenceConnector,run:ConnectorRun){
 if(!outboundIntegrationsEnabled())return;
 await enqueueIntegrationEvent(tx,deliveryEnvelopeSchema.parse({apiVersion:DELIVERY_VERSION,id:randomUUID(),type:'connector.observation.recorded',organizationId:connector.organizationId,occurredAt:run.capturedAt.toISOString(),source:{kind:'CONNECTOR_RUN',id:run.id,version:run.configVersion},controlIds:await connectorControlIds(tx,connector),data:{connectorId:connector.id,runId:run.id,outcome:run.outcome,resultHash:run.resultHash}}));
}
export async function enqueueConnectorFailureDelivery(tx:Tx,connector:EvidenceConnector,auditId:string,code:string,occurredAt:Date){
 if(!outboundIntegrationsEnabled())return;
 await enqueueIntegrationEvent(tx,deliveryEnvelopeSchema.parse({apiVersion:DELIVERY_VERSION,id:randomUUID(),type:'connector.collection.failed',organizationId:connector.organizationId,occurredAt:occurredAt.toISOString(),source:{kind:'CONNECTOR_FAILURE',id:auditId,version:connector.version},controlIds:await connectorControlIds(tx,connector),data:{connectorId:connector.id,code}}));
}

const observationContext=z.object({format:z.literal('customer-observation-v1'),credentialId:z.uuid(),issuedById:z.uuid(),control:z.object({id:z.uuid(),version:z.number().int().positive(),title:z.string(),ownerId:z.uuid(),enabled:z.boolean(),importId:z.uuid(),programmeStatus:z.string(),procedureHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict();
/** Recheck source integrity and current origin permissions before every send or
 * replay. These checks establish the event's origin, not compliance approval. */
export async function integrationEventCurrent(tx:Tx,envelope:DeliveryEnvelope):Promise<boolean>{
 const organizationId=envelope.organizationId,context={organizationId,userId:'',role:'ADMIN' as const},allowed=async(ids:string[],roles:string[])=>{const people=await completionParticipants(tx,context,ids);return ids.every(id=>people.some(person=>person.id===id&&person.approved&&roles.includes(person.role)));};
 if(envelope.type==='endpoint.probe')return envelope.source.kind==='ENDPOINT'&&envelope.source.id===envelope.data.endpointId;
 if(envelope.type==='customer.observation.received'||envelope.type==='customer.observation.reviewed'){
  const row=await tx.customerApiObservation.findFirst({where:{id:envelope.source.id,organizationId},include:{credential:{include:{controls:{select:{controlId:true}}}},control:{include:{programmeImport:{select:{status:true}}}}}});
  if(!row||row.supersededAt||row.id!==envelope.data.observationId||row.credentialId!==envelope.data.credentialId||row.validUntil<=new Date()||row.credential.revokedAt||row.credential.expiresAt<=new Date()||!row.credential.scopes.includes('observations:write')||!row.credential.controls.some(grant=>grant.controlId===row.controlId)||!row.control.enabled||row.control.programmeImport.status!=='ACCEPTED'||envelope.controlIds.length!==1||envelope.controlIds[0]!==row.controlId)return false;
  const payload=customerObservationInput.safeParse(row.payload),snapshot=observationContext.safeParse(row.context);
  if(!payload.success||!snapshot.success||payload.data.partnerRecord?.state==='CURRENT'&&partnerValidity(payload.data.partnerRecord,Date.now())||hashValue(payload.data)!==row.payloadHash||hashValue(snapshot.data)!==row.contextHash||snapshot.data.credentialId!==row.credentialId||snapshot.data.issuedById!==row.credential.issuedById||payload.data.controlId!==row.controlId||payload.data.externalId!==row.externalId||payload.data.observedAt!==row.observedAt.toISOString()||payload.data.validUntil!==row.validUntil.toISOString()||reportedObservationOutcome(payload.data)!==envelope.data.reportedOutcome||envelope.data.validUntil!==row.validUntil.toISOString())return false;
  const control={id:row.control.id,version:row.control.version,title:row.control.title,ownerId:row.control.ownerId,enabled:row.control.enabled,importId:row.control.importId,programmeStatus:row.control.programmeImport.status,procedureHash:hashValue({description:row.control.description,procedure:row.control.testProcedure})};
  if(hashValue(control)!==hashValue(snapshot.data.control)||!await allowed([row.credential.issuedById],ADMIN)||!await allowed([row.control.ownerId],WRITER))return false;
  const expected=payload.data.partnerRecord?{series:row.partnerKey,revision:payload.data.partnerRecord.revision,state:payload.data.partnerRecord.state}:null;
  if(hashValue(envelope.data.partner??null)!==hashValue(expected))return false;
  if(envelope.type==='customer.observation.received')return envelope.source.version===1&&envelope.occurredAt===row.receivedAt.toISOString();
  if(row.version!==envelope.source.version||row.status!==envelope.data.decision||row.followUpTaskId!==envelope.data.followUpTaskId||!row.reviewerId||envelope.occurredAt!==row.reviewedAt?.toISOString()||!await allowed([row.reviewerId],ADMIN))return false;
  if(row.followUpTaskId&&!await tx.obligation.findFirst({where:{id:row.followUpTaskId,organizationId,controlId:row.controlId}}))return false;
  return true;
 }
 const connector=await tx.evidenceConnector.findFirst({where:{id:envelope.data.connectorId,organizationId},include:{controlLinks:{select:{controlId:true,mappedById:true}}}});
 if(!connector||connector.version!==envelope.source.version||!await allowed([connector.configuredById],ADMIN))return false;
 const sourceControls=[connector.controlId,...connector.controlLinks.map(link=>link.controlId)];
 if(envelope.controlIds.some(id=>!sourceControls.includes(id)))return false;
 const mappingPeople=connector.controlLinks.filter(link=>envelope.controlIds.includes(link.controlId)).map(link=>link.mappedById);if(mappingPeople.length&&!await allowed(mappingPeople,ADMIN))return false;
 if(envelope.type==='connector.observation.recorded'){
  const run=await tx.connectorRun.findFirst({where:{id:envelope.source.id,organizationId,connectorId:connector.id,configVersion:connector.version}});
  return !!run&&run.id===envelope.data.runId&&run.outcome===envelope.data.outcome&&run.resultHash===envelope.data.resultHash&&run.capturedAt.toISOString()===envelope.occurredAt&&!!verifiedObservation(run);
 }
 const audit=await tx.auditEvent.findFirst({where:{id:envelope.source.id,organizationId,entityId:connector.id,action:'connector.collection_failed'}}),details=audit?.details as {code?:unknown}|null;
 return !!audit&&audit.actorId===connector.configuredById&&details?.code===envelope.data.code&&audit.createdAt.toISOString()===envelope.occurredAt;
}
