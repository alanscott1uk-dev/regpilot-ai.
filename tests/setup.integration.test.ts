import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {getSetupWorkspace,saveSetupWorkspace} from '../lib/server/setup-service';
import {workspaceRegulatorAccounts,saveRegulatorAccount} from '../lib/server/workspace-account-shortcuts';
import {accountingWorkspace,accountingAction} from '../lib/server/accounting-service';

test('workspace regulator shortcuts survive concurrent saves and retries, and only current admins can manage them',async()=>{
 const f=await assuranceFixture();
 try{
  const add=(serviceId:string)=>({serviceId,pinned:true});
  assert.deepEqual((await workspaceRegulatorAccounts(f.o)).serviceIds,[]);
  await Promise.all([saveRegulatorAccount(f.o,add("mhra-process")),saveRegulatorAccount(f.ad,add("home-domestic"))]);
  await saveRegulatorAccount(f.o,add("mhra-process"));
  const ids=["home-domestic","mhra-process"];
  const viewer=await workspaceRegulatorAccounts(f.st);
  assert.deepEqual(viewer.serviceIds.sort(),ids);assert.equal(viewer.canManage,false);
  assert.deepEqual((await getSetupWorkspace(f.st)).accountShortcuts.sort(),ids);
  assert.deepEqual((await workspaceRegulatorAccounts(f.out)).serviceIds,[]);
  await assert.rejects(workspaceRegulatorAccounts({...f.out,organizationId:f.a.id}),rejects(403));
  await assert.rejects(saveRegulatorAccount(f.ed,add("home-trade")),rejects(403));
  for(const bad of [add("https://example.invalid/session"),add("ni-domestic"),{...add("home-trade"),password:"fictional"}])await assert.rejects(saveRegulatorAccount(f.o,bad));
  assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,action:"workspace.regulator_account_pinned"}}),2);
  await saveRegulatorAccount(f.ad,{serviceId:"home-domestic",pinned:false});
  await saveRegulatorAccount(f.ad,{serviceId:"home-domestic",pinned:false});
  assert.deepEqual((await workspaceRegulatorAccounts(f.o)).serviceIds,["mhra-process"]);
  assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,action:"workspace.regulator_account_unpinned"}}),1);
 }finally{await f.cleanup();}
});

test('accounting packages and business checks are tenant-scoped, role-checked and independent of regulator shortcuts',async()=>{
 const f=await assuranceFixture(),keys=["REGPILOT_ACCOUNTING_ENABLED","REGPILOT_NANGO_API_KEY","REGPILOT_NANGO_FREEAGENT_INTEGRATION"] as const;
 const old=keys.map(k=>process.env[k]);
 try{
  delete process.env.REGPILOT_ACCOUNTING_ENABLED;
  await saveRegulatorAccount(f.o,{serviceId:"home-domestic",pinned:true});
  const provider="freeagent",grant="test-grant",add={action:"ADD",provider},verify={action:"VERIFY",provider,connectionId:grant,reference:"fictional"};
  const impossible:typeof fetch=async()=>{assert.fail("Unauthorised connection request");};
  await assert.rejects(accountingAction(f.ed,add),rejects(403));
  await accountingAction(f.o,add);await accountingAction(f.o,add);
  assert.deepEqual((await workspaceRegulatorAccounts(f.o)).serviceIds,["home-domestic"]);
  assert.deepEqual((await accountingWorkspace(f.st)).serviceIds,[provider]);
  assert.deepEqual((await accountingWorkspace(f.out)).serviceIds,[]);
  await assert.rejects(accountingAction(f.st,verify,impossible),rejects(403));
  await assert.rejects(accountingAction(f.out,verify,impossible),rejects(409));
  await assert.rejects(accountingAction(f.o,{action:"AUTHORISE",provider},impossible),rejects(503));
  Object.assign(process.env,{REGPILOT_ACCOUNTING_ENABLED:"true",REGPILOT_NANGO_API_KEY:"fake-key-finance-pilot",REGPILOT_NANGO_FREEAGENT_INTEGRATION:"fixture-freeagent"});
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname==="/connections")return Response.json({connections:[{provider,connection_id:grant,provider_config_key:"fixture-freeagent",tags:{organization_id:f.a.id,regpilot_accounting_provider:provider},errors:[]}]});
    assert.equal(url.pathname,"/proxy/v2/company");return Response.json({company:{subdomain:"fictional",name:"Fixture Ltd",email:"do-not-retain@example.invalid"}});
  };
  const result=await accountingAction(f.ad,verify,fetcher);
  assert.equal(result.type,"business");
  const audit=await db.auditEvent.findFirstOrThrow({where:{organizationId:f.a.id,action:"workspace.accounting_business_checked"}});
  assert.equal(audit.actorId,f.admin.id);assert.match(JSON.stringify(audit.details),/Fixture Ltd/);assert.doesNotMatch(JSON.stringify(audit.details),/do-not-retain/);
  const refreshed=await accountingAction(f.o,{action:"CHECK",provider},fetcher);
  assert.equal(refreshed.type,"grants");if(refreshed.type==="grants")assert.equal(refreshed.grants[0].lastCheck?.name,"Fixture Ltd");
  await accountingAction(f.o,{action:"REMOVE",provider});assert.deepEqual((await accountingWorkspace(f.o)).serviceIds,[]);
  assert.deepEqual((await getSetupWorkspace(f.st)).accountShortcuts,["home-domestic"]);
 }finally{keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});await f.cleanup();}
});
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

test('supplier accounting comparisons bind to a verified business, preserve history and send discrepancies to the owner once',async()=>{
 const {checkSupplierLedger}=await import('../lib/server/accounting-supplier');
 const {vendorDetail,supplierResearch}=await import('../lib/server/vendor-service');
 const {transaction}=await import('../lib/server/intelligence-service');
 const f=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_ACCOUNTING_ENABLED:'true',REGPILOT_NANGO_API_KEY:'fixture-accounting-supplier-key',REGPILOT_NANGO_QUICKBOOKS_INTEGRATION:'fixture-books'});
 const provider='quickbooks',realm='123456',grant='fixture-grant';
 let calls=0,name='Earlier trading name',active=false;
 const fetcher:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;calls++;
  if(path==='/connections')return Response.json({connections:[{provider,provider_config_key:'fixture-books',connection_id:grant,tags:{organization_id:f.a.id,regpilot_accounting_provider:provider},errors:[]}]});
  if(path.endsWith('/companyinfo/'+realm))return Response.json({CompanyInfo:{Id:'1',CompanyName:'Fixture purchaser'}});
  assert.equal(path,'/proxy/v3/company/'+realm+'/vendor/78');
  return Response.json({Vendor:{Id:'78',DisplayName:name,Active:active,Balance:45}});
 };
 try{
  const vendor=await db.vendor.create({data:{organizationId:f.a.id,name:'Supplier Ltd',service:'Packaging',criticality:'HIGH',dataAccess:'BUSINESS',ownerId:f.ed.userId,nextReviewAt:new Date()}});
  const input={vendorId:vendor.id,version:1,provider,connectionId:grant,business:realm,externalId:'78',requestKey:randomUUID()};
  await accountingAction(f.o,{action:'ADD',provider});
  await assert.rejects(()=>checkSupplierLedger(f.ad,input,fetcher),rejects(409));assert.equal(calls,0);
  await accountingAction(f.ad,{action:'VERIFY',provider,connectionId:grant,reference:realm},fetcher);
  const first=await checkSupplierLedger(f.ad,input,fetcher),before=calls;
  assert.equal(first.vendorName,vendor.name);assert.equal(first.sourceActive,false);assert.equal(first.sourceSupplier,true);assert.equal(first.connectionId,grant);
  assert.match(first.comparisonHash,/^[a-f0-9]{64}$/);
  assert.equal((await db.auditEvent.findUniqueOrThrow({where:{id:first.businessCheckId}})).action,'workspace.accounting_business_checked');
  assert.deepEqual(first.issues,['Accounting record is inactive','Supplier names differ']);assert.ok(first.taskId);
  assert.equal((await db.obligation.findUniqueOrThrow({where:{id:first.taskId!}})).assigneeId,f.ed.userId);
  assert.deepEqual(await checkSupplierLedger(f.ad,input,fetcher),first);assert.equal(calls,before);
  await assert.rejects(()=>checkSupplierLedger(f.ed,{...input,requestKey:randomUUID()},fetcher),rejects(403));
  await assert.rejects(()=>checkSupplierLedger(f.out,input,fetcher),rejects(409));
  assert.equal((await checkSupplierLedger(f.o,{...input,requestKey:randomUUID()},fetcher)).taskId,first.taskId);
  name=vendor.name;active=true;
  const matched=await checkSupplierLedger(f.o,{...input,requestKey:randomUUID()},fetcher);
  assert.deepEqual(matched.issues,[]);assert.equal(matched.taskId,null);
  assert.equal((await db.obligation.findUniqueOrThrow({where:{id:first.taskId!}})).status,'OPEN');
  assert.equal((await vendorDetail(f.o,vendor.id)).accountingChecks.length,3);
  const research=await transaction(f.o,tx=>supplierResearch(tx,f.o,[vendor.id],''));
  assert.equal(research[0].accounting?.provider,provider);assert.ok(research[0].openTasks.some(t=>t.id===first.taskId));
  assert.deepEqual(await transaction(f.o,tx=>supplierResearch(tx,f.o,[vendor.id],'Other site')),[]);
  await assert.rejects(()=>checkSupplierLedger(f.ad,{...input,requestKey:randomUUID()},async(resource,init)=>{
   if(new URL(String(resource)).pathname.endsWith('/vendor/78'))return Response.json({Vendor:{Id:'999',DisplayName:vendor.name,Active:true}});
   return fetcher(resource,init);
  }),rejects(409));
  await assert.rejects(()=>checkSupplierLedger(f.ad,{...input,requestKey:randomUUID()},async(resource,init)=>{
   if(new URL(String(resource)).pathname.endsWith('/vendor/78'))await db.vendor.update({where:{id:vendor.id},data:{version:{increment:1}}});
   return fetcher(resource,init);
  }),rejects(409));
  assert.equal((await vendorDetail(f.o,vendor.id)).accountingChecks.length,3);
  assert.doesNotMatch(JSON.stringify((await vendorDetail(f.o,vendor.id)).accountingChecks),/Balance/);
 }finally{await f.cleanup();}
});
