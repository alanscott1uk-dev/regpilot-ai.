import {partnerValidity} from '../partner-records';
import {Prisma,type CustomerApiObservation} from '@prisma/client';
import {z} from 'zod';
import {CUSTOMER_API_LIMITS,CUSTOMER_API_SCOPES,CUSTOMER_API_VERSION,createCustomerCredentialInput,changeCustomerCredentialInput,customerObservationInput,reviewCustomerObservationInput,reportedObservationOutcome,type CustomerApiScope} from '../customer-api';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {activeOwner} from './library-service';
import {completionParticipants} from './work-completion-service';
import {CustomerApiError,customerApiConfigured,newCustomerApiSecret,customerApiTransaction,customerApiPage,nextCustomerApiCursor,type CustomerApiSession,type CustomerApiPrincipal} from './customer-api-auth';
import {enqueueCustomerObservationDelivery} from './integration-delivery-events';

type Tx=Prisma.TransactionClient;
const org=(c:{organizationId:string})=>({organizationId:c.organizationId});
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const contextSchema=z.object({format:z.literal('customer-observation-v1'),credentialId:z.uuid(),issuedById:z.uuid(),control:z.object({id:z.uuid(),version:z.number().int().positive(),title:z.string(),ownerId:z.uuid(),enabled:z.boolean(),importId:z.uuid(),programmeStatus:z.string(),procedureHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict();
const rowInclude={credential:{select:{id:true,name:true,issuedById:true,version:true,expiresAt:true,revokedAt:true,scopes:true,controls:{select:{controlId:true}}}},control:{include:{programmeImport:{select:{status:true}}}}} as const;
type ObservationRow=Prisma.CustomerApiObservationGetPayload<{include:typeof rowInclude}>;
function controlSnapshot(control:ObservationRow['control']){return {id:control.id,version:control.version,title:control.title,ownerId:control.ownerId,enabled:control.enabled,importId:control.importId,programmeStatus:control.programmeImport.status,procedureHash:hashValue({description:control.description,procedure:control.testProcedure})};}
async function operation(tx:Tx,c:AuthorizedContext,requestKey:string,requestHash:string){const old=await tx.customerApiOperation.findUnique({where:{organizationId_requestKey:{organizationId:c.organizationId,requestKey}}});if(old&&(old.actorId!==c.userId||old.requestHash!==requestHash))throw new IntelligenceError('This request key belongs to a different developer operation',409);return old;}
async function recordOperation(tx:Tx,c:AuthorizedContext,requestKey:string,requestHash:string,action:string,entityId:string,result:unknown){await tx.customerApiOperation.create({data:{...org(c),actorId:c.userId,requestKey,requestHash,action,entityId,result:json(result)}});await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:'CustomerApiAdministration',entityId,action:'customer_api.'+action.toLowerCase(),details:json({requestHash,...result as object})}});}
function credentialView(row:Prisma.CustomerApiCredentialGetPayload<{include:{controls:{select:{controlId:true}}}}>,authorityCurrent:boolean) {return {id:row.id,name:row.name,scopes:row.scopes,controlIds:row.controls.map(grant=>grant.controlId),hint:row.hint,version:row.version,issuedById:row.issuedById,expiresAt:row.expiresAt.toISOString(),revokedAt:row.revokedAt?.toISOString()||null,lastUsedAt:row.lastUsedAt?.toISOString()||null,createdAt:row.createdAt.toISOString(),authorityCurrent,status:row.revokedAt?'REVOKED':row.expiresAt<=new Date()?'EXPIRED':!authorityCurrent?'ISSUER_UNAVAILABLE':'ACTIVE'};}
async function observationsView(tx:Tx,c:{organizationId:string},rows:ObservationRow[]){
 const people=await completionParticipants(tx,{organizationId:c.organizationId,userId:'',role:'ADMIN'},rows.flatMap(row=>[row.credential.issuedById,row.control.ownerId,row.reviewerId]));
 const allowed=(id:string,roles:string[])=>people.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
 return rows.map(row=>{
  let payload:z.infer<typeof customerObservationInput>|null=null,current=false,reason='';
  try{if(row.purgedAt||row.retentionEndsAt&&row.retentionEndsAt<=new Date())throw new Error('The specialist retention period ended. Only its receipt remains.');const parsed=customerObservationInput.parse(row.payload),context=contextSchema.parse(row.context);if(hashValue(parsed)!==row.payloadHash||hashValue(context)!==row.contextHash||context.credentialId!==row.credentialId||context.issuedById!==row.credential.issuedById||parsed.controlId!==row.controlId||parsed.externalId!==row.externalId||parsed.observedAt!==row.observedAt.toISOString()||parsed.validUntil!==row.validUntil.toISOString())throw new Error('Submission integrity failed');payload=parsed;
   if(row.supersededAt)throw new Error('A later source revision superseded this record');
   if(parsed.partnerRecord){
    const source=parsed.partnerRecord;
    if(source.revision!==row.partnerRevision||row.partnerKey!==hashValue({kind:source.record.kind,recordId:source.recordId}))throw new Error('Partner revision integrity failed');
    const restriction=partnerValidity(source,Date.now());if(restriction)throw new Error(restriction);
   }
   if(row.validUntil<=new Date())throw new Error('The submitted observation expired');
   if(row.credential.revokedAt||row.credential.expiresAt<=new Date()||!allowed(row.credential.issuedById,ADMIN))throw new Error('The integration credential or its issuer is no longer authorised');
   if(!row.credential.scopes.includes('observations:write')||!row.credential.controls.some(grant=>grant.controlId===row.controlId))throw new Error('The integration no longer has permission to submit observations for this control');
   if(!allowed(row.control.ownerId,WRITER)||row.reviewerId&&!allowed(row.reviewerId,ADMIN))throw new Error('The control owner or recorded administrator no longer has current permission');
   if(!row.control.enabled||row.control.programmeImport.status!=='ACCEPTED'||hashValue(context.control)!==hashValue(controlSnapshot(row.control)))throw new Error('The control configuration or owner changed since this submission');
   if(row.status==='REJECTED')throw new Error('An administrator rejected this submission');current=true;
  }catch(error){reason=error instanceof z.ZodError?'Submission integrity failed':error instanceof Error?error.message:'Submission unavailable';}
  return {id:row.id,requestKey:row.requestKey,receiptHash:row.payloadHash,supersededAt:row.supersededAt?.toISOString()||null,externalId:row.externalId,controlId:row.controlId,controlTitle:row.control.title,source:{kind:'CUSTOMER_API_CLIENT' as const,credentialId:row.credentialId,name:row.credential.name,credentialVersion:row.credentialVersion},status:row.status,version:row.version,current,reason,payload,reportedOutcome:payload?reportedObservationOutcome(payload):null,observedAt:row.observedAt.toISOString(),receivedAt:row.receivedAt.toISOString(),validUntil:row.validUntil.toISOString(),reviewerId:row.reviewerId,reviewedAt:row.reviewedAt?.toISOString()||null,reviewNotes:row.reviewNotes,followUpTaskId:row.followUpTaskId,limitation:'Customer-submitted observations are unverified reports. Receipt, acknowledgement and follow-up do not approve evidence, certify compliance or complete a control.'};
 });
}

export async function developerWorkspace(c:AuthorizedContext,options:{requestKey?:string;credentialId?:string;observationId?:string;beforeId?:string;all?:boolean}={}){for(const value of [options.requestKey,options.credentialId,options.observationId,options.beforeId])if(value)z.uuid().parse(value);return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const anchor=options.beforeId?await tx.customerApiObservation.findFirst({where:{id:options.beforeId,...org(c)},select:{id:true,receivedAt:true}}):null;
 if(options.beforeId&&!anchor)throw new IntelligenceError('The observation page is unavailable for this company',404);
 const [recent,active,controls,members,rows,op,linkedCredential,linkedObservation,pendingCount]=await Promise.all([
  tx.customerApiCredential.findMany({where:org(c),orderBy:{createdAt:'desc'},take:100,include:{controls:{select:{controlId:true}}}}),
  tx.customerApiCredential.findMany({where:{...org(c),revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'},take:CUSTOMER_API_LIMITS.activeCredentials+1,include:{controls:{select:{controlId:true}}}}),
  tx.managedControl.findMany({where:{...org(c),enabled:true,programmeImport:{status:'ACCEPTED'}},select:{id:true,title:true,version:true,ownerId:true},orderBy:{title:'asc'},take:200}),
  tx.membership.findMany({where:{...org(c),role:{in:['OWNER','ADMIN','EDITOR']}},select:{user:{select:{id:true,email:true}},role:true},take:100}),
  tx.customerApiObservation.findMany({where:{...org(c),...(!options.all?{status:'PENDING'}:{}),...(anchor?{OR:[{receivedAt:{lt:anchor.receivedAt}},{receivedAt:anchor.receivedAt,id:{gt:anchor.id}}]}:{})},include:rowInclude,orderBy:[{receivedAt:'desc'},{id:'asc'}],take:51}),
  options.requestKey?tx.customerApiOperation.findFirst({where:{...org(c),actorId:c.userId,requestKey:options.requestKey},select:{requestKey:true,action:true,entityId:true,result:true}}):null,
  options.credentialId?tx.customerApiCredential.findFirst({where:{id:options.credentialId,...org(c)},include:{controls:{select:{controlId:true}}}}):null,
  options.observationId?tx.customerApiObservation.findFirst({where:{id:options.observationId,...org(c)},include:rowInclude}):null,
  tx.customerApiObservation.count({where:{...org(c),status:'PENDING'}})
 ]);
 if(options.credentialId&&!linkedCredential||options.observationId&&!linkedObservation)throw new IntelligenceError('The linked integration record is unavailable for this company',404);
 const visibleRows=[...new Map([...rows.slice(0,50),...(linkedObservation?[linkedObservation]:[])].map(row=>[row.id,row])).values()],credentialRows=[...new Map([...recent,...active,...(linkedCredential?[linkedCredential]:[])].map(row=>[row.id,row])).values()],issuers=await completionParticipants(tx,c,credentialRows.map(row=>row.issuedById));
 return {enabled:customerApiConfigured(),apiVersion:CUSTOMER_API_VERSION,limits:CUSTOMER_API_LIMITS,scopes:CUSTOMER_API_SCOPES,credentials:credentialRows.map(row=>credentialView(row,issuers.some(person=>person.id===row.issuedById&&person.approved&&ADMIN.includes(person.role as typeof ADMIN[number])))),controls,members:members.map(member=>({...member.user,role:member.role})),observations:await observationsView(tx,c,visibleRows),observationPage:{hasMore:rows.length>50,beforeId:rows.length>50?rows[49].id:null,pendingCount,all:!!options.all},operation:op};
});}
export async function createCustomerCredential(c:AuthorizedContext,input:unknown){const d=createCustomerCredentialInput.parse(input),requestHash=hashValue({...d,scopes:[...d.scopes].sort(),controlIds:[...d.controlIds].sort()});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const prior=await operation(tx,c,d.requestKey,requestHash);if(prior)return {...prior.result as object,secret:null,reused:true,secretUnavailable:true};
 const expiry=new Date(d.expiresAt);if(expiry.getTime()<=Date.now()+60000||expiry.getTime()>Date.now()+CUSTOMER_API_LIMITS.credentialDays*86400000)throw new IntelligenceError('Choose an expiry within the next 90 days',400);
 if(await tx.customerApiCredential.count({where:{...org(c),revokedAt:null,expiresAt:{gt:new Date()}}})>=CUSTOMER_API_LIMITS.activeCredentials)throw new IntelligenceError('The company already has 20 active API credentials. Revoke an unused credential first.',429);
 const controls=await tx.managedControl.findMany({where:{...org(c),id:{in:d.controlIds},enabled:true,programmeImport:{status:'ACCEPTED'}},select:{id:true}});if(controls.length!==d.controlIds.length)throw new IntelligenceError('Select current accepted controls from this company',409);
 const secret=newCustomerApiSecret(),credential=await tx.customerApiCredential.create({data:{id:secret.id,...org(c),issuedById:c.userId,name:d.name,scopes:[...d.scopes].sort(),secretHash:secret.secretHash,hint:secret.hint,expiresAt:expiry}});
 if(d.controlIds.length)await tx.customerApiControlGrant.createMany({data:d.controlIds.map(controlId=>({...org(c),credentialId:credential.id,controlId}))});
 const result={id:credential.id,version:credential.version,requestKey:d.requestKey};await recordOperation(tx,c,d.requestKey,requestHash,'CREATED',credential.id,result);return {...result,secret:secret.token,reused:false,secretUnavailable:false};
});}
export async function changeCustomerCredential(c:AuthorizedContext,id:string,input:unknown){z.uuid().parse(id);const d=changeCustomerCredentialInput.parse(input),requestHash=hashValue({id,...d});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const prior=await operation(tx,c,d.requestKey,requestHash);if(prior)return {...prior.result as object,secret:null,reused:true,secretUnavailable:d.action==='ROTATE'};
 const row=await tx.customerApiCredential.findFirst({where:{id,...org(c)}});if(!row)throw new IntelligenceError('API credential not found',404);if(row.version!==d.version)throw new IntelligenceError('API credential changed; refresh before continuing',409);if(row.revokedAt)throw new IntelligenceError('A revoked credential cannot be reactivated. Create a new credential.',409);
 if(d.action==='ROTATE'&&row.expiresAt<=new Date())throw new IntelligenceError('An expired credential cannot be rotated. Create a new expiring credential.',409);
 const secret=d.action==='ROTATE'?newCustomerApiSecret(id):null,changed=await tx.customerApiCredential.update({where:{id},data:{version:{increment:1},...(secret?{secretHash:secret.secretHash,hint:secret.hint}:{revokedAt:new Date()})}}),result={id,version:changed.version,requestKey:d.requestKey};
 await recordOperation(tx,c,d.requestKey,requestHash,d.action==='ROTATE'?'ROTATED':'REVOKED',id,result);return {...result,secret:secret?.token||null,reused:false,secretUnavailable:false};
});}

function pageWhere(page:ReturnType<typeof customerApiPage>,dateField:string){return {[dateField]:{lte:new Date(page.asOf)},...(page.cursor?{OR:[{[dateField]:{gt:new Date(page.cursor.at)}},{[dateField]:new Date(page.cursor.at),id:{gt:page.cursor.id}}]}:{})};}
function pageResult<T extends {id:string}>(session:CustomerApiSession,page:ReturnType<typeof customerApiPage>,resource:string,rows:T[],date:(row:T)=>Date){const data=rows.slice(0,page.limit),last=data.at(-1);return {apiVersion:CUSTOMER_API_VERSION,data,pagination:{hasMore:rows.length>page.limit,nextCursor:rows.length>page.limit&&last?nextCustomerApiCursor(session,page,resource,{id:last.id,createdAt:date(last)}):null,asOf:page.asOf,limit:page.limit}};}
export async function listCustomerApiResource(session:CustomerApiSession,resource:'controls'|'tasks'|'regulatory-sources'|'evidence'|'observations',url:string){
 const scope:CustomerApiScope=resource==='regulatory-sources'?'regulatory:read':`${resource}:read`,page=customerApiPage(session,url,resource,resource==='observations'?['controlId','requestKey']:resource==='tasks'||resource==='evidence'?['controlId']:[]);
 const controlFilter=page.filter.controlId?z.uuid().parse(page.filter.controlId):null,requestKey=page.filter.requestKey?z.uuid().parse(page.filter.requestKey):null;
 return customerApiTransaction(session,scope,async(tx,principal)=>{
  if(controlFilter&&!principal.controlIds.includes(controlFilter))throw new CustomerApiError('Control not found in this credential’s granted scope',404,'not_found');const ids=controlFilter?[controlFilter]:principal.controlIds;
  if(resource==='controls'){
   const rows=await tx.managedControl.findMany({where:{...org(session),id:{in:ids},...pageWhere(page,'createdAt')},orderBy:[{createdAt:'asc'},{id:'asc'}],take:page.limit+1,select:{id:true,title:true,description:true,testProcedure:true,theme:true,enabled:true,version:true,ownerId:true,nextReviewAt:true,createdAt:true,updatedAt:true}});return pageResult(session,page,resource,rows,row=>row.createdAt);
  }
  if(resource==='tasks'){
   const rows=await tx.obligation.findMany({where:{...org(session),controlId:{in:ids},...pageWhere(page,'createdAt')},orderBy:[{createdAt:'asc'},{id:'asc'}],take:page.limit+1,select:{id:true,title:true,category:true,controlId:true,assigneeId:true,dueDate:true,status:true,createdAt:true,updatedAt:true}});return {...pageResult(session,page,resource,rows,row=>row.createdAt),limitation:'Task status is the recorded workflow status; it is not a current compliance certification.'};
  }
  if(resource==='regulatory-sources'){
   const rows=await tx.regulatorySnapshot.findMany({where:{...org(session),reviewStatus:'REVIEWED',...pageWhere(page,'firstCapturedAt')},orderBy:[{firstCapturedAt:'asc'},{id:'asc'}],take:page.limit+1,select:{id:true,sourceId:true,title:true,url:true,contentHash:true,version:true,reviewStatus:true,reviewedAt:true,firstCapturedAt:true,lastCheckedAt:true,sourceFetchedAt:true}});return {...pageResult(session,page,resource,rows,row=>row.firstCapturedAt),limitation:'Reviewed source snapshot metadata may include historical versions. A recorded review does not establish current legal applicability or complete regulatory coverage.'};
  }
  if(resource==='evidence'){
   const rows=await tx.evidence.findMany({where:{...org(session),scanStatus:'CLEAN',reviewStatus:'APPROVED',reviewedAt:{not:null},obligation:{organizationId:session.organizationId,controlId:{in:ids}},...pageWhere(page,'createdAt')},orderBy:[{createdAt:'asc'},{id:'asc'}],take:page.limit+1,select:{id:true,obligationId:true,filename:true,contentType:true,sizeBytes:true,sha256:true,reviewVersion:true,reviewStatus:true,reviewedAt:true,createdAt:true}});return {...pageResult(session,page,resource,rows,row=>row.createdAt),limitation:'Metadata only. Private file bytes, storage paths and download credentials are not exposed by this API.'};
  }
  const rows=await tx.customerApiObservation.findMany({where:{...org(session),credentialId:session.credentialId,controlId:{in:ids},...(requestKey?{requestKey}:{}),...pageWhere(page,'receivedAt')},include:rowInclude,orderBy:[{receivedAt:'asc'},{id:'asc'}],take:page.limit+1}),views=await observationsView(tx,session,rows);
  return pageResult(session,page,resource,views,row=>new Date(row.receivedAt));
 });
}

export async function submitCustomerApiObservation(session:CustomerApiSession,requestKey:string,input:unknown){z.uuid().parse(requestKey);const d=customerObservationInput.parse(input),payload={...d,observedAt:new Date(d.observedAt).toISOString(),validUntil:new Date(d.validUntil).toISOString()},payloadHash=hashValue(payload);
 return customerApiTransaction(session,'observations:write',async(tx,principal)=>{
  if(!principal.controlIds.includes(d.controlId))throw new CustomerApiError('Control not found in this credential’s granted scope',404,'not_found');
  const previous=await tx.customerApiObservation.findUnique({where:{credentialId_requestKey:{credentialId:session.credentialId,requestKey}},include:rowInclude});if(previous){if(previous.payloadHash!==payloadHash)throw new CustomerApiError('This idempotency key belongs to different observation data',409,'idempotency_conflict');return {...(await observationsView(tx,session,[previous]))[0],reused:true};}
  const source=d.partnerRecord,partnerKey=source?hashValue({kind:source.record.kind,recordId:source.recordId}):null;
  if(source&&partnerKey){
   const series={organizationId:session.organizationId,credentialId:session.credentialId,controlId:d.controlId,partnerKey};
   const latest=await tx.customerApiObservation.findFirst({where:series,orderBy:{partnerRevision:'desc'}});
   if(latest?.partnerRevision===source.revision&&latest.payloadHash===payloadHash)return {...(await observationsView(tx,session,[await tx.customerApiObservation.findUniqueOrThrow({where:{id:latest.id},include:rowInclude})]))[0],reused:true};
   if(source.revision!==(latest?.partnerRevision??0)+1||source.previousHash!==(latest?.payloadHash??undefined))throw new CustomerApiError('The record revision or predecessor receipt does not match the latest source record',409,'source_revision_conflict');
   if(latest){
    if(latest.purgedAt)throw new CustomerApiError('This source record reached the end of retention',409,'source_retired');
    const prior=customerObservationInput.parse(latest.payload).partnerRecord;
    if(!prior||prior.sourceSystem!==source.sourceSystem||latest.observedAt>new Date(d.observedAt))throw new CustomerApiError('A revision must retain its source and follow its predecessor in time',409,'source_revision_conflict');
    await tx.customerApiObservation.update({where:{id:latest.id},data:{supersededAt:new Date()}});
   }
  }
  if(await tx.customerApiObservation.findUnique({where:{credentialId_controlId_externalId:{credentialId:session.credentialId,controlId:d.controlId,externalId:d.externalId}}}))throw new CustomerApiError('This external reference is already recorded for the control. Recover the original request, or use a new reference for a new observation.',409,'external_reference_exists');
  const now=Date.now(),observedAt=new Date(d.observedAt),validUntil=new Date(d.validUntil);if(observedAt.getTime()>now+300000||observedAt.getTime()<now-CUSTOMER_API_LIMITS.observationDays*86400000||validUntil.getTime()<=now||validUntil.getTime()<=observedAt.getTime()||validUntil.getTime()>observedAt.getTime()+CUSTOMER_API_LIMITS.observationDays*86400000)throw new CustomerApiError('Observation timestamps must describe the last seven days and expire within seven days of observation',400,'invalid_observation_window');
  const control=await tx.managedControl.findFirst({where:{id:d.controlId,...org(session),enabled:true,programmeImport:{status:'ACCEPTED'}},include:{programmeImport:{select:{status:true}}}});if(!control)throw new CustomerApiError('The granted control is unavailable or paused',409,'control_unavailable');await activeOwner(tx,{organizationId:session.organizationId,userId:session.issuedById,role:'ADMIN'},control.ownerId);
  if(await tx.customerApiObservation.count({where:{...org(session),status:'PENDING',supersededAt:null}})>=CUSTOMER_API_LIMITS.pendingObservations)throw new CustomerApiError('Review pending integration observations before accepting more submissions',429,'review_queue_full');
  if(await tx.customerApiObservation.count({where:{...org(session),receivedAt:{gte:new Date(now-86400000)}}})>=CUSTOMER_API_LIMITS.dailyObservations)throw new CustomerApiError('The daily company observation allowance has been reached',429,'observation_allowance');
  const context=contextSchema.parse({format:'customer-observation-v1',credentialId:session.credentialId,issuedById:session.issuedById,control:controlSnapshot(control)}),row=await tx.customerApiObservation.create({data:{...org(session),credentialId:session.credentialId,credentialVersion:principal.credential.version,controlId:control.id,requestKey,externalId:d.externalId,partnerKey,partnerRevision:source?.revision,retentionEndsAt:source?.record.kind==='SPECIALIST_ATTESTATION'?new Date(Date.parse(source.record.retainUntil+'T00:00:00Z')+86400000):null,payload:json(payload),payloadHash,context:json(context),contextHash:hashValue(context),observedAt,validUntil},include:rowInclude});
  // This durable record attributes the submission to the machine credential. No human audit action is fabricated.
  await enqueueCustomerObservationDelivery(tx,row);
  return {...(await observationsView(tx,session,[row]))[0],reused:false};
 });
}
export async function reviewCustomerApiObservation(c:AuthorizedContext,id:string,input:unknown){z.uuid().parse(id);const d=reviewCustomerObservationInput.parse(input),requestHash=hashValue({id,...d});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const previous=await operation(tx,c,d.requestKey,requestHash);if(previous)return {...previous.result as object,reused:true};
 const row=await tx.customerApiObservation.findFirst({where:{id,...org(c)},include:rowInclude});if(!row)throw new IntelligenceError('Integration observation not found',404);if(row.version!==d.version||row.status!=='PENDING')throw new IntelligenceError('Observation already reviewed or changed; refresh before continuing',409);
 const view=(await observationsView(tx,c,[row]))[0];if(d.decision!=='REJECT'&&!view.current)throw new IntelligenceError(view.reason||'This observation is no longer current',409);if(d.decision==='ACKNOWLEDGE'&&view.reportedOutcome!=='REPORTED_PASS')throw new IntelligenceError('A reported failure or unknown result needs an owned follow-up or rejection',409);
 let followUpTaskId:string|null=null;
 if(d.decision==='FOLLOW_UP'){
  const owner=await activeOwner(tx,c,d.ownerId!),date=new Date(d.dueDate!+'T00:00:00.000Z'),today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00.000Z');if(date<today||date.getTime()>Date.now()+365*86400000)throw new IntelligenceError('Choose a follow-up date from today to one year ahead',400);
  const task=await tx.obligation.create({data:{...org(c),title:('Investigate integration report: '+row.control.title).slice(0,160),category:'Customer integration follow-up',ownerName:owner.user.email,assigneeId:d.ownerId,controlId:row.controlId,originKey:hashValue({customerApiObservation:id}),dueDate:date,status:'OPEN',notes:('Administrator-requested investigation of a customer-submitted integration report.\nIntegration: '+row.credential.name+'\nExternal reference: '+row.externalId+'\nThis report is not verified evidence or a compliance decision.\nReview rationale: '+d.notes).slice(0,3000)}});followUpTaskId=task.id;
 }
 const status=d.decision==='FOLLOW_UP'?'FOLLOW_UP':d.decision==='REJECT'?'REJECTED':'ACKNOWLEDGED',saved=await tx.customerApiObservation.update({where:{id},data:{status,version:{increment:1},reviewerId:c.userId,reviewedAt:new Date(),reviewNotes:d.notes,followUpTaskId}}),result={id,version:saved.version,status,followUpTaskId,requestKey:d.requestKey};await recordOperation(tx,c,d.requestKey,requestHash,'OBSERVATION_REVIEWED',id,result);await enqueueCustomerObservationDelivery(tx,saved,true);return {...result,reused:false};
});}
