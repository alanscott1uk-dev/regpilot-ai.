import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assuranceFixture,future,rejects} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
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
