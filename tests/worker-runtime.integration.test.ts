import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/server/db';
import {claimWorker,runPrivateWorker,workerHealth,workerSlotCount} from '../lib/server/worker-runtime';
import {executeScheduledTick} from '../lib/cron-tick.mjs';
import {runMonitoringBatch} from '../lib/server/monitoring-service';
import {runConnectorBatch} from '../lib/server/connector-service';
import {runReviewBatch} from '../lib/server/control-service';

test('durable worker rejects overlaps, replays safely, recovers expired runs and reports failures without secrets',async()=>{
 const saved={...process.env},prefix=String(Date.now());
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_WORKER_ENABLED:'true',REGPILOT_WORKER_SLOTS:'1'});
 const key=(n:number)=>'github:'+prefix+':'+n;
 try{
  const claims=await Promise.all([claimWorker(key(1)),claimWorker(key(2))]);
  assert.equal(claims.filter(c=>c.kind==='claimed').length,1);assert.equal(claims.filter(c=>c.kind==='busy').length,1);
  const active=claims.find(c=>c.kind==='claimed')!.run;
  assert.equal((await claimWorker(active.invocationKey)).kind,'reused');
  await db.workerRun.update({where:{id:active.id},data:{leaseUntil:new Date(Date.now()-1)}});
  let calls=0;
  const good=async()=>{calls++;return executeScheduledTick({sources:async()=>({processed:0})});};
  const result=await runPrivateWorker(key(3),good);assert.equal(result.status,200);assert.equal(calls,1);
  assert.equal((await db.workerRun.findUniqueOrThrow({where:{id:active.id}})).state,'INTERRUPTED');
  assert.equal((await runPrivateWorker(key(3),good)).status,200);assert.equal(calls,1,'replay must not execute work again');
  assert.equal((await workerHealth()).state,'completed');
  const failed=await runPrivateWorker(key(4),async()=>{throw Error('credential-secret-must-not-escape')});assert.equal(failed.status,503);
  assert.equal((await workerHealth()).state,'failed');
  assert.doesNotMatch(JSON.stringify(await db.workerRun.findMany({where:{invocationKey:{startsWith:'github:'+prefix+':'}}})),/credential-secret/);
  assert.equal((await runPrivateWorker(key(4),good)).status,503);assert.equal(calls,1);
  const expired=await runPrivateWorker(key(6),async()=>{
   await db.workerRun.update({where:{invocationKey:key(6)},data:{leaseUntil:new Date(Date.now()-1)}});
   return executeScheduledTick({});
  });assert.equal(expired.status,503);assert.equal((await workerHealth()).state,'interrupted');
  await db.workerRun.updateMany({where:{invocationKey:{startsWith:'github:'+prefix+':'}},data:{startedAt:new Date(Date.now()-91*60000)}});
  assert.equal((await workerHealth()).state,'stale');
  process.env.REGPILOT_WORKER_ENABLED='false';assert.equal((await runPrivateWorker(key(5),good)).status,503);assert.equal((await workerHealth()).state,'disabled');
 }finally{
  await db.workerRun.deleteMany({where:{invocationKey:{startsWith:'github:'+prefix+':'}}});
  for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
 }
});

test('parallel worker capacity is bounded, replay-safe, independently monitored and drained before scale-down',async()=>{
 const saved={...process.env},prefix=String(Date.now()),key=(n:number)=>'github:'+prefix+':'+n;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_WORKER_ENABLED:'true',REGPILOT_WORKER_SLOTS:'3'});
 let release!:()=>void,allEntered!:()=>void,calls=0;
 const barrier=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{allEntered=r;});
 const execute=async()=>{if(++calls===3)allEntered();await barrier;return executeScheduledTick({});};
 let runs:Promise<unknown>[]=[];
 try{
  runs=[0,1,2].map(slot=>runPrivateWorker(key(1),execute,slot));
  // A bounded barrier proves overlapping execution without an arbitrary sleep.
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('workers did not execute concurrently')),10000);})]);}finally{clearTimeout(timer);}
  assert.equal(await db.workerRun.count({where:{state:'RUNNING',invocationKey:{startsWith:'github:'+prefix+':'}}}),3);
  assert.equal((await runPrivateWorker(key(1),execute,1)).status,409,'active replay does not execute twice');
  assert.equal((await runPrivateWorker(key(2),execute,1)).status,409,'a busy slot rejects a different invocation');
  await assert.rejects(()=>claimWorker(key(2),3));
  assert.equal((await workerHealth()).state,'running');
  release();assert.ok((await Promise.all(runs)).every((r:any)=>r.status===200));
  for(const slot of [0,1,2])assert.equal((await runPrivateWorker(key(1),execute,slot)).status,200);
  assert.equal(calls,3,'completed replay does not call providers');
  assert.equal((await workerHealth()).ok,true);
  process.env.REGPILOT_MONITORING_ENABLED='false';process.env.REGPILOT_CONNECTORS_ENABLED='false';
  const secondary=await runPrivateWorker(key(7),undefined,1);
  assert.equal(secondary.status,200);
  assert.ok('modules' in secondary.body);assert.equal(secondary.body.modules.controlReviews.state,'disabled','secondary slots never duplicate recurring review generation');
  const failedSlot=(await claimWorker(key(3),2)).run;
  await db.workerRun.update({where:{id:failedSlot.id},data:{leaseUntil:new Date(0)}});
  assert.equal((await workerHealth()).state,'interrupted','success in another slot cannot hide an interrupted slot');
  const good=()=>executeScheduledTick({});
  assert.equal((await runPrivateWorker(key(4),good,2)).status,200);
  assert.equal((await db.workerRun.findUniqueOrThrow({where:{id:failedSlot.id}})).state,'INTERRUPTED');
  process.env.REGPILOT_WORKER_SLOTS='4';
  const health=await workerHealth();assert.equal(health.ok,false);assert.equal(health.state,'stale');assert.equal(health.slots?.[3].state,'stale','new capacity requires its own heartbeat');
  process.env.REGPILOT_WORKER_SLOTS='3';
  const draining=(await claimWorker(key(5),2)).run;
  process.env.REGPILOT_WORKER_SLOTS='1';
  assert.equal((await claimWorker(key(6),0)).kind,'busy','retired slots drain before smaller capacity starts');
  await db.workerRun.update({where:{id:draining.id},data:{state:'COMPLETED',finishedAt:new Date()}});
  assert.equal((await runPrivateWorker(key(6),good)).status,200);
  for(const value of ['0','9','2.5','NaN','1000','']){process.env.REGPILOT_WORKER_SLOTS=value;assert.throws(workerSlotCount);}
 }finally{
  release();await Promise.allSettled(runs);
  await db.workerRun.deleteMany({where:{invocationKey:{startsWith:'github:'+prefix+':'}}});
  for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
 }
});

test('expired admission budget leaves provider queues unclaimed and reports deferred work',async()=>{
 const saved={...process.env};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_MONITORING_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ab'.repeat(32)});
 try{
  const deadline=Date.now()-1;
  const result=await executeScheduledTick({sources:()=>runMonitoringBatch(12,3,deadline),connectors:()=>runConnectorBatch(4,2,deadline),controlReviews:()=>runReviewBatch(deadline)});
  assert.equal(result.ok,true);
  for(const part of Object.values(result.modules)){assert.equal(part.processed,0);assert.equal(part.state,'backlog');}
  await assert.rejects(()=>runMonitoringBatch(12,3,NaN));
  await assert.rejects(()=>runConnectorBatch(4,2,Infinity));
  await assert.rejects(()=>runReviewBatch(NaN));
 }finally{
  for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
 }
});
