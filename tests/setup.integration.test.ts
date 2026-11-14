import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {getSetupWorkspace,saveSetupWorkspace} from '../lib/server/setup-service';
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
