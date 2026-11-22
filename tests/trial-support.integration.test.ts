import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assuranceFixture,future,rejects} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
import {siteQualification,recordSiteDecision} from '../lib/server/site-qualification-service';
import {protocolTemplate} from '../lib/site-qualification';
import {recordTrial,trialWorkspace} from '../lib/server/capability-trial-service';
import {helpMaintenance,changeHelp} from '../lib/server/help-support';
import {groupRiskReport} from '../lib/server/group-risk-report';
test('timed runs retain release, separate blind decisions, evidence versions and tenant boundaries',async()=>{
 const f=await assuranceFixture();try{
  const file=await f.file(),plan={action:'START',track:'research',steps:['answer','draft'],release:'d'.repeat(40),intendedUse:'Fictional independent assessment of source citations and answer quality.',environment:'FIXTURE',ukExternal:false,requestKey:randomUUID()};
  await assert.rejects(()=>recordTrial(f.ed,{...plan,ukExternal:true}),rejects(400));
  const {id}=await recordTrial(f.ed,plan);assert.equal((await recordTrial(f.ed,plan)).id,id);
  const finish={action:'FINISH',id,results:plan.steps.map(step=>({step,notes:'The recorded evidence describes the observed result.',evidenceId:file.id,outcome:'PASS',unsupported:0,edits:1,assisted:false}))};
  await assert.rejects(()=>recordTrial(f.o,finish,f.store),rejects(403));await recordTrial(f.ed,finish,f.store);
  const review={action:'REVIEW',id,decision:'ACCEPT',notes:'I checked the exact source against the supplied published claim.'};
  await assert.rejects(()=>recordTrial(f.out,review,f.store),rejects(404));await recordTrial(f.ad,review,f.store);
  let view=(await trialWorkspace(f.o)).trials[0];assert.equal(view.reviewCount,1);assert.deepEqual(view.reviewDecisions,[]);assert.equal(view.accepted,false);
  await recordTrial(f.o,review,f.store);view=(await trialWorkspace(f.o)).trials[0];assert.equal(view.accepted,true);assert.equal(view.environment,'FIXTURE');
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});assert.equal((await trialWorkspace(f.o)).trials[0].accepted,false);
 }finally{await f.cleanup();}
});
test('paired process comparisons stop the server timer, bind the timing evidence and retain release history beyond 50 runs',async()=>{
 const f=await assuranceFixture();
 try{
  const release='a'.repeat(40),file=await f.file(),baseline=await f.file();
  const plan={action:'START',requestKey:randomUUID(),track:'business',steps:['help'],release,
   environment:'PARTNER_SANDBOX',ukExternal:true,intendedUse:'Compare unaided recovery from a failed connection.'};
  const {id}=await recordTrial(f.ed,plan);
  const finish={action:'FINISH',id,results:[{step:'help',outcome:'PASS',notes:'Recovered using the approved support guide.',evidenceId:file.id,unsupported:0,edits:1,assisted:false}],
   comparison:{productId:'S001',method:'Vanta pilot support configuration',elapsedSeconds:210,edits:3,evidenceId:baseline.id,sameTasks:true}};
  await assert.rejects(()=>recordTrial(f.ed,{...finish,comparison:{...finish.comparison,productId:'no-such-product'}},f.store));
  await assert.rejects(()=>recordTrial(f.ed,finish,f.store),rejects(409));
  await assert.rejects(()=>recordTrial(f.ad,{action:'STOP',id}),rejects(403));
  await Promise.all([recordTrial(f.ed,{action:'STOP',id}),recordTrial(f.ed,{action:'STOP',id})]);
  assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,entityId:id,action:'trial.stop'}}),1);
  await recordTrial(f.ed,finish,f.store);
  await recordTrial(f.ad,{action:'REVIEW',id,decision:'ACCEPT',notes:'I reviewed both records for the same tasks and scope.'},f.store);
  let record=(await trialWorkspace(f.o,{release})).trials[0];
  assert.equal(record.elapsedSeconds,Math.floor((Date.parse(record.stoppedAt!)-Date.parse(record.startedAt))/1000));
  assert.deepEqual(record.comparison,finish.comparison);assert.equal(record.accepted,true);
  const createdAt=new Date(Date.now()+1000);
  await db.auditEvent.createMany({data:Array.from({length:50},()=>{const requestKey=randomUUID();return {organizationId:f.a.id,actorId:f.ed.userId,entityId:requestKey,entityType:'CapabilityTrial',action:'trial.start',createdAt,details:{...plan,requestKey}};})});
  const first=await trialWorkspace(f.o,{release}),next=await trialWorkspace(f.o,{release,before:first.nextCursor!});
  assert.equal(first.trials.length,50);assert.equal(next.trials.length,1);assert.equal(next.trials[0].id,id);assert.equal(next.nextCursor,null);
  await assert.rejects(()=>trialWorkspace(f.out,{release,before:first.nextCursor!}),rejects(400));
  assert.equal((await trialWorkspace(f.o,{release:'b'.repeat(40)})).trials.length,0);
  await db.evidence.update({where:{id:baseline.id},data:{reviewVersion:{increment:1}}});
  record=(await trialWorkspace(f.o,{release,before:first.nextCursor!})).trials[0];assert.equal(record.accepted,false);
 }finally{await f.cleanup();}
});
test('guide use counts unique reader-days and routes a failed connection to its assigned accountable owner',async()=>{
 const f=await assuranceFixture();try{
  const guide='connections',read={action:'OPEN',guide};await changeHelp(f.st,read);await changeHelp(f.st,read);
  await assert.rejects(()=>changeHelp(f.st,{action:'ASSIGN',guide,ownerId:f.ed.userId,reviewDate:future()}),rejects(403));
  await changeHelp(f.o,{action:'ASSIGN',guide,ownerId:f.ed.userId,reviewDate:future()});const data=await helpMaintenance(f.o);
  assert.equal(data.guides[0].id,guide);assert.equal(data.guides[0].readerDays,1);assert.equal(data.guides[0].owner?.id,f.ed.userId);
  const issue={action:'ESCALATE',guide,issue:'FAILED_CONNECTION',requestKey:randomUUID()},a=await changeHelp(f.st,issue),b=await changeHelp(f.st,issue);
  assert.equal(a.taskId,b.taskId);assert.equal((await db.obligation.findUniqueOrThrow({where:{id:a.taskId!}})).assigneeId,f.ed.userId);
 }finally{await f.cleanup();}
});
test('group reporting requires current access to every named entity and does not value a missing site at zero',async()=>{
 const f=await assuranceFixture();try{
  const selection={entities:[{id:f.a.id,annualTreatmentCostGbp:0},{id:f.b.id,annualTreatmentCostGbp:null}],scopeComplete:true,missingSites:['Unreported depot']};
  await assert.rejects(()=>groupRiskReport(f.o,{selection}),rejects(403));
  await db.membership.create({data:{organizationId:f.b.id,userId:f.o.userId,role:'ADMIN'}});
  const report=await groupRiskReport(f.o,{selection});assert.equal(report.rows.length,2);assert.equal(report.baseline,null);assert.equal(report.afterTreatmentAndCost,null);assert.equal(report.complete,false);assert.ok(report.rows.every(e=>e.exceptions.length));
  assert.ok((await groupRiskReport(f.o,{selection,approveHash:report.digest})).reviewedByYouAt);
  await assert.rejects(()=>groupRiskReport(f.o,{selection:{...selection,missingSites:[]},approveHash:report.digest}),rejects(409));
 }finally{await f.cleanup();}
});

test('verified tenant invoice costs distinguish allocations, incomplete coverage and current evidence',async()=>{
 const {changeCosts,tenantCosts,costKinds}=await import('../lib/server/tenant-costs');
 const f=await assuranceFixture();try{
  const file=await f.file(),month=new Date().toISOString().slice(0,7);
  const submit=(lines:{kind:string;pence:number;basis:string;evidenceId:string}[])=>({action:'SUBMIT',report:{month,lines,requestKey:randomUUID(),notes:'These fictional invoices and allocation records relate to this workspace.'}});
  const lines=costKinds.map((kind,i)=>({kind,pence:100*i,basis:i===3?'ALLOCATED':'INVOICED',evidenceId:file.id}));
  await changeCosts(f.o,submit(lines.slice(0,3)),f.store);let statement=(await tenantCosts(f.o,month)).statement!;
  await assert.rejects(()=>changeCosts(f.o,{action:'REVIEW',month,id:statement.id,confirm:true},f.store),rejects(403));
  await changeCosts(f.ad,{action:'REVIEW',month,id:statement.id,confirm:true},f.store);
  assert.equal((await tenantCosts(f.o,month)).statement!.totalPence,null);
  await changeCosts(f.o,submit(lines),f.store);statement=(await tenantCosts(f.o,month)).statement!;
  await changeCosts(f.ad,{action:'REVIEW',month,id:statement.id,confirm:true},f.store);
  assert.equal((await tenantCosts(f.o,month)).statement!.totalPence,600);
  assert.equal((await tenantCosts(f.out,month)).statement,null);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});assert.equal((await tenantCosts(f.o,month)).statement!.totalPence,null);
 }finally{await f.cleanup();}
});

test('a first-time operator logs help and task completion on the server clock before independent assessment',async()=>{
 const f=await assuranceFixture();
 try{
  const plan={action:'START',requestKey:randomUUID(),release:'b'.repeat(40),environment:'PARTNER_SANDBOX',ukExternal:false,track:'operator_pilot',steps:['connect-first'],intendedUse:'Observe first-time setup on an approved sandbox connection.'};
  await assert.rejects(recordTrial(f.ed,plan),rejects(400));
  const {id}=await recordTrial(f.ed,{...plan,firstTime:true});
  const mark={action:'CHECKPOINT',key:randomUUID(),id,step:'connect-first',kind:'HELP',note:'Needed help finding the read-only scope.'};
  await assert.rejects(recordTrial(f.ad,mark),rejects(403));
  await recordTrial(f.ed,mark);await recordTrial(f.ed,mark);
  await recordTrial(f.ed,{...mark,key:randomUUID(),kind:'COMPLETED',note:'Found the first verified receipt.'});
  await recordTrial(f.ed,{action:'STOP',id});
  await assert.rejects(recordTrial(f.ed,{...mark,key:randomUUID()}),rejects(409));
  const view=(await trialWorkspace(f.o)).trials.find(t=>t.id===id)!;
  assert.equal(view.checkpoints.length,2);assert.ok(view.checkpoints[1].elapsedSeconds>=view.checkpoints[0].elapsedSeconds);
  const evidence=await f.file(),r={step:'connect-first',outcome:'PASS',notes:'Completed with one recorded intervention.',evidenceId:evidence.id,unsupported:0,edits:0,assisted:false};
  await assert.rejects(recordTrial(f.ed,{action:'FINISH',id,results:[r]},f.store),rejects(409));
  await recordTrial(f.ed,{action:'FINISH',id,results:[{...r,assisted:true}]},f.store);
  await recordTrial(f.ad,{action:'REVIEW',id,decision:'ACCEPT',notes:'Reviewed this fictional setup result and its recorded help.'},f.store);
  assert.equal((await trialWorkspace(f.ed)).trials.find(t=>t.id===id)?.accepted,true);
 }finally{await f.cleanup();}
});

test('a site decision binds the live build, the named configuration, reviewed tests and signatory authority',async()=>{
 const f=await assuranceFixture(),priorRelease=process.env.VERCEL_GIT_COMMIT_SHA,release='e'.repeat(40);
 process.env.VERCEL_GIT_COMMIT_SHA=release;
 try{
  const plan={action:'START',requestKey:randomUUID(),track:'site_qualification',steps:['stock-count'],release,
   intendedUse:'Reconcile a controlled stock balance for the approved test location.',environment:'PROTECTED_PILOT',ukExternal:true,
   siteProtocol:{operator:'Fictional distributor',site:'Fixture warehouse A',licence:'TEST-WDA-001',configuration:'Stock SOP revision 3',
    criteria:[{step:'stock-count',expected:'A reviewer can retrieve the discrepancy, physical count, and attributed recount.'}]}};
  await assert.rejects(()=>recordTrial(f.ed,{...plan,release:'0'.repeat(40)}),rejects(409));
  await assert.rejects(()=>recordTrial(f.ed,{...plan,steps:['site-access']}),rejects(400));
  const template=protocolTemplate.parse({format:'regpilot-site-protocol-v1',intendedUse:plan.intendedUse,criteria:plan.siteProtocol.criteria});
  assert.equal(protocolTemplate.safeParse({...template,decisions:['APPROVE']}).success,false);
  assert.equal(protocolTemplate.safeParse({...template,criteria:[...template.criteria,...template.criteria]}).success,false);
  const {id}=await recordTrial(f.ed,plan);
  const proof=await f.file(),decision=await f.file(),delegation=await f.file(),withdrawal=await f.file();
  let pack=await siteQualification(f.o,id);
  assert.equal(pack.status,'AWAITING_DECISION');assert.deepEqual(pack.protocol.criteria,template.criteria);
  await assert.rejects(()=>siteQualification(f.out,id),rejects(404));
  await assert.rejects(()=>siteQualification(f.ed,id),rejects(403));
  const oldHash=pack.basisHash;
  await recordTrial(f.ed,{action:'FINISH',id,results:[{step:'stock-count',notes:'The exact original count and attributed recount were retrieved.',evidenceId:proof.id,outcome:'PASS',unsupported:0,edits:0,assisted:false}]},f.store);
  const input={requestKey:randomUUID(),decision:'APPROVE',signatory:'Fictional quality lead',role:'Responsible Person',
   rationale:'Confirmed the expected result and restricted the decision to the identified configuration.',
   decisionFile:decision.id,authorityFile:delegation.id,confirmed:true};
  pack=await siteQualification(f.o,id);
  await assert.rejects(()=>recordSiteDecision(f.o,id,{...input,basisHash:pack.basisHash},f.store),rejects(409));
  await recordTrial(f.ad,{action:'REVIEW',id,decision:'ACCEPT',notes:'Verified the source count and signed recount against the acceptance criterion.'},f.store);
  pack=await siteQualification(f.o,id);const signed={...input,basisHash:pack.basisHash};
  assert.notEqual(pack.reviews[0].id,id);assert.equal(pack.reviews[0].actor,f.ad.userId);
  assert.equal(pack.currentRelease,release);assert.equal(pack.finishRelease,release);assert.deepEqual(pack.blockers,[]);
  await assert.rejects(()=>recordSiteDecision(f.o,id,{...signed,basisHash:oldHash},f.store),rejects(409));
  await assert.rejects(()=>recordSiteDecision(f.o,id,{...signed,decisionFile:proof.id},f.store),rejects(409));
  const stored=await db.evidence.findUniqueOrThrow({where:{id:proof.id}}),bytes=await f.store.get(stored.storageKey);
  await f.store.put(stored.storageKey,new Uint8Array([77]));
  await assert.rejects(()=>recordSiteDecision(f.o,id,signed,f.store),rejects(409));await f.store.put(stored.storageKey,bytes);
  const receipts=await Promise.all([recordSiteDecision(f.o,id,signed,f.store),recordSiteDecision(f.o,id,signed,f.store)]);
  assert.deepEqual(receipts[0],receipts[1]);
  pack=await siteQualification(f.o,id);assert.equal(pack.status,'APPROVED_FOR_SITE_USE');
  assert.equal(pack.decisions.length,1);assert.equal(pack.decisions[0].basisHash,pack.basisHash);assert.equal(pack.testFiles[0].id,proof.id);
  process.env.VERCEL_GIT_COMMIT_SHA='f'.repeat(40);assert.equal((await siteQualification(f.o,id)).status,'REASSESSMENT_REQUIRED');
  process.env.VERCEL_GIT_COMMIT_SHA=release;
  await db.evidence.update({where:{id:decision.id},data:{reviewVersion:{increment:1}}});
  assert.equal((await siteQualification(f.o,id)).status,'REASSESSMENT_REQUIRED');
  await recordSiteDecision(f.o,id,{...signed,requestKey:randomUUID(),decision:'WITHDRAW',decisionFile:withdrawal.id},f.store);
  pack=await siteQualification(f.o,id);assert.equal(pack.status,'WITHDRAWN');assert.deepEqual(pack.decisions.map(d=>d.input.decision),['APPROVE','WITHDRAW']);
  await assert.rejects(()=>recordSiteDecision(f.o,id,{...signed,requestKey:randomUUID()},f.store),rejects(409));
  const {id:sandbox}=await recordTrial(f.o,{...plan,requestKey:randomUUID(),environment:'PARTNER_SANDBOX'});
  await recordTrial(f.o,{action:'FINISH',id:sandbox,results:[{step:'stock-count',notes:'No site count was available during the test.',evidenceId:null,outcome:'UNOBSERVED',unsupported:0,edits:0,assisted:false}]},f.store);
  await recordTrial(f.ad,{action:'REVIEW',id:sandbox,decision:'ACCEPT',notes:'The reported missing input accurately describes this trial.'},f.store);
  const incomplete=await siteQualification(f.o,sandbox);
  assert.ok(incomplete.blockers.some(s=>s.includes('protected customer')));assert.ok(incomplete.blockers.some(s=>s.includes('passing observation')));
  const hold={...input,requestKey:randomUUID(),decision:'WITHHOLD',basisHash:incomplete.basisHash,decisionFile:withdrawal.id};
  await assert.rejects(()=>recordSiteDecision(f.o,sandbox,hold,f.store),rejects(403));
  await assert.rejects(()=>recordSiteDecision(f.ad,sandbox,{...hold,decision:'APPROVE'},f.store),rejects(409));
  await recordSiteDecision(f.ad,sandbox,hold,f.store);assert.equal((await siteQualification(f.ad,sandbox)).status,'WITHHELD');
 }finally{
  if(priorRelease===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;else process.env.VERCEL_GIT_COMMIT_SHA=priorRelease;
  await f.cleanup();
 }
});

test('an internal first-time excursion trial requires the participant’s own case action and accounts for corrections and help',async()=>{
 const f=await assuranceFixture();try{
  const {createQualityCase,investigateQualityCase}=await import('../lib/server/capa-service');
  const text='Fictional excursion with a confirmed packing delay. Hold affected test lots, retain the temperature record and review the investigation findings.';
  const saved=await createQualityCase(f.ed,{requestKey:randomUUID(),kind:'DEVIATION',classification:'MAJOR',title:'Exercise case',description:text,
   impact:text,containment:text,occurredAt:new Date().toISOString().slice(0,10),ownerId:f.ed.userId});
  const plan={action:'START',track:'excursion_operator',firstTime:true,steps:['investigate-stock'],caseId:saved.caseId,
   release:'e'.repeat(40),environment:'FIXTURE',ukExternal:false,intendedUse:'Timed fictional stock excursion investigation.',requestKey:randomUUID()};
  await assert.rejects(()=>recordTrial(f.out,plan),rejects(404));
  const {id}=await recordTrial(f.ed,plan);assert.equal((await recordTrial(f.ed,plan)).id,id);
  await assert.rejects(()=>recordTrial(f.ed,{...plan,requestKey:randomUUID()}),rejects(409));
  const checkpoint=(kind:string)=>recordTrial(f.ed,{action:'CHECKPOINT',id,key:randomUUID(),step:'investigate-stock',kind,note:'An internal test checkpoint.'});
  await checkpoint('HELP');await checkpoint('CORRECTION');await checkpoint('COMPLETED');
  const inv={requestKey:randomUUID(),version:1,ownerId:f.ed.userId,investigationNotes:text,rootCause:text,effectivenessCriteria:text,effectivenessDueAt:future(),containment:text};
  await investigateQualityCase(f.ad,saved.caseId,inv);
  const result={step:'investigate-stock',outcome:'PASS',notes:'Checked the exact fixture case.',evidenceId:null,unsupported:0,edits:1,assisted:true};
  const finish={action:'FINISH',id,results:[result]};await assert.rejects(()=>recordTrial(f.ed,finish,f.store),rejects(409));
  await investigateQualityCase(f.ed,saved.caseId,{...inv,version:2,requestKey:randomUUID()});await recordTrial(f.ed,{action:'STOP',id});
  await assert.rejects(()=>recordTrial(f.ed,{...finish,results:[{...result,edits:0}]},f.store),rejects(409));
  await assert.rejects(()=>recordTrial(f.ed,{...finish,results:[{...result,assisted:false}]},f.store),rejects(409));
  await recordTrial(f.ed,finish,f.store);const trial=(await trialWorkspace(f.o)).trials.find(t=>t.id===id)!;
  assert.equal(trial.caseId,saved.caseId);assert.equal(trial.caseReceipts.length,1);assert.equal(trial.results[0].assisted,true);
  assert.equal((await db.auditEvent.findUniqueOrThrow({where:{id:trial.caseReceipts[0].id}})).actorId,f.ed.userId);
 }finally{await f.cleanup();}
});
