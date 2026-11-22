import {resourceSeries, findingRows} from '../resource-findings';
import {scopeWords} from '../operator-answer';
import {searchTerms} from '../retrieval/bm25';
import {partnerTopics,partnerFinding,partnerLabels,partnerValidity} from '../partner-records';
import {Prisma,type CustomerApiObservation} from '@prisma/client';
import {z} from 'zod';
import {CUSTOMER_API_LIMITS,CUSTOMER_API_SCOPES,CUSTOMER_API_VERSION,createCustomerCredentialInput,changeCustomerCredentialInput,groupFollowUpInput,customerObservationInput,reviewCustomerObservationInput,reportedObservationOutcome,type CustomerApiScope} from '../customer-api';
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

export async function resourceFindingReport(ctx: AuthorizedContext, id: string) {
 return transaction(ctx, async tx => {
  await requireMember(tx, ctx, ADMIN);
  const selected = await tx.customerApiObservation.findFirst({where: {...org(ctx), id}, include: rowInclude});
  if (!selected) throw new IntelligenceError('Observation not found', 404);
  const prefix = resourceSeries(selected.externalId);
  if (!prefix) throw new IntelligenceError('This submission has no resource-level history', 409);
  const [anchor] = await observationsView(tx, ctx, [selected]);
  if (!anchor.payload || anchor.status === 'REJECTED' || anchor.supersededAt) throw new IntelligenceError('The selected submission is unavailable for comparison', 409);
  // A new credential or control specification starts a separate series. Equal source
  // timestamps have no provable order and cannot establish recovery.
  const scope = {...org(ctx), controlId: selected.controlId, credentialId: selected.credentialId,
   contextHash: selected.contextHash, externalId: {startsWith: prefix}};
  const sameTime = await tx.customerApiObservation.count({where: {...scope, observedAt: selected.observedAt}});
  const older = await tx.customerApiObservation.findMany({
   where: {...scope, observedAt: {lt: selected.observedAt}},
   include: rowInclude, orderBy: [{observedAt: 'desc'}, {id: 'asc'}], take: 50
  });
  const previous = await observationsView(tx, ctx, older.slice(0, 49).reverse());
  const views = [...previous, anchor];
  const frequency = new Map<string, number>();
  for (const v of views) frequency.set(v.observedAt, (frequency.get(v.observedAt) ?? 0) + 1);
  frequency.set(anchor.observedAt, sameTime);
  const reads = views.map(v => {
   const available = !!v.payload && !v.payload.partnerRecord && v.status !== 'REJECTED' && !v.supersededAt &&
    resourceSeries(v.externalId) === prefix && frequency.get(v.observedAt) === 1;
   return {id: v.id, at: v.observedAt, hash: v.receiptHash, available,
    checks: available ? v.payload!.checks : []};
  });
  return {organizationId: ctx.organizationId, controlId: selected.controlId, credentialId: selected.credentialId,
   selectedId: id, selectedCurrent: anchor.current, reason: anchor.reason, limited: older.length === 50,
   unavailable: reads.filter(r => !r.available).length, rows: findingRows(reads),
   reads: reads.map(({checks, ...read}) => read)};
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
  if(source?.record.kind==='MODEL_CHANGE'){const {advanceBoundModel}=await import('./partner-follow-up');await advanceBoundModel(tx,row);}
  await enqueueCustomerObservationDelivery(tx,row);
  return {...(await observationsView(tx,session,[row]))[0],reused:false};
 });
}
function followUpDate(value:string){
 const date=new Date(value+'T00:00:00.000Z'),today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00.000Z');
 if(date<today||date.getTime()>Date.now()+365*86400000)throw new IntelligenceError('Choose a follow-up date from today to one year ahead',400);
 return date;
}
export async function reviewCustomerApiObservation(c:AuthorizedContext,id:string,input:unknown){z.uuid().parse(id);const d=reviewCustomerObservationInput.parse(input),requestHash=hashValue({id,...d});return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const previous=await operation(tx,c,d.requestKey,requestHash);if(previous)return {...previous.result as object,reused:true};
 const row=await tx.customerApiObservation.findFirst({where:{id,...org(c)},include:rowInclude});if(!row)throw new IntelligenceError('Integration observation not found',404);if(row.version!==d.version||row.status!=='PENDING')throw new IntelligenceError('Observation already reviewed or changed; refresh before continuing',409);
 const view=(await observationsView(tx,c,[row]))[0];if(d.decision!=='REJECT'&&!view.current)throw new IntelligenceError(view.reason||'This observation is no longer current',409);if(d.decision==='ACKNOWLEDGE'&&view.payload?.partnerRecord&&row.credential.issuedById===c.userId)throw new IntelligenceError('A different administrator must acknowledge the partner source',403);if(d.decision==='ACKNOWLEDGE'&&view.reportedOutcome!=='REPORTED_PASS')throw new IntelligenceError('A reported failure or unknown result needs an owned follow-up or rejection',409);
 let followUpTaskId:string|null=null;
 if(d.decision==='FOLLOW_UP'){
  const owner=await activeOwner(tx,c,d.ownerId!),date=followUpDate(d.dueDate!);
  const task=await tx.obligation.create({data:{...org(c),title:('Investigate integration report: '+row.control.title).slice(0,160),category:'Customer integration follow-up',ownerName:owner.user.email,assigneeId:d.ownerId,controlId:row.controlId,originKey:hashValue({customerApiObservation:id}),dueDate:date,status:'OPEN',notes:('Administrator-requested investigation of a customer-submitted integration report.\nIntegration: '+row.credential.name+'\nExternal reference: '+row.externalId+'\nThis report is not verified evidence or a compliance decision.\nReview rationale: '+d.notes).slice(0,3000)}});followUpTaskId=task.id;
 }
 const status=d.decision==='FOLLOW_UP'?'FOLLOW_UP':d.decision==='REJECT'?'REJECTED':'ACKNOWLEDGED',saved=await tx.customerApiObservation.update({where:{id},data:{status,version:{increment:1},reviewerId:c.userId,reviewedAt:new Date(),reviewNotes:d.notes,followUpTaskId}}),result={id,version:saved.version,status,followUpTaskId,requestKey:d.requestKey};await recordOperation(tx,c,d.requestKey,requestHash,'OBSERVATION_REVIEWED',id,result);await enqueueCustomerObservationDelivery(tx,saved,true);return {...result,reused:false};
});}

export async function groupObservationFollowUps(ctx:AuthorizedContext,input:unknown){
 const data=groupFollowUpInput.parse(input);
 const records=[...data.records].sort((a,b)=>a.id.localeCompare(b.id));
 const requestHash=hashValue({action:'GROUPED_FOLLOW_UP',...data,records});
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const previous=await operation(tx,ctx,data.requestKey,requestHash);
  if(previous)return {...previous.result as object,reused:true};
  const owner=await activeOwner(tx,ctx,data.ownerId),dueDate=followUpDate(data.dueDate);
  const rows=await tx.customerApiObservation.findMany({where:{organizationId:ctx.organizationId,id:{in:records.map(record=>record.id)}},include:rowInclude});
  if(rows.length!==records.length)throw new IntelligenceError('One or more selected reports are unavailable in this company',404);
  const expected=new Map(records.map(record=>[record.id,record]));
  const views=await observationsView(tx,ctx,rows);
  for(const view of views){
   const submitted=expected.get(view.id)!;
   if(!view.current||view.status!=='PENDING'||view.version!==submitted.version||view.receiptHash!==submitted.receiptHash){
    throw new IntelligenceError('One or more selected reports changed. Refresh and review the selection.',409);
   }
  }
  const grouped=new Map<string,ObservationRow[]>();
  for(const row of rows){const group=grouped.get(row.controlId)??[];group.push(row);grouped.set(row.controlId,group);}
  const tasks:{id:string;controlId:string;records:number}[]=[];
  for(const [controlId,group] of grouped){
   const task=await tx.obligation.create({data:{
    organizationId:ctx.organizationId,controlId,ownerName:owner.user.email,assigneeId:data.ownerId,dueDate,status:'OPEN',
    title:('Investigate integration reports for '+group[0].control.title).slice(0,160),category:'Customer integration follow-up',
    originKey:hashValue({requestKey:data.requestKey,controlId}),notes:data.notes
   }});
   const reviewedAt=new Date();
   for(const row of group){
    const saved=await tx.customerApiObservation.update({where:{id:row.id},data:{
     followUpTaskId:task.id,status:'FOLLOW_UP',version:{increment:1},reviewerId:ctx.userId,reviewedAt,reviewNotes:data.notes
    }});
    await enqueueCustomerObservationDelivery(tx,saved,true);
   }
   tasks.push({id:task.id,controlId,records:group.length});
  }
  const first=rows.find(row=>row.id===records[0].id)!;
  const result={id:first.id,requestKey:data.requestKey,records,tasks,followUpTaskId:tasks.find(task=>task.controlId===first.controlId)!.id};
  await recordOperation(tx,ctx,data.requestKey,requestHash,'GROUPED_FOLLOW_UP',first.id,result);
  return {...result,reused:false};
 });
}

export async function buyerPartnerReceipt(tx:Tx,organizationId:string,id:string,email:string){
 const row=await tx.customerApiObservation.findFirst({where:{id,organizationId,status:'ACKNOWLEDGED',partnerKey:{not:null},supersededAt:null},include:rowInclude});
 if(!row||!row.reviewerId||row.reviewerId===row.credential.issuedById)return null;
 const view=(await observationsView(tx,{organizationId},[row]))[0],s=view.payload?.partnerRecord,r=s?.record;
 if(!view.current||view.reportedOutcome!=='REPORTED_PASS'||!s||!r||(r.kind!=='SUPPLIER_RELATION'&&r.kind!=='SUPPLIER_ASSESSMENT')||!r.permittedBuyers?.includes(email))return null;
 const {permittedBuyers:_,...permittedRecord}=r;
 return {id:row.id,source:s.sourceSystem,recordId:s.recordId,sourceVersion:s.sourceVersion,revision:s.revision,receiptHash:view.receiptHash,observedAt:view.observedAt,validUntil:view.validUntil,decisionOwnerRef:s.decisionOwnerRef,record:permittedRecord};
}

export async function internalPartnerView(tx:Tx,organizationId:string,id:string){
 const row=await tx.customerApiObservation.findFirst({where:{id,organizationId,partnerKey:{not:null}},include:rowInclude});
 return row?(await observationsView(tx,{organizationId},[row]))[0]:null;
}

/** Shortlist only reviewed reports in the selected company. Recheck each receipt and its source grant before disclosure. */
export async function searchPartnerReports(tx:Tx,c:AuthorizedContext,question:string,asset:string){
 await requireMember(tx,c,ADMIN);
 const noise=new Set(['show','find','our','current','latest','company','records','reports','evidence','what','which','does','report','record']);
 const terms=[...new Set(searchTerms(question))].filter(t=>!noise.has(t)).slice(0,24);
 if(!terms.length)return [];
 const named=scopeWords(asset);
 const candidates=await tx.$queryRaw<{id:string}[]>`
  WITH records AS (
   SELECT id,"observedAt" AS observed,payload->'partnerRecord' AS src,payload->'partnerRecord'->'record' AS detail
   FROM "CustomerApiObservation" WHERE "organizationId"=${c.organizationId}::uuid
    AND "partnerKey" IS NOT NULL AND "supersededAt" IS NULL AND "purgedAt" IS NULL
    AND status IN ('ACKNOWLEDGED','FOLLOW_UP') AND "validUntil">now() AND ("retentionEndsAt" IS NULL OR "retentionEndsAt">now())
  ), indexed AS (
   SELECT id,observed,to_tsvector('simple',concat_ws(' ', src->>'sourceSystem',src->>'recordId',
    ${JSON.stringify(partnerTopics)}::jsonb->>(detail->>'kind'),
    (SELECT string_agg(value,' ') FROM jsonb_each_text(detail-'permittedBuyers') f WHERE key NOT IN ('consentExpiresAt','retainUntil')))) AS doc
   FROM records WHERE ${named}='' OR EXISTS (
    SELECT 1 FROM jsonb_each_text(detail) f WHERE key IN ('siteRef','sensorRef','scopeRef','productRef','systemRef','supplierRef','upstreamRef','vendorRef','hazardRef')
    AND trim(regexp_replace(lower(value),'[^[:alnum:]]+',' ','g'))=${named})
   OR (detail->>'kind'='EPCIS_TRANSFER' AND EXISTS (
    SELECT 1 FROM (VALUES (detail#>'{shipping,epcisBody,eventList,0}'),(detail#>'{receiving,epcisBody,eventList,0}')) AS transfer(event)
    WHERE (event->'epcList') ? ${asset.trim()} OR event#>>'{readPoint,id}'=${asset.trim()}
      OR event#>>'{bizTransactionList,0,bizTransaction}'=${asset.trim()}))
  ) SELECT id FROM indexed,to_tsquery('simple',${terms.join(' | ')}) q WHERE doc @@ q
    ORDER BY ts_rank(doc,q) DESC,observed DESC,id LIMIT 30`;
 const rows=await tx.customerApiObservation.findMany({where:{organizationId:c.organizationId,id:{in:candidates.map(row=>row.id)}},include:rowInclude});
 const views=new Map((await observationsView(tx,c,rows)).map(row=>[row.id,row]));
 return candidates.flatMap(({id})=>{
  const view=views.get(id),source=view?.payload?.partnerRecord;
  if(!view?.current||!source||!view.reviewerId||!view.reviewedAt)return [];
  return [{id,kind:partnerLabels[source.record.kind],summary:partnerFinding(source.record),source:source.sourceSystem,
   recordId:source.recordId,revision:source.revision,sourceVersion:source.sourceVersion,sourceUrl:source.sourceUrl??null,
   observedAt:view.observedAt,validUntil:view.validUntil,reviewedAt:view.reviewedAt,owner:source.decisionOwnerRef,
   outcome:view.reportedOutcome,receiptHash:view.receiptHash,taskId:view.followUpTaskId}];
 }).slice(0,8);
}
