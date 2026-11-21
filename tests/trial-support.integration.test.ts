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
