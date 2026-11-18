import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {getSetupWorkspace,saveSetupWorkspace} from '../lib/server/setup-service';
import {operationsWorkspace} from '../lib/server/operations-service';
import {fetchOperationalBrief} from '../lib/server/briefing-service';
import {workCompletion,completeWork} from '../lib/server/work-completion-service';
import {reviewEvidence} from '../lib/server/evidence-service';
import {sourceTextHash} from '../lib/regulatory/source-fingerprint.mjs';
import {hashValue} from '../lib/regulatory/intelligence';
import {exportBriefCsv} from '../lib/operational-brief.mjs';
const input={profileVersion:0,activities:['personal-data'],jurisdictions:['Scotland'],sources:[{sourceId:'uk-data-protection',version:0}],intervalHours:24,reviewAcknowledged:true};
test('setup saves profile and schedules atomically, preserves facts and unselected schedules, and rejects stale writes',async()=>{
 const x=await assuranceFixture();
 try{
  const result=await saveSetupWorkspace(x.o,input);assert.equal(result.created,1);assert.equal(result.profileVersion,1);
  const where={organizationId_sourceId:{organizationId:x.a.id,sourceId:'uk-data-protection'}};
  const first=(await db.watchSchedule.findUnique({where}))!;
  await db.businessProfile.update({where:{organizationId:x.a.id},data:{facts:{fictional:'retained'}}});
  const other=await db.watchSchedule.create({data:{organizationId:x.a.id,sourceId:'acas-disciplinary',configuredById:x.owner.id,enabled:false,intervalHours:168}});
  const matching={...input,profileVersion:1,sources:[{sourceId:first.sourceId,version:first.version}]};
  const repeat=await saveSetupWorkspace(x.ad,matching);assert.equal(repeat.unchanged,1);assert.equal(repeat.profileVersion,1);
  assert.deepEqual(await db.watchSchedule.findUnique({where}),first,'matching schedule retains lease and timing');
  assert.deepEqual((await db.businessProfile.findUnique({where:{organizationId:x.a.id}}))!.facts,{fictional:'retained'});
  assert.deepEqual(await db.watchSchedule.findUnique({where:{id:other.id}}),other);
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...matching,profileVersion:0,activities:['medicines']}),rejects(409));
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...matching,sources:[{sourceId:first.sourceId,version:0}],activities:['medicines']}),rejects(409));
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...matching,sources:[...matching.sources,{sourceId:'unknown-publication',version:0}],activities:['medicines']}));
  assert.deepEqual((await db.businessProfile.findUnique({where:{organizationId:x.a.id}}))!.activities,['personal-data']);
  assert.equal(await db.watchSchedule.count({where:{organizationId:x.a.id}}),2);
  const changed=await saveSetupWorkspace(x.o,{...matching,activities:['medicines'],intervalHours:168});assert.equal(changed.updated,1);assert.equal(changed.profileVersion,2);
  assert.equal((await db.watchSchedule.findUnique({where}))!.version,first.version+1);
  assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id,action:'workspace.setup_saved'}}),3);
  assert.equal(await db.businessProfile.count({where:{organizationId:x.b.id}}),0);
 }finally{await db.watchSchedule.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await x.cleanup();}
});
test('setup checks current membership, organisation boundaries, review acknowledgement and source versions',async()=>{
 const x=await assuranceFixture();
 try{
  await assert.rejects(()=>saveSetupWorkspace({...x.st,role:'OWNER'},input),rejects(403));
  await assert.rejects(()=>saveSetupWorkspace({...x.out,organizationId:x.a.id},input),rejects(403));
  await assert.rejects(()=>getSetupWorkspace({...x.out,organizationId:x.a.id}),rejects(403));
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...input,reviewAcknowledged:false}));
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...input,sources:[input.sources[0],input.sources[0]]}));
  const registered=await db.registeredSource.create({data:{organizationId:x.b.id,sourceId:'govuk-fictional-private',path:'/fictional-private',title:'Fictional test only',documentType:'guide',registeredById:x.foreign.id}});
  await assert.rejects(()=>saveSetupWorkspace(x.o,{...input,sources:[{sourceId:registered.sourceId,version:0}]}));
  assert.equal(await db.businessProfile.count({where:{organizationId:x.a.id}}),0);
  await saveSetupWorkspace(x.o,input);
  process.env.REGPILOT_MONITORING_ENABLED='false';
  const view=await getSetupWorkspace(x.st);assert.equal(view.role,'VIEWER');assert.equal(view.watches.length,1);assert.equal(view.features.monitoring,false);assert.equal(view.independentReviewers,2);
  assert.ok(!view.catalogue.some(s=>s.id===registered.sourceId));
  const foreign=await getSetupWorkspace(x.out);assert.equal(foreign.profile,null);assert.equal(foreign.watches.length,0);
  process.env.REGPILOT_AI_ALLOWED_EMAILS=x.owner.email;
  assert.equal((await getSetupWorkspace(x.o)).independentReviewers,1);
  await db.membership.delete({where:{organizationId_userId:{organizationId:x.a.id,userId:x.owner.id}}});
  await assert.rejects(()=>saveSetupWorkspace(x.o,input),rejects(403));
 }finally{await db.registeredSource.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await db.watchSchedule.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await x.cleanup();}
});

test('workspace journey connects scope, latest source review, full task ownership, independently approved evidence and verified report records',async()=>{
 const x=await assuranceFixture(),flags=['REGPILOT_MONITORING_ENABLED','REGPILOT_AUTOMATION_ENABLED','REGPILOT_CRON_ENABLED','REGPILOT_WORKER_ENABLED'] as const;
 const prior=Object.fromEntries(flags.map(key=>[key,process.env[key]]));
 const notes='Independently checked the fictional records and recorded the completed task outcome.';
 try{
  Object.assign(process.env,{REGPILOT_MONITORING_ENABLED:'true',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_CRON_ENABLED:'false',REGPILOT_WORKER_ENABLED:'true'});
  const initialEvents=await db.auditEvent.count({where:{organizationId:x.a.id}});
  const initial=(await operationsWorkspace(x.o)).journey;
  assert.equal(initial.nextAction.key,'scope');assert.equal(initial.facts.totalTasks,1);assert.equal(initial.facts.recordedCompletions,0);
  assert.equal(initial.steps.find(s=>s.key==='report')?.status,'AVAILABLE','opening a report is not a fictitious saved/exported milestone');
  assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id}}),initialEvents,'journey GET is read-only');
  for(const step of initial.steps)assert.equal(new URL(step.href,'https://fictional.invalid').searchParams.get('organizationId'),x.a.id);
  await saveSetupWorkspace(x.o,input);
  assert.equal((await getSetupWorkspace(x.o)).features.monitoring,true,'worker-only runtime is configured without requiring cron');
  const text='Fictional staff must record training before carrying out widget work. Supervisors must retain the dated training record and check it before assigning independent work.';
  const source=await db.regulatorySnapshot.create({data:{organizationId:x.a.id,sourceId:'uk-data-protection',title:'Fictional selected publication',url:'https://www.gov.uk/data-protection-your-business',bodyText:text,contentHash:sourceTextHash(text),capturedById:x.editor.id,reviewerId:x.admin.id,reviewedAt:new Date(),reviewStatus:'REVIEWED',firstCapturedAt:new Date(Date.now()-60000)}});
  await db.watchSchedule.update({where:{organizationId_sourceId:{organizationId:x.a.id,sourceId:source.sourceId}},data:{lastSuccessAt:new Date(),nextCheckAt:new Date(Date.now()+86400000)}});
  await db.obligation.createMany({data:Array.from({length:105},(_,i)=>({organizationId:x.a.id,title:'Fictional owned work '+i,category:'Journey fixture',ownerName:x.editor.email,assigneeId:x.editor.id,dueDate:new Date('2027-01-31')}))});
  let journey=(await operationsWorkspace(x.o)).journey;
  assert.equal(journey.facts.totalTasks,106);assert.equal(journey.facts.assignedOpenTasks,105);assert.equal(journey.facts.unassignedOpenTasks,1,'ownership counts cover the full organisation beyond first100');
  assert.equal(journey.steps.find(s=>s.key==='sources')?.status,'RECORDED');
  await db.regulatorySnapshot.create({data:{organizationId:x.a.id,sourceId:source.sourceId,title:'Fictional newer selected publication',url:source.url,bodyText:text+' Additional requirement.',contentHash:sourceTextHash(text+' Additional requirement.'),capturedById:x.editor.id,firstCapturedAt:new Date()}});
  journey=(await operationsWorkspace(x.o)).journey;
  assert.equal(journey.facts.latestCapturedSources,1);assert.equal(journey.facts.latestSourcesAwaitingReview,1,'older reviewed capture does not hide the latest pending version');
  assert.equal(new URL(journey.steps.find(s=>s.key==='sources')!.href,'https://fictional.invalid').searchParams.get('sourceId'),source.sourceId,'source action keeps the exact pending publication');

  const file=await x.file(false);
  assert.equal((await operationsWorkspace(x.o)).journey.facts.pendingFiles,1);
  await reviewEvidence(x.ad,file.id,{decision:'APPROVED',version:1,notes},x.store);
  assert.equal((await operationsWorkspace(x.o)).journey.facts.independentlyApprovedFiles,1);
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.editor.id}},data:{role:'VIEWER'}});
  journey=(await operationsWorkspace(x.o)).journey;
  assert.equal(journey.facts.assignedOpenTasks,0);assert.equal(journey.facts.independentlyApprovedFiles,0,'revoked uploader does not count as eligible approved evidence');
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.editor.id}},data:{role:'EDITOR'}});
  process.env.REGPILOT_AI_ALLOWED_EMAILS=x.users.filter(user=>user.id!==x.admin.id).map(user=>user.email).join(',');
  assert.equal((await operationsWorkspace(x.o)).journey.facts.independentlyApprovedFiles,0,'an inactive reviewer does not count as an eligible approval');
  process.env.REGPILOT_AI_ALLOWED_EMAILS=x.users.map(user=>user.email).join(',');
  const task=await db.obligation.findUniqueOrThrow({where:{id:file.obligationId}}),preview=await workCompletion(x.o,task.id);
  assert.equal(preview.ready,true);
  const result=await completeWork(x.o,task.id,{token:preview.token!,evidenceIds:[file.id],confirm:true,notes},{storage:x.store});
  const beforeRead=await db.auditEvent.count({where:{organizationId:x.a.id}});
  journey=(await operationsWorkspace(x.st)).journey;
  assert.equal(journey.facts.completedTasks,1);assert.equal(journey.facts.recordedCompletions,1);
  const report=await fetchOperationalBrief(x.st),record=report.completedWork[0];
  assert.equal(report.organizationId,x.a.id);assert.equal(report.summary.completedWork,1);assert.equal(record.taskId,task.id);assert.equal(record.eventId,result.eventId);
  assert.equal(record.proofHash,hashValue(record.receipt));assert.equal(record.receipt.evidence[0].id,file.id);
  assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id}}),beforeRead,'report and milestone reads never mark anything completed/exported');
  for(const row of [...report.changes,...report.pending,...report.collections,...report.connectors,...report.tasks,...report.completedWork])assert.equal(new URL(row.href,'https://fictional.invalid').searchParams.get('organizationId'),x.a.id);
  const csv=exportBriefCsv(report);assert.match(csv,/Evidence-backed completion/);assert.ok(csv.includes(result.eventId)&&csv.includes(result.proofHash));
  assert.equal((await fetchOperationalBrief(x.out)).completedWork.length,0);assert.equal((await operationsWorkspace(x.out)).journey.facts.totalTasks,0);
  await assert.rejects(()=>operationsWorkspace({...x.out,organizationId:x.a.id}),rejects(403));
  await assert.rejects(()=>fetchOperationalBrief({...x.out,organizationId:x.a.id}),rejects(403));
  await db.evidence.update({where:{id:file.id},data:{reviewStatus:'REJECTED'}});
  assert.equal((await operationsWorkspace(x.o)).journey.facts.independentlyApprovedFiles,0);
  assert.deepEqual((await fetchOperationalBrief(x.o)).completedWork[0].receipt,record.receipt,'historical proof is frozen and expressly not a current compliance assertion');
  const event=await db.auditEvent.findUniqueOrThrow({where:{id:result.eventId}});
  await db.auditEvent.update({where:{id:event.id},data:{details:{...(event.details as object),proofHash:'0'.repeat(64)}}});
  const unavailable=await fetchOperationalBrief(x.o);
  assert.equal(unavailable.completedWork.length,0);assert.equal(unavailable.completionRecordsUnavailable,1,'corrupt receipt never becomes an exportable record');
  assert.equal((await operationsWorkspace(x.o)).journey.facts.recordedCompletions,0);
  await db.auditEvent.update({where:{id:event.id},data:{details:event.details!}});
  const later=await db.auditEvent.create({data:{organizationId:x.a.id,actorId:x.owner.id,action:'work.completed',entityType:'Obligation',entityId:task.id,details:{receipt:{foreign:'Not a valid receipt'}},createdAt:new Date(Date.now()+1)}});
  assert.equal((await fetchOperationalBrief(x.o)).completedWork.length,0,'a malformed newer completion cannot fall back to an older valid event');
  await db.auditEvent.delete({where:{id:later.id}});
  await db.obligation.update({where:{id:task.id},data:{status:'OPEN',completedAt:null}});
  assert.equal((await fetchOperationalBrief(x.o)).completedWork.length,0,'reopened task does not expose old completion as a current saved outcome');
 }finally{
  for(const key of flags){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
  await db.watchSchedule.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await x.cleanup();
 }
});
