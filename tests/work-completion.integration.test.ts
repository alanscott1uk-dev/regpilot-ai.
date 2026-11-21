import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {workCompletion,completeWork} from '../lib/server/work-completion-service';
import {changeObligationStatus} from '../lib/server/obligation-service';
import {createEvidence,reviewEvidence} from '../lib/server/evidence-service';
import {prepareAssurance,reviewAssurance} from '../lib/server/assurance-service';
import {saveBusinessProfile,createIntelligenceRun,decideCandidate} from '../lib/server/intelligence-service';
import type {AuthorizedContext} from '../lib/server/authorization';
import type {EvidenceObjectStore} from '../lib/server/evidence-storage';
import {hashValue,type Analysis} from '../lib/regulatory/intelligence';
import type {AssuranceResult} from '../lib/evidence/assurance';
import {sourceTextHash} from '../lib/regulatory/source-fingerprint.mjs';
import {checkOfficialSource} from '../lib/server/regulatory-watch';
import {fixturePdf} from './helpers/pdf-fixture.mjs';

test('work completion closes the reviewed evidence loop with tenant isolation, exact proof, atomic rechecks and historical receipts',async()=>{
 const suffix=randomUUID(),users=await Promise.all(['owner','reviewer','uploader','viewer','outside'].map(name=>db.user.create({data:{externalId:name+suffix,email:name+suffix+'@example.invalid'}})));
 const orgs=await Promise.all(['A','B'].map(name=>db.organization.create({data:{name:'Fictional completion '+name+suffix}})));
 const orgIds=orgs.map(row=>row.id),previous=process.env.REGPILOT_AI_ALLOWED_EMAILS;
 process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(user=>user.email).join(',');
 const owner:AuthorizedContext={organizationId:orgIds[0],userId:users[0].id,role:'OWNER'},reviewer:AuthorizedContext={...owner,userId:users[1].id,role:'ADMIN'},uploader:AuthorizedContext={...owner,userId:users[2].id,role:'EDITOR'},viewer:AuthorizedContext={...owner,userId:users[3].id,role:'VIEWER'},outside:AuthorizedContext={organizationId:orgIds[1],userId:users[4].id,role:'OWNER'};
 const notes='Completed the fictional training review and checked the dated implementation records.';
 const objects=new Map<string,Uint8Array>();let downloads=0;
 const store:EvidenceObjectStore={async put(key,bytes){objects.set(key,Uint8Array.from(bytes));},async get(key){downloads++;const bytes=objects.get(key);if(!bytes)throw new Error('Fixture missing');return Uint8Array.from(bytes);},async remove(key){objects.delete(key);}};
 const clean=async()=>({status:'CLEAN' as const,engine:'fixture-only'}),pdf=fixturePdf([['FICTIONAL TRAINING RECORD','Widget staff completed documented training on 4 November 2026 with a supervisor.']]);
 const makeTask=(title:string,organizationId=owner.organizationId)=>db.obligation.create({data:{organizationId,title,category:'Completion test',ownerName:'Fictional owner',assigneeId:organizationId===owner.organizationId?uploader.userId:null,dueDate:new Date('2027-01-31')}});
 const membership=(who:AuthorizedContext,role:'OWNER'|'ADMIN'|'EDITOR'|'VIEWER')=>db.membership.update({where:{organizationId_userId:{organizationId:who.organizationId,userId:who.userId}},data:{role}});
 const inputFor=async(taskId:string,who=owner)=>{const readiness=await workCompletion(who,taskId);assert.equal(readiness.ready,true,JSON.stringify(readiness.blockers));return {token:readiness.token!,evidenceIds:readiness.evidence.map(file=>file.id),confirm:true,notes};};
 try{
  await db.membership.createMany({data:[owner,reviewer,uploader,viewer,outside]});
  await db.obligation.createMany({data:Array.from({length:105},(_,index)=>({organizationId:owner.organizationId,title:'Earlier fictional task '+index,category:'Paging fixture',ownerName:'Fixture',dueDate:new Date('2025-01-01')}))});
  const task=await makeTask('The exact task after the first hundred'),foreign=await makeTask('Foreign secret task',outside.organizationId);
  const noProof=await workCompletion(owner,task.id);
  assert.equal(noProof.task.id,task.id);assert.equal(noProof.ready,false);assert.equal(noProof.token,null);
  assert.ok(noProof.blockers.some(blocker=>blocker.code==='EVIDENCE_REQUIRED'&&blocker.href.includes(task.id)&&blocker.href.includes(owner.organizationId)));
  assert.ok(noProof.blockers.some(blocker=>blocker.code==='EXCEPTION_WORKFLOW'));
  await assert.rejects(()=>workCompletion(outside,task.id),(error:any)=>error.status===404);
  await assert.rejects(()=>workCompletion({...outside,organizationId:owner.organizationId},task.id),(error:any)=>error.status===403);
  await assert.rejects(()=>completeWork(owner,foreign.id,{token:'0'.repeat(64),evidenceIds:[randomUUID()],confirm:true,notes},{storage:store}),(error:any)=>error.status===404);
  await assert.rejects(()=>completeWork(owner,task.id,{token:'0'.repeat(64),evidenceIds:[randomUUID()],confirm:true,notes},{storage:store}),(error:any)=>error.status===409);

  const file=await createEvidence(uploader,task.id,'fictional-training.pdf',pdf,{storage:store,scan:clean});
  const pending=await workCompletion(owner,task.id);assert.equal(pending.ready,false);assert.ok(pending.blockers.some(blocker=>blocker.code==='EVIDENCE_REVIEW_REQUIRED'));
  await reviewEvidence(reviewer,file.id,{decision:'APPROVED',version:1,notes},store);
  const beforeGet={events:await db.auditEvent.count({where:{organizationId:owner.organizationId}}),downloads};
  const preview=await workCompletion(owner,task.id),view=await workCompletion(viewer,task.id);
  assert.equal(preview.ready,true);assert.equal(preview.evidence[0].required,false);assert.equal(view.canComplete,false);assert.equal(view.ready,false);assert.equal(view.token,null);
  assert.equal(downloads,beforeGet.downloads,'readiness does not fetch private bytes');
  assert.equal(await db.auditEvent.count({where:{organizationId:owner.organizationId}}),beforeGet.events,'GET writes no audit events');
  assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,'OPEN','GET cannot complete or start work');
  assert.doesNotMatch(JSON.stringify(preview),/storageKey|reviewerNotes|encryptedSecret|Bearer|bodyText|resultHash/);
  const first={token:preview.token!,evidenceIds:[file.id],confirm:true,notes};
  await assert.rejects(()=>completeWork(viewer,task.id,first,{storage:store}),(error:any)=>error.status===403);
  await assert.rejects(()=>completeWork(owner,task.id,{...first,confirm:false},{storage:store}),(error:any)=>error.status===400);
  await assert.rejects(()=>completeWork(owner,task.id,{...first,evidenceIds:[randomUUID()]},{storage:store}),(error:any)=>error.status===409);
  const foreignFile=await db.evidence.create({data:{organizationId:outside.organizationId,obligationId:foreign.id,filename:'Foreign secret file.pdf',storageKey:'foreign-private-key',contentType:'application/pdf',sizeBytes:1,sha256:'f'.repeat(64),scanStatus:'CLEAN',reviewStatus:'APPROVED',uploadedById:outside.userId,reviewerId:outside.userId,reviewedAt:new Date()}});
  await assert.rejects(()=>completeWork(owner,task.id,{...first,evidenceIds:[foreignFile.id]},{storage:store}),(error:any)=>error.status===409);
  await db.obligation.update({where:{id:task.id},data:{notes:'A concurrent outcome change'}});
  await assert.rejects(()=>completeWork(owner,task.id,first,{storage:store}),(error:any)=>error.status===409,'stale task snapshot cannot close a changed task');
  let fresh=await inputFor(task.id);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:store}),(error:any)=>error.status===409,'review version is part of the proof');
  const metadata=await db.evidence.findUniqueOrThrow({where:{id:file.id}});
  fresh=await inputFor(task.id);objects.set(metadata.storageKey,fixturePdf([['Tampered stored record']]));
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:store}),(error:any)=>error.status===409,'metadata alone never proves bytes');objects.set(metadata.storageKey,pdf);

  for(const role of ['reviewer','uploader'] as const){
   const who=role==='reviewer'?reviewer:uploader;
   fresh=await inputFor(task.id);await membership(who,'VIEWER');
   assert.equal((await workCompletion(owner,task.id)).ready,false,role+' role revocation blocks proof');
   await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:store}),(error:any)=>error.status===409);
   await membership(who,role==='reviewer'?'ADMIN':'EDITOR');
  }
  process.env.REGPILOT_AI_ALLOWED_EMAILS=users.filter(user=>user.id!==reviewer.userId).map(user=>user.email).join(',');
  assert.equal((await workCompletion(owner,task.id)).ready,false,'a reviewer removed from the pilot allowlist no longer authorises proof');
  process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(user=>user.email).join(',');
  for(const reviewStatus of ['PENDING_REVIEW','REJECTED','DRAFT'] as const){
   await db.evidence.update({where:{id:file.id},data:{reviewStatus}});assert.equal((await workCompletion(owner,task.id)).ready,false);
  }
  await db.evidence.update({where:{id:file.id},data:{reviewStatus:'APPROVED',reviewerId:uploader.userId}});
  assert.equal((await workCompletion(owner,task.id)).ready,false,'self approval does not qualify');
  await db.evidence.update({where:{id:file.id},data:{reviewerId:reviewer.userId,scanStatus:'QUARANTINED'}});
  assert.equal((await workCompletion(owner,task.id)).ready,false);
  await db.evidence.update({where:{id:file.id},data:{scanStatus:'CLEAN'}});

  fresh=await inputFor(task.id);let interrupted=false;
  const revokeDuringRead:EvidenceObjectStore={...store,async get(key){const bytes=await store.get(key);if(!interrupted){interrupted=true;await membership(reviewer,'VIEWER');}return bytes;}};
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:revokeDuringRead}),(error:any)=>error.status===409,'permission recheck after the slow object read');
  assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,'OPEN');await membership(reviewer,'ADMIN');
  fresh=await inputFor(task.id);
  const changeDuringRead:EvidenceObjectStore={...store,async get(key){const bytes=await store.get(key);await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});return bytes;}};
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:changeDuringRead}),(error:any)=>error.status===409,'proof is repeated after byte verification');
  fresh=await inputFor(task.id);
  const revokeActor:EvidenceObjectStore={...store,async get(key){const bytes=await store.get(key);await membership(owner,'VIEWER');return bytes;}};
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:revokeActor}),(error:any)=>error.status===403);await membership(owner,'OWNER');

  const programme=await db.programmeImport.create({data:{organizationId:owner.organizationId,createdById:owner.userId,inputHash:'a'.repeat(64),evidenceManifest:[],method:'FIXTURE'}});
  const control=await db.managedControl.create({data:{organizationId:owner.organizationId,importId:programme.id,proposalKey:'test-control',title:'Fictional training control',description:'Fictional control',testProcedure:'Check the dated records',theme:'People',ownerId:owner.userId,scheduledById:owner.userId,intervalDays:30,nextReviewAt:new Date('2027-01-31')}});
  await db.obligation.update({where:{id:task.id},data:{controlId:control.id}});
  fresh=await inputFor(task.id);await db.managedControl.update({where:{id:control.id},data:{version:{increment:1}}});
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:store}),(error:any)=>error.status===409,'control revision is bound to confirmation');
  fresh=await inputFor(task.id);
  const completed=await Promise.all([completeWork(owner,task.id,fresh,{storage:store}),completeWork(owner,task.id,fresh,{storage:store})]);
  assert.equal(new Set(completed.map(row=>row.eventId)).size,1);assert.equal(completed.filter(row=>row.reused).length,1);
  assert.equal(await db.auditEvent.count({where:{organizationId:owner.organizationId,entityId:task.id,action:'work.completed'}}),1,'two explicit submissions produce one decision');
  const saved=await workCompletion(viewer,task.id);assert.equal(saved.ready,false);assert.equal(saved.token,null);assert.ok(saved.receipt);assert.equal(saved.receipt!.notes,notes);assert.equal(saved.receipt!.control!.version,2);assert.equal(saved.receipt!.evidence[0].reviewerId,reviewer.userId);
  assert.equal(hashValue(saved.receipt),saved.completed!.proofHash);
  assert.doesNotMatch(JSON.stringify(saved),/storageKey|foreign-private-key|encryptedSecret|Bearer|reviewerNotes|bodyText/);
  assert.equal((await completeWork(owner,task.id,fresh,{storage:store})).reused,true);
  await assert.rejects(()=>completeWork(owner,task.id,{...fresh,notes:notes+' Different decision.'},{storage:store}),(error:any)=>error.status===409);
  await db.evidence.update({where:{id:file.id},data:{reviewStatus:'REJECTED',reviewVersion:{increment:1}}});
  assert.deepEqual((await workCompletion(viewer,task.id)).receipt,saved.receipt,'receipt is frozen even if evidence later changes');
  const event=await db.auditEvent.findUniqueOrThrow({where:{id:saved.completed!.eventId}});
  await db.auditEvent.update({where:{id:event.id},data:{details:{...(event.details as object),proofHash:'0'.repeat(64)}}});
  const damaged=await workCompletion(viewer,task.id);assert.equal(damaged.receipt,null,'damaged receipt is not presented as verified');assert.ok(damaged.blockers.some(blocker=>blocker.code==='COMPLETION_RECORD_UNAVAILABLE'&&!blocker.href));
  await db.auditEvent.update({where:{id:event.id},data:{details:event.details!}});
  await db.obligation.update({where:{id:task.id},data:{status:'OPEN',completedAt:null}});
  assert.equal((await workCompletion(owner,task.id)).receipt,null,'a reopened task cannot display an old completion as current');
  await assert.rejects(()=>completeWork(owner,task.id,fresh,{storage:store}),(error:any)=>error.status===409);

  // Real content assessment flow: a file approved for one task may be scoped to another requirement.
  await saveBusinessProfile(owner,{activities:['personal-data'],jurisdictions:['Scotland']},0);
  const text='Fictional widget staff must complete documented training before working alone. Widget operators must retain completed training records for review.';
  const snapshot=await db.regulatorySnapshot.create({data:{organizationId:owner.organizationId,sourceId:'uk-data-protection',title:'Fictional source',url:'https://www.gov.uk/guidance/fictional-previous-data-protection',bodyText:text,contentHash:sourceTextHash(text),capturedById:owner.userId,reviewStatus:'REVIEWED',reviewerId:reviewer.userId,reviewedAt:new Date()}});
  const run=await createIntelligenceRun(owner,snapshot.id),runRow=await db.intelligenceRun.findUniqueOrThrow({where:{id:run.id}}),candidates=(runRow.result as unknown as Analysis).candidates;
  const decisions=[];
  for(const candidate of candidates)decisions.push(await decideCandidate(reviewer,run.id,{candidateKey:candidate.key,decision:'ACCEPTED',rationale:notes,title:candidate.quote.slice(0,100),ownerName:'Fictional owner',dueDate:'2027-01-31'}));
  const sourceTaskId=decisions[0].obligationId!,reuseTaskId=decisions[1].obligationId!;
  assert.ok((await workCompletion(owner,sourceTaskId)).blockers.some(blocker=>blocker.code==='ASSESSMENT_REQUIRED'));
  const sourceFile=await createEvidence(uploader,sourceTaskId,'fictional-source-proof.pdf',pdf,{storage:store,scan:clean});
  await reviewEvidence(reviewer,sourceFile.id,{decision:'APPROVED',version:1,notes},store);
  assert.equal((await workCompletion(owner,sourceTaskId)).ready,false,'a source task cannot close using file approval alone');
  const until=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const prepare=async(taskId:string)=>{
   const assessment=await prepareAssurance(owner,{taskId,evidenceIds:[sourceFile.id],method:'CONTENT_SEARCH',consent:true},{storage:store});
   const row=await db.assuranceAssessment.findUniqueOrThrow({where:{id:assessment.id}}),result=row.result as unknown as AssuranceResult;
   await reviewAssurance(reviewer,assessment.id,{decision:'ACCEPTED',version:1,notes:notes+' Independently checked scope and original PDF.',passageKeys:[result.passages.find(passage=>passage.quote.startsWith('Widget staff completed'))!.key],validUntil:until,scopeConfirmed:true,originalsChecked:true},{storage:store});
   return assessment.id;
  };
  const assessmentId=await prepare(sourceTaskId),reuseAssessmentId=await prepare(reuseTaskId);
  const sourcePreview=await workCompletion(owner,sourceTaskId);assert.equal(sourcePreview.ready,true);assert.equal(sourcePreview.evidence[0].required,true);assert.equal(sourcePreview.assessment!.id,assessmentId);
  const reusedPreview=await workCompletion(owner,reuseTaskId);assert.equal(reusedPreview.ready,true);assert.equal(reusedPreview.evidence[0].id,sourceFile.id,'accepted scope may reuse an approved file from another task');
  const sourceInput=await inputFor(sourceTaskId);
  await assert.rejects(()=>completeWork(owner,sourceTaskId,{...sourceInput,evidenceIds:[file.id]},{storage:store}),(error:any)=>error.status===409,'only the accepted manifest can complete source work');
  await db.assuranceAssessment.update({where:{id:assessmentId},data:{validUntil:new Date(Date.now()-1000)}});
  assert.equal((await workCompletion(owner,sourceTaskId)).ready,false);await assert.rejects(()=>completeWork(owner,sourceTaskId,sourceInput,{storage:store}),(error:any)=>error.status===409);
  await db.assuranceAssessment.update({where:{id:assessmentId},data:{validUntil:new Date(until+'T23:59:59.999Z')}});
  await db.regulatorySnapshot.update({where:{id:snapshot.id},data:{lastCheckedAt:new Date(Date.now()-8*86400000)}});
  assert.equal((await workCompletion(owner,sourceTaskId)).ready,false,'existing seven-day source freshness gate is preserved');
  await db.regulatorySnapshot.update({where:{id:snapshot.id},data:{lastCheckedAt:new Date()}});
  await db.businessProfile.update({where:{organizationId:owner.organizationId},data:{version:{increment:1}}});
  assert.equal((await workCompletion(owner,sourceTaskId)).ready,false,'business-context changes invalidate the accepted assessment');
  await db.businessProfile.update({where:{organizationId:owner.organizationId},data:{version:1}});
  const currentSourceInput=await inputFor(sourceTaskId);
  const expireDuringRead:EvidenceObjectStore={...store,async get(key){const bytes=await store.get(key);await db.assuranceAssessment.update({where:{id:assessmentId},data:{validUntil:new Date(Date.now()-1000)}});return bytes;}};
  await assert.rejects(()=>completeWork(owner,sourceTaskId,currentSourceInput,{storage:expireDuringRead}),(error:any)=>error.status===409,'assessment is checked again after byte verification');
  await db.assuranceAssessment.update({where:{id:assessmentId},data:{validUntil:new Date(until+'T23:59:59.999Z')}});
  await completeWork(owner,sourceTaskId,await inputFor(sourceTaskId),{storage:store});
  await completeWork(owner,reuseTaskId,await inputFor(reuseTaskId),{storage:store});
  const sourceReceipt=(await workCompletion(viewer,sourceTaskId)).receipt!;
  assert.equal(sourceReceipt.source!.contentHash,snapshot.contentHash);assert.equal(sourceReceipt.source!.reviewerId,reviewer.userId);assert.equal(sourceReceipt.source!.capturedById,owner.userId);assert.equal(sourceReceipt.assessment!.id,assessmentId);assert.equal(sourceReceipt.assessment!.version,2);
  assert.equal((await workCompletion(viewer,reuseTaskId)).receipt!.assessment!.id,reuseAssessmentId);

  const relocated=await checkOfficialSource(owner,snapshot.sourceId,async()=>({id:snapshot.sourceId,title:snapshot.title,url:'https://www.gov.uk/data-protection-your-business',updatedAt:null,revisionAt:null,text}));
  assert.equal(relocated.state,'BASELINE');assert.equal(relocated.snapshot.reviewStatus,'NEEDS_REVIEW');assert.notEqual(relocated.snapshot.id,snapshot.id);
  assert.equal(sourceReceipt.source!.url,snapshot.url);assert.equal(sourceReceipt.source!.id,snapshot.id);
  assert.deepEqual((await workCompletion(viewer,sourceTaskId)).receipt,sourceReceipt,'canonical relocation cannot rewrite the frozen source identity in a completed report');
  assert.equal((await db.regulatorySnapshot.findUniqueOrThrow({where:{id:snapshot.id}})).url,snapshot.url);

  // The hub never substitutes for specialised submission/review workflows, even with approved files.
  const specialistTasks=await Promise.all(['Change response','Audit request','Access remediation'].map(title=>makeTask(title)));
  const response=await db.changeResponse.create({data:{organizationId:owner.organizationId,snapshotId:snapshot.id,createdById:owner.userId,title:'Fictional response',plan:{},planHash:hashValue({})}});
  await db.changeAction.create({data:{organizationId:owner.organizationId,responseId:response.id,controlId:control.id,taskId:specialistTasks[0].id,requirements:[]}});
  const room=await db.auditRoom.create({data:{organizationId:owner.organizationId,createdById:owner.userId,title:'Fictional audit',purpose:'Fictional test only',manifest:{},manifestHash:hashValue({}),expiresAt:new Date(Date.now()+86400000)}});
  await db.auditRequest.create({data:{organizationId:owner.organizationId,roomId:room.id,taskId:specialistTasks[1].id,controlId:control.id,controlSnapshot:{},controlHash:hashValue({}),title:'Fictional request',instructions:'Review in the audit workflow'}});
  const inventory=await db.accessInventory.create({data:{organizationId:owner.organizationId,createdById:owner.userId,system:'Fixture',source:'MANUAL',observedAt:new Date(),records:[],recordsHash:hashValue([])}});
  const campaign=await db.accessCampaign.create({data:{organizationId:owner.organizationId,inventoryId:inventory.id,createdById:owner.userId,title:'Fictional access review',dueDate:new Date('2027-01-31')}});
  await db.accessReviewItem.create({data:{organizationId:owner.organizationId,campaignId:campaign.id,reviewerId:reviewer.userId,taskId:specialistTasks[2].id,entry:{},entryHash:hashValue({})}});
  for(const specialist of specialistTasks){
   const proof=await createEvidence(uploader,specialist.id,'fictional-specialist.pdf',pdf,{storage:store,scan:clean});await reviewEvidence(reviewer,proof.id,{decision:'APPROVED',version:1,notes},store);
   const state=await workCompletion(owner,specialist.id);assert.equal(state.canComplete,false);assert.equal(state.ready,false);assert.ok(state.blockers.some(blocker=>blocker.code==='SPECIALIST_WORKFLOW'));
   await assert.rejects(()=>completeWork(owner,specialist.id,{token:'0'.repeat(64),evidenceIds:[proof.id],confirm:true,notes},{storage:store}),(error:any)=>error.status===409);
   for(const status of ['COMPLETE','OPEN','IN_PROGRESS'] as const)await assert.rejects(()=>changeObligationStatus(owner,specialist.id,status,{completionRationale:notes,evidenceStore:store}),(error:any)=>error.status===409&&/linked/.test(error.message),'the general status API cannot bypass or desynchronise the specialist workflow');
   assert.equal((await db.obligation.findUniqueOrThrow({where:{id:specialist.id}})).status,'OPEN');
  }
 }finally{
  if(previous===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=previous;
  const where={organizationId:{in:orgIds}};
  await db.changeAction.deleteMany({where});await db.changeResponse.deleteMany({where});await db.auditRequest.deleteMany({where});await db.auditRoom.deleteMany({where});await db.accessReviewItem.deleteMany({where});await db.accessCampaign.deleteMany({where});await db.accessInventory.deleteMany({where});
  await db.assuranceAssessment.deleteMany({where});await db.intelligenceDecision.deleteMany({where});await db.intelligenceRun.deleteMany({where});await db.businessProfile.deleteMany({where});await db.auditEvent.deleteMany({where});await db.evidence.deleteMany({where});await db.obligation.deleteMany({where});await db.managedControl.deleteMany({where});await db.programmeImport.deleteMany({where});await db.regulatorySnapshot.deleteMany({where});await db.membership.deleteMany({where});await db.organization.deleteMany({where:{id:{in:orgIds}}});await db.user.deleteMany({where:{id:{in:users.map(user=>user.id)}}});await db.$disconnect();
 }
});
