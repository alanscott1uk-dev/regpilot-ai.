import {bindPartnerModel,partnerFollowUp} from '../lib/server/partner-follow-up';
import {inventoryAction,inventoryWorkspace} from '../lib/server/ai-inventory-service';
import {createQualityCase,addQualityAction} from '../lib/server/capa-service';
import {workTask} from '../lib/server/work-hub-service';
import {createAuditRoom,changeAuditRoom,guestAuditAction,openAuditRoom} from '../lib/server/auditor-service';
import {attachBuyerAnnex,buyerAnnexOptions} from '../lib/server/buyer-annex';
import {purgeExpiredPartnerRecords} from '../lib/server/partner-retention';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects,future} from './helpers/assurance-fixture';
import {CUSTOMER_API_SCOPES,type CustomerApiScope} from '../lib/customer-api';
import {authenticateCustomerApi,secretHash,type CustomerApiSession} from '../lib/server/customer-api-auth';
import {searchPartnerReports,createCustomerCredential,changeCustomerCredential,developerWorkspace,groupObservationFollowUps,listCustomerApiResource,submitCustomerApiObservation,reviewCustomerApiObservation} from '../lib/server/customer-api-service';
import {hashValue} from '../lib/regulatory/intelligence';
import {GET as getControls} from '../app/api/v1/controls/route';
import {GET as getObservations,POST as postObservation} from '../app/api/v1/observations/route';

type Created={id:string;version:number;requestKey:string;secret:string|null;reused:boolean;secretUnavailable:boolean};
const notes='Independently inspect the customer-reported result and document the scope, exceptions and follow-up outcome.';
async function fixture(){
 const x=await assuranceFixture();Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CUSTOMER_API_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture'});
 async function control(organizationId=x.a.id,ownerId=x.ed.userId,creatorId=x.o.userId){const programme=await db.programmeImport.create({data:{organizationId,createdById:creatorId,inputHash:randomUUID(),method:'FIXTURE',status:'ACCEPTED',evidenceManifest:[]}});return db.managedControl.create({data:{organizationId,importId:programme.id,proposalKey:randomUUID(),title:'Fictional customer integration control',description:notes,testProcedure:notes,theme:'security',ownerId,scheduledById:creatorId,intervalDays:30,nextReviewAt:new Date(Date.now()+86400000)}});}
 const primary=await control(),ungranted=await control(),foreignControl=await control(x.b.id,x.out.userId,x.out.userId);
 const input=(scopes:readonly CustomerApiScope[]=CUSTOMER_API_SCOPES,controlIds=[primary.id])=>({name:'Fictional inventory client',scopes:[...scopes],controlIds,expiresAt:new Date(Date.now()+30*86400000).toISOString(),requestKey:randomUUID(),confirm:true});
 const create=async(scopes:readonly CustomerApiScope[]=CUSTOMER_API_SCOPES,controlIds=[primary.id])=>await createCustomerCredential(x.o,input(scopes,controlIds)) as Created;
 const request=(token:string,resource='controls')=>new Request('https://example.invalid/api/v1/'+resource,{headers:{authorization:'Bearer '+token}});
 const session=async(token:string,scope:CustomerApiScope='controls:read')=>authenticateCustomerApi(request(token),scope);
 const observation=(controlId=primary.id,status:'PASS'|'FAIL'|'UNKNOWN'='FAIL')=>({controlId,externalId:'fictional/'+randomUUID(),observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),summary:'The fictional customer inventory reported a result that requires an administrator decision.',checks:[{key:'inventory-control',label:'Reported control observation',status,observed:'Customer supplied aggregate result',detail:'This is an unverified customer observation, not independently approved evidence.'}]});
 return {...x,primary,ungranted,foreignControl,control,input,create,request,session,observation};
}

test('customer credential lifecycle is administrator-only, hashed, company-bound and exactly recoverable without repeating secrets',async()=>{
 const x=await fixture();try{
  const input=x.input();await assert.rejects(()=>createCustomerCredential(x.ed,input),rejects(403));await assert.rejects(()=>createCustomerCredential(x.st,input),rejects(403));await assert.rejects(()=>createCustomerCredential(x.out,input),rejects(409));await assert.rejects(()=>createCustomerCredential(x.o,{...input,controlIds:[x.foreignControl.id]}),rejects(409));await assert.rejects(()=>createCustomerCredential(x.o,{...input,expiresAt:new Date(Date.now()+91*86400000).toISOString()}),rejects(400));
  const created=await createCustomerCredential(x.o,input) as Created;assert.ok(created.secret);const stored=await db.customerApiCredential.findUniqueOrThrow({where:{id:created.id}});assert.equal(stored.secretHash,secretHash(created.secret!));assert.notEqual(stored.secretHash,created.secret);assert.equal(stored.organizationId,x.a.id);
  const replay=await createCustomerCredential(x.o,input) as Created;assert.equal(replay.id,created.id);assert.equal(replay.secret,null);assert.equal(replay.secretUnavailable,true);assert.equal(await db.customerApiCredential.count({where:{organizationId:x.a.id}}),1);
  await assert.rejects(()=>createCustomerCredential(x.o,{...input,name:'Changed integration identity'}),rejects(409));await assert.rejects(()=>createCustomerCredential(x.ad,input),rejects(409));
  const recovered=await developerWorkspace(x.o,{requestKey:input.requestKey});assert.equal(recovered.operation?.entityId,created.id);assert.equal((await developerWorkspace(x.ad,{requestKey:input.requestKey})).operation,null);assert.equal((await developerWorkspace(x.out,{requestKey:input.requestKey})).operation,null);assert.equal((await developerWorkspace(x.o,{requestKey:randomUUID()})).operation,null);
  const safe=JSON.stringify({workspace:recovered,operations:await db.customerApiOperation.findMany({where:{organizationId:x.a.id}}),audit:await db.auditEvent.findMany({where:{organizationId:x.a.id}})});assert.ok(!safe.includes(created.secret!));assert.ok(!safe.includes(stored.secretHash));assert.ok(!safe.includes('secretHash'));
  const oldSession=await x.session(created.secret!),rotation={action:'ROTATE',version:1,requestKey:randomUUID(),confirm:true},rotated=await changeCustomerCredential(x.o,created.id,rotation) as Created;assert.ok(rotated.secret);assert.notEqual(rotated.secret,created.secret);assert.equal(rotated.version,2);
  await assert.rejects(()=>x.session(created.secret!),rejects(401));await assert.rejects(()=>listCustomerApiResource(oldSession,'controls','https://example.invalid/api/v1/controls'),rejects(401));assert.equal((await x.session(rotated.secret!)).version,2);
  const repeatRotation=await changeCustomerCredential(x.o,created.id,rotation) as Created;assert.equal(repeatRotation.secret,null);assert.equal(repeatRotation.version,2);assert.equal((await developerWorkspace(x.o,{requestKey:rotation.requestKey})).operation?.action,'ROTATED');
  const revoke={action:'REVOKE',version:2,requestKey:randomUUID(),confirm:true};await changeCustomerCredential(x.ad,created.id,revoke);await changeCustomerCredential(x.ad,created.id,revoke);await assert.rejects(()=>x.session(rotated.secret!),rejects(401));assert.equal((await db.customerApiCredential.findUniqueOrThrow({where:{id:created.id}})).version,3);assert.equal(await db.customerApiOperation.count({where:{organizationId:x.a.id}}),3);
  await assert.rejects(()=>changeCustomerCredential(x.o,created.id,{...rotation,version:3,requestKey:randomUUID()}),rejects(409));await assert.rejects(()=>developerWorkspace(x.ed),rejects(403));
 }finally{await x.cleanup();}
});

test('machine admission rechecks the issuer, key expiry, company identity, grant scope and environment on every operation',async()=>{
 const x=await fixture();try{
  const key=await x.create(['controls:read']),session=await x.session(key.secret!);await assert.rejects(()=>x.session(key.secret!,'observations:write'),rejects(403));await assert.rejects(()=>listCustomerApiResource({...session,organizationId:x.b.id},'controls','https://example.invalid/api/v1/controls'),rejects(401));
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.o.userId}},data:{role:'EDITOR'}});await assert.rejects(()=>x.session(key.secret!),rejects(401));assert.equal((await developerWorkspace(x.ad)).credentials[0].status,'ISSUER_UNAVAILABLE');await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.o.userId}},data:{role:'OWNER'}});
  const allowed=process.env.REGPILOT_AI_ALLOWED_EMAILS!;process.env.REGPILOT_AI_ALLOWED_EMAILS=x.admin.email;await assert.rejects(()=>listCustomerApiResource(session,'controls','https://example.invalid/api/v1/controls'),rejects(401));process.env.REGPILOT_AI_ALLOWED_EMAILS=allowed;
  await db.customerApiCredential.update({where:{id:key.id},data:{createdAt:new Date(Date.now()-2*86400000),expiresAt:new Date(Date.now()-86400000)}});await assert.rejects(()=>x.session(key.secret!),rejects(401));assert.equal((await developerWorkspace(x.ad)).credentials[0].status,'EXPIRED');
  await db.customerApiCredential.update({where:{id:key.id},data:{expiresAt:new Date(Date.now()+86400000)}});process.env.REGPILOT_CUSTOMER_API_ENABLED='false';await assert.rejects(()=>x.session(key.secret!),rejects(503));process.env.REGPILOT_CUSTOMER_API_ENABLED='true';
  await db.membership.delete({where:{organizationId_userId:{organizationId:x.a.id,userId:x.o.userId}}});await assert.rejects(()=>x.session(key.secret!),rejects(401));await db.membership.create({data:x.o});
 }finally{await x.cleanup();}
});

test('customer reads enforce control grants and bounded cursor pagination without private storage or cross-company records',async()=>{
 const x=await fixture();try{
  const key=await x.create(),session=await x.session(key.secret!),createdAt=new Date(Date.now()-10000);
  const tasks=await Promise.all([x.primary,x.primary,x.ungranted,x.foreignControl].map((control,index)=>db.obligation.create({data:{organizationId:control.organizationId,title:'Fictional scoped task '+index,category:'Internal',ownerName:'Private owner label',assigneeId:control.ownerId,controlId:control.id,dueDate:new Date(),createdAt,notes:'Private task details are not part of this API'}})));
  const file=await x.file(),savedFile=await db.evidence.findUniqueOrThrow({where:{id:file.id}});await db.obligation.update({where:{id:savedFile.obligationId},data:{controlId:x.primary.id}});
  const snapshot=await db.regulatorySnapshot.create({data:{organizationId:x.a.id,sourceId:'fictional-source',title:'Reviewed fictional source metadata',url:'https://example.invalid/source',contentHash:hashValue('fictional source body'),bodyText:'Private source text is not part of the API',capturedById:x.o.userId,reviewStatus:'REVIEWED',reviewerId:x.ad.userId,reviewedAt:new Date()}});
  const controls=await listCustomerApiResource(session,'controls','https://example.invalid/api/v1/controls');assert.deepEqual(controls.data.map(row=>row.id),[x.primary.id]);
  const first=await listCustomerApiResource(session,'tasks','https://example.invalid/api/v1/tasks?limit=1'),second=await listCustomerApiResource(session,'tasks','https://example.invalid/api/v1/tasks?limit=1&cursor='+first.pagination.nextCursor);assert.equal(first.data.length,1);assert.equal(second.data.length,1);assert.notEqual(first.data[0].id,second.data[0].id);assert.ok(tasks.slice(0,2).some(row=>row.id===first.data[0].id));assert.ok(tasks.slice(0,2).some(row=>row.id===second.data[0].id));
  await assert.rejects(()=>listCustomerApiResource(session,'tasks','https://example.invalid/api/v1/tasks?controlId='+x.ungranted.id),rejects(404));await assert.rejects(()=>listCustomerApiResource(session,'tasks','https://example.invalid/api/v1/tasks?organizationId='+x.b.id),rejects(400));await assert.rejects(()=>listCustomerApiResource(session,'evidence','https://example.invalid/api/v1/evidence?cursor='+first.pagination.nextCursor),rejects(400));
  const metadata=await listCustomerApiResource(session,'evidence','https://example.invalid/api/v1/evidence'),sources=await listCustomerApiResource(session,'regulatory-sources','https://example.invalid/api/v1/regulatory-sources');assert.deepEqual(metadata.data.map(row=>row.id),[file.id]);assert.deepEqual(sources.data.map(row=>row.id),[snapshot.id]);const serial=JSON.stringify({metadata,sources,tasks:first});assert.ok(!serial.includes(savedFile.storageKey));assert.ok(!serial.includes('storageKey'));assert.ok(!serial.includes('Private source text'));assert.ok(!serial.includes('Private owner label'));assert.ok(!serial.includes('Private task details'));
  const other=await x.create(),otherSession=await x.session(other.secret!);await assert.rejects(()=>listCustomerApiResource(otherSession,'tasks','https://example.invalid/api/v1/tasks?limit=1&cursor='+first.pagination.nextCursor),rejects(400));
 }finally{await x.cleanup();}
});

test('typed machine observations ingest once, retain machine attribution and need explicit administrator-owned follow-up',async()=>{
 const x=await fixture();try{
  const key=await x.create(),session=await x.session(key.secret!,'observations:write'),payload=x.observation(),requestKey=randomUUID(),beforeTasks=await db.obligation.count({where:{organizationId:x.a.id}}),beforeAudit=await db.auditEvent.count({where:{organizationId:x.a.id}});
  const [first,replayed]=await Promise.all([submitCustomerApiObservation(session,requestKey,payload),submitCustomerApiObservation(session,requestKey,payload)]);assert.equal(first.id,replayed.id);assert.equal(first.source.kind,'CUSTOMER_API_CLIENT');assert.equal(first.source.credentialId,key.id);assert.equal(first.status,'PENDING');assert.equal(first.current,true);assert.equal(first.reportedOutcome,'REPORTED_FAILURE');assert.equal(await db.customerApiObservation.count({where:{organizationId:x.a.id}}),1);assert.equal(await db.obligation.count({where:{organizationId:x.a.id}}),beforeTasks);assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id}}),beforeAudit);
  await assert.rejects(()=>submitCustomerApiObservation(session,requestKey,{...payload,summary:notes}),rejects(409));await assert.rejects(()=>submitCustomerApiObservation(session,randomUUID(),payload),rejects(409));await assert.rejects(()=>submitCustomerApiObservation(session,randomUUID(),x.observation(x.foreignControl.id)),rejects(404));
  const exact=await listCustomerApiResource(session,'observations','https://example.invalid/api/v1/observations?requestKey='+requestKey);assert.equal(exact.data[0].id,first.id);assert.equal((await listCustomerApiResource(session,'observations','https://example.invalid/api/v1/observations?requestKey='+randomUUID())).data.length,0);
  const input={decision:'FOLLOW_UP',version:1,notes,ownerId:x.ed.userId,dueDate:future(7),requestKey:randomUUID(),confirm:true};await assert.rejects(()=>reviewCustomerApiObservation(x.ed,first.id,input),rejects(403));await assert.rejects(()=>reviewCustomerApiObservation(x.out,first.id,input),rejects(404));await assert.rejects(()=>reviewCustomerApiObservation(x.o,first.id,{decision:'ACKNOWLEDGE',version:1,notes,requestKey:randomUUID(),confirm:true}),rejects(409));
  const reviewed=await reviewCustomerApiObservation(x.ad,first.id,input) as {id:string;followUpTaskId:string;reused:boolean};assert.ok(reviewed.followUpTaskId);const task=await db.obligation.findUniqueOrThrow({where:{id:reviewed.followUpTaskId}});assert.equal(task.status,'OPEN');assert.equal(task.assigneeId,x.ed.userId);assert.equal(task.controlId,x.primary.id);assert.equal(task.category,'Customer integration follow-up');assert.match(task.notes,/customer-submitted/);assert.equal((await reviewCustomerApiObservation(x.ad,first.id,input) as {followUpTaskId:string}).followUpTaskId,task.id);assert.equal(await db.obligation.count({where:{organizationId:x.a.id}}),beforeTasks+1);
  const receipt=(await developerWorkspace(x.ad,{requestKey:input.requestKey})).operation;assert.equal(receipt?.action,'OBSERVATION_REVIEWED');const audit=await db.auditEvent.findMany({where:{organizationId:x.a.id,entityId:first.id}});assert.equal(audit.length,1);assert.equal(audit[0].actorId,x.ad.userId);assert.equal(audit[0].action,'customer_api.observation_reviewed');assert.equal(await db.evidence.count({where:{organizationId:x.a.id}}),0);
  const other=await x.create(),otherSession=await x.session(other.secret!);assert.equal((await listCustomerApiResource(otherSession,'observations','https://example.invalid/api/v1/observations')).data.length,0);
 }finally{await x.cleanup();}
});

test('observation freshness tracks control scope, owners, reviewer authority, credential revocation and real expiry',async()=>{
 const x=await fixture();try{
  const key=await x.create(),session=await x.session(key.secret!,'observations:write');const report=await submitCustomerApiObservation(session,randomUUID(),x.observation(x.primary.id,'PASS'));
  await db.managedControl.update({where:{id:x.primary.id},data:{version:{increment:1},testProcedure:'Changed review procedure makes the prior context stale'}});let view=(await developerWorkspace(x.ad)).observations.find(row=>row.id===report.id)!;assert.equal(view.current,false);assert.match(view.reason,/configuration/);await assert.rejects(()=>reviewCustomerApiObservation(x.ad,report.id,{decision:'FOLLOW_UP',version:1,notes,ownerId:x.ed.userId,dueDate:future(),requestKey:randomUUID(),confirm:true}),rejects(409));await reviewCustomerApiObservation(x.ad,report.id,{decision:'REJECT',version:1,notes,requestKey:randomUUID(),confirm:true});
  const fresh=await submitCustomerApiObservation(session,randomUUID(),x.observation(x.primary.id,'PASS'));
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ed.userId}},data:{role:'VIEWER'}});view=(await developerWorkspace(x.ad)).observations.find(row=>row.id===fresh.id)!;assert.equal(view.current,false);assert.match(view.reason,/owner/);await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ed.userId}},data:{role:'EDITOR'}});
  const acknowledgement={decision:'ACKNOWLEDGE',version:1,notes,requestKey:randomUUID(),confirm:true};await reviewCustomerApiObservation(x.ad,fresh.id,acknowledgement);assert.equal((await developerWorkspace(x.o,{observationId:fresh.id})).observations.find(row=>row.id===fresh.id)!.current,true);
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ad.userId}},data:{role:'EDITOR'}});view=(await developerWorkspace(x.o,{observationId:fresh.id})).observations.find(row=>row.id===fresh.id)!;assert.equal(view.current,false);assert.match(view.reason,/administrator/);await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ad.userId}},data:{role:'ADMIN'}});
  const expiry=await submitCustomerApiObservation(session,randomUUID(),x.observation());const expiredPayload={...expiry.payload!,observedAt:new Date(Date.now()-2*86400000).toISOString(),validUntil:new Date(Date.now()-86400000).toISOString()};await db.customerApiObservation.update({where:{id:expiry.id},data:{observedAt:new Date(expiredPayload.observedAt),validUntil:new Date(expiredPayload.validUntil),payload:expiredPayload,payloadHash:hashValue(expiredPayload)}});view=(await developerWorkspace(x.o)).observations.find(row=>row.id===expiry.id)!;assert.equal(view.current,false);assert.match(view.reason,/expired/);const replay=await submitCustomerApiObservation(session,expiry.requestKey,expiredPayload);assert.equal(replay.id,expiry.id);assert.equal(replay.reused,true);assert.equal(replay.current,false);
  const scoped=await submitCustomerApiObservation(session,randomUUID(),x.observation());await db.customerApiControlGrant.delete({where:{credentialId_controlId:{credentialId:key.id,controlId:x.primary.id}}});view=(await developerWorkspace(x.o)).observations.find(row=>row.id===scoped.id)!;assert.equal(view.current,false);assert.match(view.reason,/permission/);await db.customerApiControlGrant.create({data:{organizationId:x.a.id,credentialId:key.id,controlId:x.primary.id}});
  await changeCustomerCredential(x.o,key.id,{action:'REVOKE',version:1,requestKey:randomUUID(),confirm:true});view=(await developerWorkspace(x.o)).observations.find(row=>row.id===scoped.id)!;assert.equal(view.current,false);assert.match(view.reason,/credential/);await assert.rejects(()=>listCustomerApiResource(session,'observations','https://example.invalid/api/v1/observations'),rejects(401));
 }finally{await x.cleanup();}
});

test('persisted key and company rate budgets reserve atomically at concurrency boundaries and prune only old windows',async()=>{
 const x=await fixture(),originalNow=Date.now;try{
  const key=await x.create(),other=await x.create(['controls:read']),frozen=originalNow();Date.now=()=>frozen;const minute=new Date(Math.floor(frozen/60000)*60000);
  await db.customerApiBudget.createMany({data:[{organizationId:x.a.id,bucket:'key:'+key.id,minute,count:59},{organizationId:x.a.id,bucket:'company',minute,count:299},{organizationId:x.a.id,bucket:'company',minute:new Date(minute.getTime()-2*86400000),count:100}]});
  const attempts=await Promise.allSettled([x.session(key.secret!),x.session(key.secret!)]);assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.status===429&&result.reason.code==='rate_limited').length,1);
  const windows=await db.customerApiBudget.findMany({where:{organizationId:x.a.id}});assert.equal(windows.length,2);assert.equal(windows.find(row=>row.bucket==='company')!.count,300);assert.equal(windows.find(row=>row.bucket.startsWith('key:'))!.count,60);
  await assert.rejects(()=>x.session(other.secret!),rejects(429));assert.equal(await db.customerApiBudget.count({where:{organizationId:x.a.id,bucket:'key:'+other.id}}),0,'failed company reservation must roll back its key unit');
  Date.now=()=>frozen+60000;await assert.rejects(()=>x.session(other.secret!,'observations:write'),rejects(403));const next=new Date(minute.getTime()+60000);assert.equal((await db.customerApiBudget.findUniqueOrThrow({where:{organizationId_bucket_minute:{organizationId:x.a.id,bucket:'company',minute:next}}})).count,1,'authenticated scope rejection consumes the persisted rate unit');const admitted=await x.session(other.secret!);assert.equal(admitted.rate.remaining,58);assert.equal(admitted.rate.reset,next.getTime()/1000+60);
 }finally{Date.now=originalNow;await x.cleanup();}
});

test('real HTTP handlers enforce strict bodies and idempotent recovery while recording rate consumption',async()=>{
 const x=await fixture();try{
  const key=await x.create(),token=key.secret!,body=x.observation(),requestKey=randomUUID(),send=(payload:unknown=body,keyValue:string=requestKey,query='')=>postObservation(new Request('https://example.invalid/api/v1/observations'+query,{method:'POST',headers:{authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':keyValue},body:JSON.stringify(payload)}));
  const first=await send();assert.equal(first.status,201);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(first.headers.get('x-ratelimit-remaining'),'59');const result=await first.json();assert.equal(result.source.kind,'CUSTOMER_API_CLIENT');assert.equal((await (await send()).json()).id,result.id);assert.equal((await send({...body,organizationId:x.b.id})).status,400);assert.equal((await send(body,'')).status,400);assert.equal((await send(body,requestKey,'?organizationId='+x.b.id)).status,400);assert.equal((await send({...body,summary:'x'.repeat(40000)})).status,413);
  const recovered=await getObservations(new Request('https://example.invalid/api/v1/observations?requestKey='+requestKey,{headers:{authorization:'Bearer '+token}}));assert.equal(recovered.status,200);assert.equal((await recovered.json()).data[0].id,result.id);
  const readOnly=await x.create(['controls:read']);const denied=await postObservation(new Request('https://example.invalid/api/v1/observations',{method:'POST',headers:{authorization:'Bearer '+readOnly.secret,'Content-Type':'application/json'},body:'bad JSON'}));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'insufficient_scope');
  const wrongQuery=await getControls(new Request('https://example.invalid/api/v1/controls?organizationId='+x.b.id,{headers:{authorization:'Bearer '+token}}));assert.equal(wrongQuery.status,400);assert.equal(await db.customerApiObservation.count({where:{organizationId:x.a.id}}),1);
 }finally{await x.cleanup();}
});

test('historical credentials do not exhaust active capacity and administrator review pages recover older exact records',async()=>{
 const x=await fixture();try{
  const old=new Date(Date.now()-86400000);await db.customerApiCredential.createMany({data:Array.from({length:105},(_,i)=>({id:randomUUID(),organizationId:x.a.id,issuedById:x.o.userId,name:'Historical integration '+i,scopes:['regulatory:read'],secretHash:'a'.repeat(64),hint:'aaaaaaaa',expiresAt:new Date(Date.now()+86400000),createdAt:old,revokedAt:old}))});
  const key=await x.create(),session=await x.session(key.secret!,'observations:write'),first=await submitCustomerApiObservation(session,randomUUID(),x.observation()),template=await db.customerApiObservation.findUniqueOrThrow({where:{id:first.id}});
  const history=Array.from({length:52},(_,i)=>{const payload={...first.payload!,externalId:'historical/'+i};return {id:randomUUID(),organizationId:x.a.id,credentialId:key.id,credentialVersion:1,controlId:x.primary.id,requestKey:randomUUID(),externalId:payload.externalId,payload,payloadHash:hashValue(payload),context:template.context!,contextHash:template.contextHash,observedAt:template.observedAt,validUntil:template.validUntil,receivedAt:new Date(Date.now()-1000*(i+1))};});await db.customerApiObservation.createMany({data:history});
  const current=await developerWorkspace(x.o);assert.ok(current.credentials.some(row=>row.id===key.id));assert.equal(current.observationPage.pendingCount,53);assert.equal(current.observations.length,50);assert.equal(current.observationPage.hasMore,true);
  const next=await developerWorkspace(x.o,{beforeId:current.observationPage.beforeId!});assert.equal(next.observations.length,3);assert.equal(next.observationPage.hasMore,false);assert.equal(new Set([...current.observations,...next.observations].map(row=>row.id)).size,53);
  const oldest=history.at(-1)!;assert.ok((await developerWorkspace(x.o,{observationId:oldest.id})).observations.some(row=>row.id===oldest.id));await assert.rejects(()=>developerWorkspace(x.out,{observationId:oldest.id}),rejects(404));
  await assert.rejects(()=>db.customerApiControlGrant.create({data:{organizationId:x.b.id,credentialId:key.id,controlId:x.foreignControl.id}}),error=>(error as {code?:string}).code==='P2003');
 }finally{await x.cleanup();}
});

test('partner receipts retain revision history through credential rotation, retry and dispute',async()=>{
 const x=await fixture();
 try{
  const key=await x.create(),s=await x.session(key.secret!,'observations:write');
  const record={schemaVersion:1,revision:1,recordId:'company-relationship-7',sourceSystem:'Buyer procurement',sourceVersion:'2026-11',decisionOwnerRef:'buyer-office',state:'CURRENT',record:{kind:'SUPPLIER_RELATION',permittedBuyers:[x.foreign.email],buyerRef:'buyer',supplierRef:'primary',upstreamRef:'tier-two',consentRef:'consent-044',consentExpiresAt:new Date(Date.now()+86400000).toISOString()}};
  const body={...x.observation(x.primary.id,'PASS'),partnerRecord:record};
  const first=await submitCustomerApiObservation(s,randomUUID(),body);
  assert.equal(first.current,true);assert.equal(first.reportedOutcome,'REPORTED_PASS');assert.match(first.receiptHash,/^[a-f0-9]{64}$/);
  await assert.rejects(()=>reviewCustomerApiObservation(x.o,first.id,{decision:'ACKNOWLEDGE',version:1,notes,confirm:true,requestKey:randomUUID()}),rejects(403));
  await reviewCustomerApiObservation(x.ad,first.id,{decision:'ACKNOWLEDGE',version:1,notes,confirm:true,requestKey:randomUUID()});
  const lookup=(ctx:typeof x.o)=>db.$transaction(tx=>searchPartnerReports(tx,ctx,'tier two supply chain','primary'));
  const matched=await lookup(x.o);assert.equal(matched[0].id,first.id);assert.equal(matched[0].receiptHash,first.receiptHash);
  assert.ok(!JSON.stringify(matched).includes(x.foreign.email));assert.deepEqual(await lookup(x.out),[]);
  await assert.rejects(()=>lookup(x.ed),rejects(403));
  const file=await x.file(),room=await createAuditRoom(x.o,{title:'Buyer fixture share',purpose:'Validate explicitly consented partner source records in this named room.',expiresAt:new Date(Date.now()+86400000).toISOString(),evidenceIds:[file.id]});
  await changeAuditRoom(x.o,room.id,{action:'PUBLISH',version:1,manifestHash:room.manifestHash,acknowledgeDisclosure:true});
  const g=await changeAuditRoom(x.o,room.id,{action:'INVITE',version:2,email:x.foreign.email}) as {id:string},wrong=await changeAuditRoom(x.o,room.id,{action:'INVITE',version:2,email:x.staff.email}) as {id:string};
  const b={externalId:x.foreign.externalId,email:x.foreign.email};
  assert.equal((await buyerAnnexOptions(x.o,room.id,g.id)).receipts.length,1);assert.equal((await buyerAnnexOptions(x.o,room.id,wrong.id)).receipts.length,0);
  await assert.rejects(()=>attachBuyerAnnex(x.o,room.id,{grantId:wrong.id,observationId:first.id,receiptHash:first.receiptHash,confirm:true}),rejects(409));
  await attachBuyerAnnex(x.o,room.id,{grantId:g.id,observationId:first.id,receiptHash:first.receiptHash,confirm:true});await guestAuditAction(b,g.id,{action:'ACCEPT',version:1});
  const annex=(await openAuditRoom(b,g.id)).partnerRecords;assert.equal(annex.length,1);assert.equal('permittedBuyers' in annex[0].record,false);
  const rotate=await changeCustomerCredential(x.o,key.id,{action:'ROTATE',version:1,requestKey:randomUUID(),confirm:true}) as Created;
  const active=await x.session(rotate.secret!,'observations:write');
  await assert.rejects(()=>submitCustomerApiObservation(s,randomUUID(),body),rejects(401));
  const again=await submitCustomerApiObservation(active,randomUUID(),body);assert.equal(again.id,first.id);assert.equal(again.reused,true);
  const next={...x.observation(x.primary.id,'PASS'),partnerRecord:{...record,revision:2,previousHash:first.receiptHash,state:'DISPUTED'}};
  await assert.rejects(()=>submitCustomerApiObservation(active,randomUUID(),{...next,partnerRecord:{...next.partnerRecord,previousHash:'0'.repeat(64)}}),rejects(409));
  await assert.rejects(()=>submitCustomerApiObservation(active,randomUUID(),{...next,controlId:x.foreignControl.id}),rejects(404));
  const attempts=await Promise.all([submitCustomerApiObservation(active,randomUUID(),next),submitCustomerApiObservation(active,randomUUID(),next)]);
  assert.equal(attempts[0].id,attempts[1].id);assert.equal(attempts[0].current,false);
  assert.equal((await openAuditRoom(b,g.id)).partnerRecords.length,0);
  assert.deepEqual(await lookup(x.o),[]);
  const list=await developerWorkspace(x.o,{all:true});assert.match(list.observations.find(v=>v.id===first.id)!.reason,/superseded/);
  assert.match(list.observations.find(v=>v.id===attempts[0].id)!.reason,/disputed/);
  await assert.rejects(()=>reviewCustomerApiObservation(x.ad,first.id,{decision:'ACKNOWLEDGE',notes,version:1,requestKey:randomUUID(),confirm:true}),rejects(409));
 }finally{await x.cleanup();}
});

test('specialist retention withholds expired detail and the worker removes the underlying payload once',async()=>{
 const x=await fixture();try{
  const k=await x.create(),s=await x.session(k.secret!,'observations:write');
  const body={...x.observation(x.primary.id,'PASS'),summary:'Specialist decision supplied by the authorised source.',checks:[{key:'specialist-decision',label:'Specialist decision',observed:'APPROVED',status:'PASS',detail:''}],partnerRecord:{schemaVersion:1,revision:1,state:'CURRENT',recordId:'case-reference-7',sourceSystem:'Specialist system',sourceVersion:'v4',decisionOwnerRef:'privacy-team',record:{kind:'SPECIALIST_ATTESTATION',subject:'PRIVACY',scopeRef:'team-seven',decisionRef:'review-1',decision:'APPROVED',retainUntil:'2025-01-01'}}};
  const response=await submitCustomerApiObservation(s,randomUUID(),body);assert.equal(response.current,false);assert.equal(response.payload,null);
  assert.ok(await purgeExpiredPartnerRecords()>=1);assert.equal(await purgeExpiredPartnerRecords(),0);
  const stored=await db.customerApiObservation.findUniqueOrThrow({where:{id:response.id}});assert.ok(stored.purgedAt);assert.deepEqual(stored.payload,{retention:'ended'});assert.equal(stored.payloadHash,response.receiptHash);
 }finally{await x.cleanup();}
});

test('a reviewed model feed reopens the linked inventory on revision and preserves the earlier approval',async()=>{
 const x=await fixture();
 try{
  const key=await x.create(),session=await x.session(key.secret!,'observations:write');
  const vendor=await db.vendor.create({data:{organizationId:x.a.id,name:'Fictional model publisher',service:'Model version source',criticality:'HIGH',dataAccess:'LIMITED',ownerId:x.ed.userId,nextReviewAt:new Date(future())}});
  const profile={purpose:'Prepare draft quality procedures for review.',safeguards:'A qualified human reviews each draft before use.',dataClass:'SENSITIVE',access:'DRAFT',impact:'HEALTH'};
  await inventoryAction(x.ed,{action:'CREATE',requestKey:randomUUID(),name:'Fictional model',kind:'MODEL',ownerId:x.ed.userId,controlId:x.primary.id,vendorId:vendor.id,profile});
  const inventory=async()=>(await inventoryWorkspace(x.o)).systems[0];
  const original=await inventory(),file=await x.file();
  const decision=(version:number)=>({action:'DECIDE',id:original.id,version,evidenceId:file.id,verdict:'RESTRICTED',validUntil:future(),rationale:'Independent review limits the use to drafts for a qualified person.'});
  await inventoryAction(x.o,decision(original.version),x.store);
  const record={schemaVersion:1,recordId:'model-series-1',revision:1,state:'CURRENT',sourceSystem:'Fictional model publisher',sourceVersion:'v1',decisionOwnerRef:'publisher',record:{kind:'MODEL_CHANGE',vendorRef:'vendor-1',systemRef:'system-1',modelRef:'quality-model',modelVersion:'1.0',approval:'APPROVED',decisionRef:'change-1'}};
  const first=await submitCustomerApiObservation(session,randomUUID(),{...x.observation(x.primary.id,'PASS'),partnerRecord:record});
  const bind={systemId:original.id,systemVersion:original.version,receiptHash:first.receiptHash,confirm:true};
  const ack=(id:string)=>reviewCustomerApiObservation(x.ad,id,{decision:'ACKNOWLEDGE',version:1,notes,confirm:true,requestKey:randomUUID()});
  await assert.rejects(()=>bindPartnerModel(x.o,first.id,bind),rejects(409));
  await ack(first.id);
  assert.equal((await partnerFollowUp(x.o,first.id)).systems[0].id,original.id);
  await assert.rejects(()=>bindPartnerModel(x.out,first.id,bind),rejects(409));
  await bindPartnerModel(x.o,first.id,bind);await bindPartnerModel(x.o,first.id,bind);
  const bound=await inventory();assert.equal(bound.version,2);assert.equal(bound.history[0].version,1);assert.equal(bound.status,'Awaiting review');
  await inventoryAction(x.o,decision(bound.version),x.store);assert.equal((await inventory()).status,'Restricted');
  const changed={...x.observation(x.primary.id,'PASS'),partnerRecord:{...record,revision:2,previousHash:first.receiptHash,record:{...record.record,modelVersion:'2.1',decisionRef:'change-2'}}};
  const next=await submitCustomerApiObservation(session,randomUUID(),changed);
  assert.equal((await submitCustomerApiObservation(session,randomUUID(),changed)).id,next.id);
  const pending=await inventory();assert.equal(pending.version,3);assert.equal(pending.status,'Partner source needs review');
  assert.deepEqual(pending.history.map(h=>h.version),[2,1]);assert.equal(pending.partnerChange?.observationId,next.id);
  await assert.rejects(()=>inventoryAction(x.o,decision(3),x.store),rejects(409));await ack(next.id);
  await inventoryAction(x.o,decision(3),x.store);assert.equal((await inventory()).status,'Restricted');
  await changeCustomerCredential(x.o,key.id,{action:'REVOKE',version:1,confirm:true,requestKey:randomUUID()});
  assert.equal((await inventory()).status,'Partner source needs review');
 }finally{await x.cleanup();}
});

test('group follow-up is atomic across controls, survives retries and links a calibrated excursion and hazard to one investigation',async()=>{
 const x=await fixture();
 try{
  const key=await x.create(undefined,[x.primary.id,x.ungranted.id]),session=await x.session(key.secret!,'observations:write');
  const source={schemaVersion:1,revision:1,state:'CURRENT',sourceSystem:'Fictional facilities',sourceVersion:'2026-11',decisionOwnerRef:'site-quality'};
  const sensor={kind:'CALIBRATED_READING',siteRef:'site1',sensorRef:'s1',calibrationRef:'cert1',calibratedAt:new Date(Date.now()-86400000).toISOString(),calibrationDue:new Date(Date.now()+86400000).toISOString(),unit:'CELSIUS',minimum:2,maximum:8,reading:10,followUpRef:'exc-01'};
  const first=await submitCustomerApiObservation(session,randomUUID(),{...x.observation(x.primary.id,'PASS'),partnerRecord:{...source,recordId:'s1-reading',record:sensor}});
  const second=await submitCustomerApiObservation(session,randomUUID(),{...x.observation(x.primary.id,'PASS'),partnerRecord:{...source,recordId:'food-1',record:{kind:'FOOD_HAZARD',siteRef:'site1',hazardRef:'cold-store',result:'DEVIATION',correctiveActionRef:'exc-01'}}});
  const third=await submitCustomerApiObservation(session,randomUUID(),x.observation(x.ungranted.id));
  for(const row of [first,second])assert.equal(row.reportedOutcome,'REPORTED_FAILURE');
  const records=[first,second,third].map(({id,version,receiptHash})=>({id,version,receiptHash}));
  const input={records,ownerId:x.ed.userId,dueDate:future(),notes,requestKey:randomUUID(),confirm:true};
  const count=()=>db.obligation.count({where:{organizationId:x.a.id,category:'Customer integration follow-up'}});
  await assert.rejects(()=>groupObservationFollowUps(x.ed,input),rejects(403));
  await assert.rejects(()=>groupObservationFollowUps(x.out,{...input,ownerId:x.out.userId}),rejects(404));
  await assert.rejects(()=>groupObservationFollowUps(x.ad,{...input,records:[records[0],records[1],{...records[2],version:4}]}),rejects(409));
  assert.equal(await count(),0);assert.equal(await db.customerApiObservation.count({where:{organizationId:x.a.id,status:'PENDING'}}),3);
  const [done,replay]=await Promise.all([groupObservationFollowUps(x.ad,input),groupObservationFollowUps(x.ad,{...input,records:[...records].reverse()})]);
  assert.notEqual(done.reused,replay.reused);assert.equal(await count(),2);
  const rows=(await developerWorkspace(x.o,{all:true})).observations;
  const taskId=rows.find(r=>r.id===first.id)!.followUpTaskId!;
  const bySite=(site:string)=>db.$transaction(tx=>searchPartnerReports(tx,x.ad,'temperature food hazard',site));
  const reports=await bySite('site1');assert.equal(reports.length,2);assert.ok(reports.every(r=>r.taskId===taskId&&r.outcome==='REPORTED_FAILURE'));
  assert.match(reports.find(r=>r.id===first.id)!.summary,/10 °C/);
  assert.deepEqual(await bySite('site10'),[]);
  assert.equal(rows.find(r=>r.id===second.id)!.followUpTaskId,taskId);assert.notEqual(rows.find(r=>r.id===third.id)!.followUpTaskId,taskId);
  assert.deepEqual((await workTask(x.o,taskId)).integrationReceipts.map(r=>r.id).sort(),[first.id,second.id].sort());assert.deepEqual((await workTask(x.st,taskId)).integrationReceipts,[]);
  await assert.rejects(()=>groupObservationFollowUps(x.ad,{...input,notes:notes+' Revised.'}),rejects(409));
  const quality=await createQualityCase(x.ed,{requestKey:randomUUID(),title:'Cold-store investigation',kind:'DEVIATION',classification:'MAJOR',description:notes,impact:notes,containment:notes,occurredAt:new Date().toISOString().slice(0,10),ownerId:x.ed.userId});
  await addQualityAction(x.ed,quality.id,{requestKey:randomUUID(),version:quality.version,taskId,kind:'CORRECTIVE',purpose:notes});
  for(const id of [first.id,second.id])assert.equal((await partnerFollowUp(x.ad,id)).qualityActions[0].qualityCase.id,quality.id);
  await assert.rejects(()=>partnerFollowUp(x.out,first.id),rejects(404));
 }finally{await x.cleanup();}
});
