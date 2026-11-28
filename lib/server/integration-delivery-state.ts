import {Prisma} from '@prisma/client';
import {deliveryEnvelopeSchema,type DeliveryEnvelope} from '../integration-delivery';
import {hashValue} from '../regulatory/intelligence';
import {completionParticipants} from './work-completion-service';
import {ADMIN,WRITER} from './workspace-member';
import {integrationEventCurrent} from './integration-delivery-events';
export const endpointInclude={controls:{select:{controlId:true}}} as const;
export type DeliveryEndpoint=Prisma.IntegrationEndpointGetPayload<{include:typeof endpointInclude}>;
export const deliveryInclude={endpoint:{include:endpointInclude},event:true} as const;
export type DeliveryRecord=Prisma.IntegrationDeliveryGetPayload<{include:typeof deliveryInclude}>;
export async function endpointAuthority(tx:Prisma.TransactionClient,endpoint:DeliveryEndpoint,ids=endpoint.controls.map(row=>row.controlId)){
 if(endpoint.expiresAt<=new Date())return 'ENDPOINT_EXPIRED';
 if(endpoint.state==='REVOKED'||!endpoint.encryptedSecret)return 'ENDPOINT_REVOKED';
 if(ids.some(id=>!endpoint.controls.some(grant=>grant.controlId===id)))return 'CONTROL_SCOPE_CHANGED';
 const organizationId=endpoint.organizationId,controls=await tx.managedControl.findMany({where:{organizationId,id:{in:ids},enabled:true,programmeImport:{status:'ACCEPTED'}},select:{id:true,ownerId:true}});
 if(controls.length!==ids.length)return 'CONTROL_UNAVAILABLE';
 const people=await completionParticipants(tx,{organizationId,userId:endpoint.configuredById,role:'ADMIN'},[endpoint.configuredById,...controls.map(row=>row.ownerId)]),allowed=(id:string,roles:string[])=>people.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
 if(!allowed(endpoint.configuredById,ADMIN))return 'ISSUER_UNAVAILABLE';
 if(controls.some(row=>!allowed(row.ownerId,WRITER)))return 'CONTROL_OWNER_UNAVAILABLE';
 return null;
}
export function parsedDelivery(row:DeliveryRecord):DeliveryEnvelope|null{
 const event=deliveryEnvelopeSchema.safeParse(row.event.payload),scoped=deliveryEnvelopeSchema.safeParse(row.payload);
 if(!event.success||!scoped.success||hashValue(event.data)!==row.event.payloadHash||hashValue(scoped.data)!==row.payloadHash||row.organizationId!==row.event.organizationId||row.organizationId!==row.endpoint.organizationId||row.eventId!==event.data.id||event.data.organizationId!==row.organizationId||row.event.eventType!==event.data.type||row.event.sourceKind!==event.data.source.kind||row.event.sourceId!==event.data.source.id||row.event.sourceVersion!==event.data.source.version||row.event.occurredAt.toISOString()!==event.data.occurredAt||hashValue(row.event.controlIds)!==hashValue(event.data.controlIds)||hashValue(row.controlIds)!==hashValue(scoped.data.controlIds)||row.controlIds.length>50||row.controlIds.some(id=>!event.data.controlIds.includes(id))||hashValue({...event.data,controlIds:row.controlIds})!==row.payloadHash)return null;
 return scoped.data;
}
export async function deliveryEligibility(tx:Prisma.TransactionClient,row:DeliveryRecord){
 const envelope=parsedDelivery(row);if(!envelope)return {code:'PAYLOAD_INTEGRITY_FAILED',envelope:null};
 if(row.event.expiresAt<=new Date())return {code:'EVENT_EXPIRED',envelope};
 if(row.endpoint.version!==row.endpointVersion||row.endpoint.secretVersion!==row.secretVersion)return {code:'ENDPOINT_CHANGED',envelope};
 const probe=envelope.type==='endpoint.probe',authority=await endpointAuthority(tx,row.endpoint,probe?undefined:row.controlIds);
 if(authority)return {code:authority,envelope};
 if(probe?row.endpoint.state!=='DRAFT':row.endpoint.state!=='ACTIVE'||row.endpoint.verifiedVersion!==row.endpoint.version)return {code:'ENDPOINT_INACTIVE',envelope};
 if(!probe&&!row.endpoint.eventTypes.includes(envelope.type))return {code:'EVENT_SCOPE_CHANGED',envelope};
 if(!await integrationEventCurrent(tx,envelope))return {code:'SOURCE_UNAVAILABLE',envelope};
 return {code:null,envelope};
}
