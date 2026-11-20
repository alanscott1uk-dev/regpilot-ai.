import {z} from 'zod';

export const DELIVERY_VERSION='2026-11-20' as const;
export const DELIVERY_EVENTS=['customer.observation.received','customer.observation.reviewed','connector.observation.recorded','connector.collection.failed'] as const;
export type DeliveryEventType=typeof DELIVERY_EVENTS[number];
export const DELIVERY_LABELS:Record<DeliveryEventType,string>={
 'customer.observation.received':'Customer observation received',
 'customer.observation.reviewed':'Administrator observation decision',
 'connector.observation.recorded':'Verified connector collection recorded',
 'connector.collection.failed':'Connector collection failed'
};
export const DELIVERY_LIMITS={activeEndpoints:10,controls:50,endpointDays:90,pendingPerEndpoint:200,attemptsPerCycle:6,replays:3,endpointPerMinute:6,companyPerMinute:30,companyPerDay:2000,eventHours:72,historyDays:30,pageSize:50,requestBytes:16384,responseBytes:4096,requestMs:8000,leaseMs:30000} as const;

/** URL syntax is checked again in the transport; DNS and connection pinning are
 * server-only. Query strings and credentials are deliberately not supported. */
export function validDeliveryUrl(value:string){
 try{
  const url=new URL(value),host=url.hostname.toLowerCase();
  return value.length<=2048&&url.protocol==='https:'&&(!url.port||url.port==='443')&&!url.username&&!url.password&&!url.search&&!url.hash&&
   !host.endsWith('.')&&host.includes('.')&&host.length<=253&&/^[a-z0-9.-]+$/.test(host)&&!/^\d+(\.\d+){3}$/.test(host)&&
   host.split('.').every(part=>part.length>0&&part.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))&&
   !['localhost','local','internal','test','invalid','example','onion','home','lan','arpa'].some(suffix=>host===suffix||host.endsWith('.'+suffix));
 }catch{return false;}
}
const unique=<T,>(values:T[])=>new Set(values).size===values.length;
export const createDeliveryEndpointInput=z.object({
 name:z.string().trim().min(3).max(100),url:z.string().trim().max(2048).refine(validDeliveryUrl,'Use a public HTTPS hostname on port 443, without query strings or credentials'),
 eventTypes:z.array(z.enum(DELIVERY_EVENTS)).min(1).max(DELIVERY_EVENTS.length).refine(unique),controlIds:z.array(z.uuid()).min(1).max(DELIVERY_LIMITS.controls).refine(unique),
 expiresAt:z.iso.datetime(),requestKey:z.uuid(),confirm:z.literal(true)
}).strict();
export const changeDeliveryEndpointInput=z.object({action:z.enum(['PROBE','PAUSE','RESUME','ROTATE','REVOKE']),version:z.number().int().positive(),requestKey:z.uuid(),confirm:z.literal(true)}).strict();
export const replayDeliveryInput=z.object({version:z.number().int().positive(),requestKey:z.uuid(),confirm:z.literal(true)}).strict();
const source=z.object({kind:z.enum(['CUSTOMER_OBSERVATION','CONNECTOR_RUN','CONNECTOR_FAILURE','ENDPOINT']),id:z.uuid(),version:z.number().int().positive()}).strict();
const common={apiVersion:z.literal(DELIVERY_VERSION),id:z.uuid(),organizationId:z.uuid(),occurredAt:z.iso.datetime(),source,controlIds:z.array(z.uuid()).max(500)};
export const deliveryEnvelopeSchema=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('endpoint.probe'),data:z.object({endpointId:z.uuid(),challenge:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
 z.object({...common,type:z.literal('customer.observation.received'),data:z.object({observationId:z.uuid(),credentialId:z.uuid(),reportedOutcome:z.enum(['REPORTED_PASS','REPORTED_FAILURE','REPORTED_UNKNOWN']),validUntil:z.iso.datetime()}).strict()}).strict(),
 z.object({...common,type:z.literal('customer.observation.reviewed'),data:z.object({observationId:z.uuid(),credentialId:z.uuid(),reportedOutcome:z.enum(['REPORTED_PASS','REPORTED_FAILURE','REPORTED_UNKNOWN']),decision:z.enum(['ACKNOWLEDGED','REJECTED','FOLLOW_UP']),followUpTaskId:z.uuid().nullable(),validUntil:z.iso.datetime()}).strict()}).strict(),
 z.object({...common,type:z.literal('connector.observation.recorded'),data:z.object({connectorId:z.uuid(),runId:z.uuid(),outcome:z.enum(['OBSERVED','FOLLOW_UP','INCOMPLETE']),resultHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
 z.object({...common,type:z.literal('connector.collection.failed'),data:z.object({connectorId:z.uuid(),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)}).strict()}).strict()
]);
export type DeliveryEnvelope=z.infer<typeof deliveryEnvelopeSchema>;
export function deliveryBackoff(attempt:number,retryAfterSeconds=0){
 const intervals=[60,300,900,3600,21600];
 return Math.max(intervals[Math.min(intervals.length-1,Math.max(0,attempt-1))],Math.min(86400,Math.max(0,retryAfterSeconds)))*1000;
}
export function deliveryHttpOutcome(status:number){return status>=200&&status<300?'DELIVERED':status===408||status===429||status>=500&&status<=599?'RETRY':'DEAD';}
