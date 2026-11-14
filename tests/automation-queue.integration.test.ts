import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {saveConnector,claimConnector,executeConnector} from '../lib/server/connector-service';
import {enqueueConnectorEvent,claimAutomationEvent,executeAutomationEvent,automationHealth,replayAutomationEvent,pruneAutomationEvents,runAutomationBatch} from '../lib/server/automation-queue';
import {hashValue} from '../lib/regulatory/intelligence';
import type {Observation} from '../lib/connectors/observation';
async function fixture(){
 const x=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ab'.repeat(32),SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
 const programme=await db.programmeImport.create({data:{organizationId:x.a.id,createdById:x.o.userId,inputHash:randomUUID(),method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
 const control=await db.managedControl.create({data:{organizationId:x.a.id,importId:programme.id,proposalKey:'outbox',title:'Fictional outbox control',description:'Fixture',testProcedure:'Fixture',theme:'security',ownerId:x.ed.userId,scheduledById:x.o.userId,intervalDays:30,nextReviewAt:new Date()}});
 const config={provider:'GITHUB',repository:'fictional/outbox',branch:'main',controlId:control.id,version:0,token:'github_pat_'+ 'x'.repeat(32),enabled:true,intervalHours:24};
 const saved=await saveConnector(x.o,config);
 const observation:Observation={engine:'fixture-1',sourceUrl:'https://github.com/fictional/outbox',capturedAt:new Date().toISOString(),checks:[{id:'protection',label:'Fictional protection',status:'FAIL',observed:'Missing',nextStep:'Investigate'}],limitations:['Fictional fixture, no provider calls.']};
 let loads=0;
 async function collect(){await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});const job=await claimConnector();assert.ok(job);assert.equal(await executeConnector(job,async()=>{loads++;return observation;},{deferAutomation:true}),'FOLLOW_UP');return job;}
 async function event(){return db.automationEvent.findFirstOrThrow({where:{connectorId:saved.id},orderBy:{createdAt:'desc'}});}
 async function claim(){const row=await event();await db.automationEvent.update({where:{id:row.id},data:{availableAt:new Date(0)}});const job=await claimAutomationEvent({id:row.id,organizationId:x.a.id});assert.ok(job);return job;}
 return {...x,config,saved,observation,collect,event,claim,loads:()=>loads};
}
test('evidence survives downstream failure; task effects and acknowledgement roll back together, then recover once',async()=>{
 const f=await fixture();
 try{
  await f.collect();assert.equal(await db.connectorRun.count({where:{connectorId:f.saved.id}}),1);
  assert.equal((await f.event()).state,'PENDING');assert.equal(await db.providerPermit.count(),0,'provider capacity is released before downstream automation');
  const job=await f.claim();
  assert.equal(await executeAutomationEvent(job,async tx=>{
   await tx.obligation.create({data:{organizationId:f.a.id,connectorId:f.saved.id,title:'Must roll back',category:'Fixture',ownerName:'Fixture',dueDate:new Date()}});
   throw Error('private provider credential must not persist');
  }),'RETRY_SCHEDULED');
  assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),0);
  assert.equal(await db.connectorRun.count({where:{connectorId:f.saved.id}}),1);
  const connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:f.saved.id}});assert.ok(connector.lastSuccessAt);assert.equal(connector.failureCode,null);
  assert.doesNotMatch(JSON.stringify(await f.event()),/private provider/);
  const retry=await f.claim();assert.equal(await executeAutomationEvent(retry),'DONE');assert.equal(f.loads(),1);
  assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),1);
  assert.equal(await executeAutomationEvent(retry),'SUPERSEDED');assert.equal(await executeAutomationEvent(job),'SUPERSEDED');
  assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),1);
  assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,action:'automation.done'}}),1);
 }finally{await f.cleanup();}
});
test('observation and outbox insertion are atomic and collection replay cannot create duplicate events',async()=>{
 const f=await fixture();
 try{
  const connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:f.saved.id}}),job={...connector,leaseToken:randomUUID()};
  await assert.rejects(()=>db.$transaction(async tx=>{
   const run=await tx.connectorRun.create({data:{organizationId:f.a.id,connectorId:f.saved.id,leaseToken:job.leaseToken,configVersion:job.version,result:f.observation,resultHash:hashValue(f.observation),signalHash:hashValue(f.observation.checks),outcome:'FOLLOW_UP'}});
   await enqueueConnectorEvent(tx,job,{kind:'CONNECTOR_OBSERVED',runId:run.id,fingerprint:run.signalHash});throw Error('Simulated rollback');
  }));
  assert.equal(await db.connectorRun.count({where:{connectorId:f.saved.id}}),0);assert.equal(await db.automationEvent.count({where:{connectorId:f.saved.id}}),0);
  const collected=await f.collect(),before=await f.event();
  await db.$transaction(tx=>enqueueConnectorEvent(tx,collected,{kind:'CONNECTOR_OBSERVED',runId:before.runId!,fingerprint:before.fingerprint}));
  assert.equal(await db.automationEvent.count({where:{connectorId:f.saved.id}}),1);
 }finally{await f.cleanup();}
});
test('expired worker claims recover with a new token and old workers cannot acknowledge or release replacements',async()=>{
 const f=await fixture();
 try{
  await f.collect();const old=await f.claim();
  await db.automationEvent.update({where:{id:old.id},data:{leaseUntil:new Date(0)}});
  await db.dispatchLane.updateMany({where:{organizationId:f.a.id,kind:'AUTOMATION'},data:{leaseUntil:new Date(0)}});
  const replacement=await f.claim();assert.notEqual(replacement.leaseToken,old.leaseToken);
  let invoked=false;assert.equal(await executeAutomationEvent(old,async()=>{invoked=true;return 'DONE';}),'SUPERSEDED');assert.equal(invoked,false);
  assert.equal((await db.dispatchLane.findUniqueOrThrow({where:{organizationId_kind:{organizationId:f.a.id,kind:'AUTOMATION'}}})).leaseToken,replacement.leaseToken);
  assert.equal(await executeAutomationEvent(replacement),'DONE');assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),1);
 }finally{await f.cleanup();}
});
test('five failures enter a visible dead-letter state; only an administrator can request a versioned audited replay',async()=>{
 const f=await fixture();
 try{
  await f.collect();
  for(let i=1;i<=5;i++)assert.equal(await executeAutomationEvent(await f.claim(),async()=>{throw Error('Private fault');}),i===5?'DEAD':'RETRY_SCHEDULED');
  const dead=await f.event();assert.equal(dead.attempts,5);
  const health=await automationHealth(f.o);assert.equal(health.counts.DEAD,1);assert.equal(health.deadLetters[0].id,dead.id);
  assert.doesNotMatch(JSON.stringify(health),/encryptedSecret|fingerprint|Private fault|leaseToken/);
  assert.equal((await automationHealth(f.out)).deadLetters.length,0);
  await assert.rejects(()=>replayAutomationEvent(f.st,dead.id,dead.version),rejects(403));
  await assert.rejects(()=>replayAutomationEvent(f.out,dead.id,dead.version),rejects(409));
  await assert.rejects(()=>replayAutomationEvent(f.o,dead.id,dead.version-1),rejects(409));
  await replayAutomationEvent(f.o,dead.id,dead.version);await assert.rejects(()=>replayAutomationEvent(f.o,dead.id,dead.version),rejects(409));
  assert.equal(await executeAutomationEvent(await f.claim()),'DONE');assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),1);
  assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,action:'automation.replay_requested'}}),1);
 }finally{await f.cleanup();}
});
test('configuration changes and revoked membership cancel queued effects; corrupted evidence is quarantined',async()=>{
 const f=await fixture();
 try{
  await f.collect();const initial=await f.event();
  await saveConnector(f.o,{...f.config,id:f.saved.id,version:initial.configVersion,token:'github_pat_'+'y'.repeat(32)});
  assert.equal(await executeAutomationEvent(await f.claim()),'CANCELLED');
  await f.collect();const corrupt=await f.event();await db.connectorRun.update({where:{id:corrupt.runId!},data:{result:{corrupted:true}}});
  assert.equal(await executeAutomationEvent(await f.claim()),'DEAD');assert.equal((await f.event()).lastErrorCode,'INPUT_INTEGRITY_FAILED');
  await f.collect();await db.membership.update({where:{organizationId_userId:{organizationId:f.a.id,userId:f.o.userId}},data:{role:'VIEWER'}});
  assert.equal(await executeAutomationEvent(await f.claim()),'CANCELLED');assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),0);
 }finally{await f.cleanup();}
});
test('retention preserves pending and dead events; a bounded batch exposes unresolved backlog',async()=>{
 const f=await fixture();
 try{
  await f.collect();const first=await f.event();const old=new Date(Date.now()-31*86400000);
  await db.automationEvent.update({where:{id:first.id},data:{state:'DEAD',finishedAt:old}});
  const second=await f.collect();const pending=await f.event();
  await db.automationEvent.update({where:{id:pending.id},data:{availableAt:new Date(Date.now()+60000),createdAt:old}});
  await db.automationEvent.create({data:{organizationId:f.a.id,connectorId:f.saved.id,eventKey:hashValue(randomUUID()),kind:'CONNECTOR_FAILED',configVersion:second.version,fingerprint:hashValue('fixture'),state:'DONE',finishedAt:old}});
  assert.equal(await pruneAutomationEvents(),1);assert.equal(await db.automationEvent.count({where:{connectorId:f.saved.id}}),2);
  const batch=await runAutomationBatch(1,1);assert.equal(batch.processed,0);assert.equal(batch.attention,1);assert.equal(batch.limitReached,true);
 }finally{await f.cleanup();}
});
test('a disabled provider preserves queued events until reactivation instead of discarding them',async()=>{
 const f=await fixture();
 try{
  await f.collect();const event=await f.event();
  // Dispatch-only fixture: no provider requests or credential use.
  await db.evidenceConnector.update({where:{id:f.saved.id},data:{provider:'MICROSOFT365'}});
  process.env.REGPILOT_MICROSOFT365_ENABLED='false';
  assert.equal(await claimAutomationEvent({id:event.id,organizationId:f.a.id}),null);
  assert.equal((await f.event()).state,'PENDING');assert.equal((await f.event()).attempts,0);
  process.env.REGPILOT_MICROSOFT365_ENABLED='true';
  const claimed=await claimAutomationEvent({id:event.id,organizationId:f.a.id});assert.ok(claimed);assert.equal(claimed.id,event.id);
  process.env.REGPILOT_MICROSOFT365_ENABLED='false';
  assert.equal(await executeAutomationEvent(claimed),'RETRY_SCHEDULED');
  assert.equal((await f.event()).state,'PENDING');assert.equal((await f.event()).attempts,0);
  assert.equal(await db.obligation.count({where:{connectorId:f.saved.id}}),0);
 }finally{await f.cleanup();}
});
