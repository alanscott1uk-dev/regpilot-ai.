import {Prisma} from '@prisma/client';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DELIVERY_EVENTS,DELIVERY_LIMITS,DELIVERY_VERSION,createDeliveryEndpointInput,changeDeliveryEndpointInput,replayDeliveryInput} from '../integration-delivery';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import {encryptConnectorSecret} from './connector-secret';
import {newDeliverySecret} from './integration-delivery-transport';
import {enqueueIntegrationEvent,outboundIntegrationsEnabled} from './integration-delivery-events';
import {endpointInclude,endpointAuthority,deliveryInclude,deliveryEligibility,parsedDelivery} from './integration-delivery-state';
type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const org=(c:{organizationId:string})=>({organizationId:c.organizationId});
export const deliverySecretContext=(id:string)=>'outbound-delivery:'+id;
async function priorOperation(tx:Tx,c:AuthorizedContext,key:string,hash:string){const row=await tx.integrationOperation.findUnique({where:{organizationId_requestKey:{organizationId:c.organizationId,requestKey:key}}});if(row&&(row.actorId!==c.userId||row.requestHash!==hash||row.resultHash!==hashValue(row.result)))throw new IntelligenceError('This request identity belongs to a different integration operation',409);return row;}
async function receipt(tx:Tx,c:AuthorizedContext,requestKey:string,requestHash:string,action:string,entityId:string,result:unknown){await tx.integrationOperation.create({data:{...org(c),actorId:c.userId,requestKey,requestHash,action,entityId,result:json(result),resultHash:hashValue(result)}});await tx.auditEvent.create({data:{...org(c),actorId:c.userId,action:'integration_delivery.'+action.toLowerCase(),entityType:'IntegrationAdministration',entityId,details:json({requestHash,...result as object})}});}
async function cancelPending(tx:Tx,organizationId:string,endpointId:string,code:string){await tx.integrationAttempt.updateMany({where:{organizationId,state:'SENDING',delivery:{endpointId}},data:{state:'CANCELLED',errorCode:code,finishedAt:new Date()}});await tx.integrationDelivery.updateMany({where:{organizationId,endpointId,state:{in:['PENDING','SENDING']}},data:{state:'CANCELLED',version:{increment:1},lastErrorCode:code,finishedAt:new Date(),leaseToken:null,leaseUntil:null}});}

export async function createIntegrationEndpoint(c:AuthorizedContext,input:unknown){const d=createDeliveryEndpointInput.parse(input),requestHash=hashValue({...d,eventTypes:[...d.eventTypes].sort(),controlIds:[...d.controlIds].sort()});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const prior=await priorOperation(tx,c,d.requestKey,requestHash);if(prior)return {...prior.result as object,secret:null,secretUnavailable:true,reused:true};
 const expiresAt=new Date(d.expiresAt);if(expiresAt.getTime()<=Date.now()+60000||expiresAt.getTime()>Date.now()+DELIVERY_LIMITS.endpointDays*86400000)throw new IntelligenceError('Choose an expiry within the next 90 days',400);
 if(await tx.integrationEndpoint.count({where:{...org(c),state:{not:'REVOKED'},expiresAt:{gt:new Date()}}})>=DELIVERY_LIMITS.activeEndpoints)throw new IntelligenceError('Revoke an unused endpoint before adding more than 10 active configurations',429);
 const controls=await tx.managedControl.findMany({where:{...org(c),id:{in:d.controlIds},enabled:true,programmeImport:{status:'ACCEPTED'}},select:{id:true}});if(controls.length!==d.controlIds.length)throw new IntelligenceError('Select current accepted company controls',409);
 const id=randomUUID(),secret=newDeliverySecret();await tx.integrationEndpoint.create({data:{id,...org(c),configuredById:c.userId,name:d.name,url:new URL(d.url).href,eventTypes:[...d.eventTypes].sort(),expiresAt,secretHint:secret.slice(-8),encryptedSecret:encryptConnectorSecret(secret,c.organizationId,deliverySecretContext(id))}});
 await tx.integrationEndpointControl.createMany({data:d.controlIds.map(controlId=>({...org(c),endpointId:id,controlId}))});const endpoint=await tx.integrationEndpoint.findUniqueOrThrow({where:{id},include:endpointInclude});
 const reason=await endpointAuthority(tx,endpoint);if(reason)throw new IntelligenceError('Endpoint scope needs review: '+reason,409);
 const result={id,version:endpoint.version,state:endpoint.state,requestKey:d.requestKey};await receipt(tx,c,d.requestKey,requestHash,'CREATED',id,result);return {...result,secret,secretUnavailable:false,reused:false};
});}
export async function changeIntegrationEndpoint(c:AuthorizedContext,id:string,input:unknown){z.uuid().parse(id);const d=changeDeliveryEndpointInput.parse(input),requestHash=hashValue({id,...d});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const prior=await priorOperation(tx,c,d.requestKey,requestHash);if(prior)return {...prior.result as object,secret:null,secretUnavailable:d.action==='ROTATE',reused:true};
 const row=await tx.integrationEndpoint.findFirst({where:{id,...org(c)},include:endpointInclude});if(!row)throw new IntelligenceError('Delivery endpoint not found',404);if(row.version!==d.version)throw new IntelligenceError('The endpoint changed; refresh before continuing',409);if(row.state==='REVOKED')throw new IntelligenceError('A revoked endpoint cannot be reactivated',409);
 let secret:string|null=null,deliveryId:string|null=null,saved=row;
 if(d.action==='PROBE'){
  if(!outboundIntegrationsEnabled())throw new IntelligenceError('Outbound delivery awaits environment activation',503);
  if(row.state!=='DRAFT')throw new IntelligenceError('Only a draft endpoint needs a verification challenge',409);
  const reason=await endpointAuthority(tx,row);if(reason)throw new IntelligenceError('Endpoint cannot be verified: '+reason,409);
  const eventId=await enqueueIntegrationEvent(tx,{apiVersion:DELIVERY_VERSION,id:randomUUID(),type:'endpoint.probe',organizationId:c.organizationId,occurredAt:new Date().toISOString(),source:{kind:'ENDPOINT',id,version:row.version},controlIds:[],data:{endpointId:id,challenge:randomBytes(32).toString('hex')}},{endpointId:id});
  if(!eventId)throw new IntelligenceError('The verification challenge was not queued',409);
  deliveryId=(await tx.integrationDelivery.findUniqueOrThrow({where:{endpointId_eventId:{endpointId:id,eventId}}})).id;
 }else{
  if(d.action!=='REVOKE'&&row.expiresAt<=new Date())throw new IntelligenceError('This endpoint expired; create a new expiring configuration',409);
  if(d.action==='RESUME'&&(row.state!=='PAUSED'||row.verifiedVersion!==row.version))throw new IntelligenceError('Only a paused, verified endpoint can resume; rotate and verify a new secret otherwise',409);
  if(d.action==='PAUSE'&&row.state!=='ACTIVE')throw new IntelligenceError('Only an active endpoint can be paused',409);
  if(d.action==='RESUME'){const reason=await endpointAuthority(tx,row);if(reason)throw new IntelligenceError('Endpoint scope needs review: '+reason,409);}
  if(d.action==='ROTATE')secret=newDeliverySecret();
  await cancelPending(tx,c.organizationId,id,d.action==='REVOKE'?'ENDPOINT_REVOKED':'ENDPOINT_CHANGED');
  saved=await tx.integrationEndpoint.update({where:{id},data:{version:{increment:1},leaseToken:null,leaseUntil:null,...(d.action==='ROTATE'?{state:'DRAFT',secretVersion:{increment:1},encryptedSecret:encryptConnectorSecret(secret!,c.organizationId,deliverySecretContext(id)),secretHint:secret!.slice(-8),verifiedAt:null,verifiedVersion:null,failureCode:null}:d.action==='REVOKE'?{state:'REVOKED',encryptedSecret:null}:{state:d.action==='PAUSE'?'PAUSED':'ACTIVE',verifiedVersion:row.verifiedVersion===row.version?row.version+1:null})},include:endpointInclude});
 }
 const result={id,version:saved.version,state:saved.state,deliveryId,requestKey:d.requestKey};await receipt(tx,c,d.requestKey,requestHash,d.action,id,result);return {...result,secret,secretUnavailable:false,reused:false};
});}
export async function replayIntegrationDelivery(c:AuthorizedContext,id:string,input:unknown){z.uuid().parse(id);const d=replayDeliveryInput.parse(input),requestHash=hashValue({id,...d});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const prior=await priorOperation(tx,c,d.requestKey,requestHash);if(prior)return {...prior.result as object,reused:true};
 const row=await tx.integrationDelivery.findFirst({where:{id,...org(c)},include:deliveryInclude});if(!row)throw new IntelligenceError('Delivery not found',404);if(row.version!==d.version||!['DEAD','DELIVERED'].includes(row.state))throw new IntelligenceError('Only a current terminal delivery can be explicitly replayed',409);if(row.replayCount>=DELIVERY_LIMITS.replays)throw new IntelligenceError('This delivery reached its three-replay allowance',409);
 const current=await deliveryEligibility(tx,row);if(current.code)throw new IntelligenceError('This delivery cannot be replayed: '+current.code,409);if(!outboundIntegrationsEnabled())throw new IntelligenceError('Outbound delivery awaits activation',503);
 const rowCount=await tx.integrationDelivery.count({where:{...org(c),endpointId:row.endpointId,state:{in:['PENDING','SENDING']}}});if(rowCount>=DELIVERY_LIMITS.pendingPerEndpoint)throw new IntelligenceError('The endpoint queue must drain before replaying another delivery',429);
 const saved=await tx.integrationDelivery.update({where:{id},data:{state:'PENDING',version:{increment:1},cycleAttempts:0,replayCount:{increment:1},availableAt:new Date(),leaseToken:null,leaseUntil:null,lastErrorCode:null,lastHttpStatus:null,finishedAt:null}}),result={id,version:saved.version,endpointId:row.endpointId,requestKey:d.requestKey};await receipt(tx,c,d.requestKey,requestHash,'REPLAY',id,result);return {...result,reused:false};
});}

export async function integrationWorkspace(c:AuthorizedContext,options:{endpointId?:string;deliveryId?:string;requestKey?:string;beforeId?:string}={}){for(const value of Object.values(options))if(value)z.uuid().parse(value);return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const anchor=options.beforeId?await tx.integrationDelivery.findFirst({where:{id:options.beforeId,...org(c)},select:{id:true,createdAt:true}}):null;if(options.beforeId&&!anchor)throw new IntelligenceError('Delivery page unavailable for this company',404);
 const [recent,active,linkedEndpoint,rows,linkedDelivery,groups,oldest,controls,operation,observed]=await Promise.all([
  tx.integrationEndpoint.findMany({where:org(c),orderBy:{createdAt:'desc'},take:100,include:endpointInclude}),
  tx.integrationEndpoint.findMany({where:{...org(c),state:{not:'REVOKED'},expiresAt:{gt:new Date()}},include:endpointInclude,take:DELIVERY_LIMITS.activeEndpoints}),
  options.endpointId?tx.integrationEndpoint.findFirst({where:{...org(c),id:options.endpointId},include:endpointInclude}):null,
  tx.integrationDelivery.findMany({where:{...org(c),...(options.endpointId?{endpointId:options.endpointId}:{}),...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{gt:anchor.id}}]}:{})},orderBy:[{createdAt:'desc'},{id:'asc'}],take:51,include:{...deliveryInclude,deliveryAttempts:{orderBy:{number:'desc'},take:24}}}),
  options.deliveryId?tx.integrationDelivery.findFirst({where:{...org(c),id:options.deliveryId},include:{...deliveryInclude,deliveryAttempts:{orderBy:{number:'desc'},take:24}}}):null,
  tx.integrationDelivery.groupBy({by:['state'],where:org(c),_count:true}),
  tx.integrationDelivery.findFirst({where:{...org(c),state:{in:['PENDING','SENDING']}},orderBy:{createdAt:'asc'},select:{createdAt:true}}),
  tx.managedControl.findMany({where:{...org(c),enabled:true,programmeImport:{status:'ACCEPTED'}},select:{id:true,title:true},orderBy:{title:'asc'},take:200}),
  options.requestKey?tx.integrationOperation.findFirst({where:{...org(c),actorId:c.userId,requestKey:options.requestKey}}):null,
  tx.integrationAttempt.aggregate({where:{...org(c),startedAt:{gte:new Date(Date.now()-86400000)},state:'DELIVERED'},_count:true,_avg:{durationMs:true},_max:{finishedAt:true}})
 ]);
 if(options.endpointId&&!linkedEndpoint||options.deliveryId&&!linkedDelivery)throw new IntelligenceError('The linked delivery record is unavailable for this company',404);
 if(operation&&operation.resultHash!==hashValue(operation.result))throw new IntelligenceError('The saved operation receipt could not be verified',409);
 const endpointRows=[...new Map([...recent,...active,...(linkedEndpoint?[linkedEndpoint]:[])].map(row=>[row.id,row])).values()],endpoints=[];
 for(const row of endpointRows){const reason=await endpointAuthority(tx,row);endpoints.push({id:row.id,name:row.name,url:row.url,eventTypes:row.eventTypes,controlIds:row.controls.map(grant=>grant.controlId),state:row.state,status:reason||row.state,version:row.version,secretVersion:row.secretVersion,secretHint:row.secretHint,expiresAt:row.expiresAt.toISOString(),verifiedAt:row.verifiedAt?.toISOString()||null,verifiedCurrent:row.verifiedVersion===row.version,createdAt:row.createdAt.toISOString(),lastDeliveredAt:row.lastDeliveredAt?.toISOString()||null,lastFailureAt:row.lastFailureAt?.toISOString()||null,failureCode:row.failureCode,skippedCount:row.skippedCount,lastSkippedAt:row.lastSkippedAt?.toISOString()||null});}
 const deliveryRows=[...new Map([...rows.slice(0,50),...(linkedDelivery?[linkedDelivery]:[])].map(row=>[row.id,row])).values()],deliveries=[];
 for(const row of deliveryRows){const payload=parsedDelivery(row);deliveries.push({id:row.id,eventId:row.eventId,endpointId:row.endpointId,endpointName:row.endpoint.name,type:payload?.type||'unavailable',source:payload?.source||null,controlIds:row.controlIds,state:row.state,version:row.version,attempts:row.attempts,replayCount:row.replayCount,availableAt:row.availableAt.toISOString(),expiresAt:row.event.expiresAt.toISOString(),createdAt:row.createdAt.toISOString(),deliveredAt:row.deliveredAt?.toISOString()||null,lastErrorCode:row.lastErrorCode,lastHttpStatus:row.lastHttpStatus,integrityValid:!!payload,attemptHistory:row.deliveryAttempts.map(attempt=>({number:attempt.number,state:attempt.state,startedAt:attempt.startedAt.toISOString(),finishedAt:attempt.finishedAt?.toISOString()||null,httpStatus:attempt.httpStatus,durationMs:attempt.durationMs,responseBytes:attempt.responseBytes,errorCode:attempt.errorCode}))});}
 return {enabled:outboundIntegrationsEnabled(),dispatcherEnabled:process.env.REGPILOT_AUTOMATION_ENABLED==='true'&&(process.env.REGPILOT_WORKER_ENABLED==='true'||process.env.REGPILOT_CRON_ENABLED==='true'),version:DELIVERY_VERSION,limits:DELIVERY_LIMITS,eventTypes:DELIVERY_EVENTS,endpoints,controls,deliveries,page:{hasMore:rows.length>50,beforeId:rows.length>50?rows[49].id:null},health:{counts:Object.fromEntries(groups.map(row=>[row.state,row._count])),oldestPendingAt:oldest?.createdAt.toISOString()||null,acknowledgedLast24Hours:observed._count,meanAcknowledgedMs:observed._avg.durationMs===null?null:Math.round(observed._avg.durationMs),lastAcknowledgedAt:observed._max.finishedAt?.toISOString()||null},operation:operation?{requestKey:operation.requestKey,action:operation.action,entityId:operation.entityId,result:operation.result}:null};
});}
