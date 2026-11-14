import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/server/db';
import {claimWorker,runPrivateWorker,workerHealth} from '../lib/server/worker-runtime';
import {executeScheduledTick} from '../lib/cron-tick.mjs';

test('durable worker rejects overlaps, replays safely, recovers expired runs and reports failures without secrets',async()=>{
 const saved={...process.env},prefix=String(Date.now());
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_WORKER_ENABLED:'true'});
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
