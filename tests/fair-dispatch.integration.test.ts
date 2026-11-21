import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {WatchSchedule} from '@prisma/client';
import {db} from '../lib/server/db';
import {claimFairWatch,claimFairConnector,claimManualConnectorLane,releaseDispatchLease} from '../lib/server/fair-dispatch';

async function fixture(count:number){
 const marker=randomUUID(),user=await db.user.create({data:{externalId:marker,email:marker+'@example.invalid'}});
 const ids=Array.from({length:count},()=>randomUUID());
 await db.organization.createMany({data:ids.map(id=>({id,name:'Synthetic dispatch '+id}))});
 return {user,ids,async cleanup(){
  const where={organizationId:{in:ids}};
  await db.evidenceConnector.deleteMany({where});
  await db.managedControl.deleteMany({where});
  await db.programmeImport.deleteMany({where});
  await db.watchSchedule.deleteMany({where});
  await db.organization.deleteMany({where:{id:{in:ids}}});
  await db.user.delete({where:{id:user.id}});
 }};
}
async function complete(jobs:WatchSchedule[]){
 // Simulate the durable completion before releasing the tenant slots.
 await db.watchSchedule.updateMany({where:{id:{in:jobs.map(j=>j.id)}},data:{nextCheckAt:new Date(Date.now()+86400000),leaseToken:null,leaseUntil:null}});
 await Promise.all(jobs.map(j=>releaseDispatchLease('SOURCE',j)));
}

test('50,000 queued jobs: concurrent dispatch has no duplicate claims and serves every tenant each round',async t=>{
 const f=await fixture(250),latency:number[]=[],seen=new Set<string>();
 try{
  const records=f.ids.flatMap((organizationId,i)=>Array.from({length:200},(_,n)=>({organizationId,configuredById:f.user.id,sourceId:'synthetic-'+n,enabled:true,nextCheckAt:new Date(1000*i)})));
  for(let i=0;i<records.length;i+=1000)await db.watchSchedule.createMany({data:records.slice(i,i+1000)});
  assert.equal(await db.dispatchLane.count({where:{organizationId:{in:f.ids},kind:'SOURCE'}}),250,'insert triggers provision all lanes');
  for(let round=0;round<10;round++){
   const served=new Set<string>();
   while(served.size<250){
    const claims=await Promise.all(Array.from({length:Math.min(16,250-served.size)},async()=>{
     const start=performance.now(),job=await claimFairWatch();latency.push(performance.now()-start);assert.ok(job);return job;
    }));
    for(const job of claims){
     assert.equal(seen.has(job.id),false,'a completed job is not claimed twice');seen.add(job.id);
     assert.equal(served.has(job.organizationId),false,'no second tenant turn before all eligible tenants are served');served.add(job.organizationId);
    }
    const active=await db.watchSchedule.groupBy({by:['organizationId'],where:{organizationId:{in:f.ids},leaseUntil:{gt:new Date()}},_count:{id:true}});
    assert.ok(active.every(row=>row._count.id===1),'one active source job per tenant');
    await complete(claims);
   }
  }
  assert.equal(seen.size,2500);
  assert.equal(await db.watchSchedule.count({where:{organizationId:{in:f.ids},nextCheckAt:{lte:new Date()}}}),47500,'unclaimed backlog is preserved');
  latency.sort((a,b)=>a-b);
  const metrics={queuedJobs:50000,tenants:250,concurrency:16,claims:2500,p50Ms:Math.round(latency[Math.floor(latency.length*.5)]),p95Ms:Math.round(latency[Math.floor(latency.length*.95)]),maxMs:Math.round(latency.at(-1)!)};
  t.diagnostic('dispatch benchmark '+JSON.stringify(metrics));
  assert.ok(metrics.p95Ms<2000,'CI regression budget: p95 claim latency under 2s');
 }finally{await f.cleanup();}
});

test('a tenant with a large old backlog cannot starve a small tenant; busy and expired slots are fenced',async()=>{
 const f=await fixture(2);
 try{
  await db.watchSchedule.createMany({data:[...Array.from({length:1000},(_,n)=>({organizationId:f.ids[0],configuredById:f.user.id,sourceId:'bulk-'+n,enabled:true,nextCheckAt:new Date(0)})),{organizationId:f.ids[1],configuredById:f.user.id,sourceId:'small',enabled:true,nextCheckAt:new Date(1)}]});
  const jobs=(await Promise.all(Array.from({length:16},()=>claimFairWatch()))).filter((j):j is WatchSchedule=>j!==null);
  assert.equal(jobs.length,2);assert.equal(new Set(jobs.map(j=>j.organizationId)).size,2);
  assert.equal(await claimFairWatch(),null,'busy tenants cannot acquire additional slots');
  const old=jobs.find(j=>j.organizationId===f.ids[0])!;
  // A crashed worker has neither completed nor released; both leases expire.
  await db.watchSchedule.update({where:{id:old.id},data:{leaseUntil:new Date(0)}});
  await db.dispatchLane.updateMany({where:{organizationId:old.organizationId,kind:'SOURCE'},data:{leaseUntil:new Date(0)}});
  const recovered=await claimFairWatch();assert.ok(recovered);assert.equal(recovered.id,old.id);assert.notEqual(recovered.leaseToken,old.leaseToken);assert.equal(recovered.attempts,2);
  await releaseDispatchLease('SOURCE',old);
  assert.equal((await db.dispatchLane.findUniqueOrThrow({where:{organizationId_kind:{organizationId:old.organizationId,kind:'SOURCE'}}})).leaseToken,recovered.leaseToken,'late worker cannot release replacement');
  assert.equal(await claimFairWatch(),null);
  await complete([recovered,jobs.find(j=>j.organizationId===f.ids[1])!]);
  const next=await claimFairWatch();assert.ok(next);assert.notEqual(next.id,old.id);assert.equal(next.organizationId,f.ids[0]);
 }finally{await f.cleanup();}
});

test('connector dispatch respects providers, credentials and cooldowns; manual and scheduled workers share a fenced slot',async()=>{
 const f=await fixture(2),connectors:string[]=[];
 try{
  for(const organizationId of f.ids){
   const programme=await db.programmeImport.create({data:{organizationId,createdById:f.user.id,inputHash:randomUUID(),method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
   const control=await db.managedControl.create({data:{organizationId,importId:programme.id,proposalKey:'synthetic',title:'Synthetic control',description:'Test',testProcedure:'Test',theme:'security',ownerId:f.user.id,scheduledById:f.user.id,intervalDays:30,nextReviewAt:new Date()}});
   for(const provider of ['GITHUB','MICROSOFT365']){
    const c=await db.evidenceConnector.create({data:{organizationId,controlId:control.id,configuredById:f.user.id,provider,repository:'synthetic/'+provider,branch:'main',enabled:true,encryptedSecret:'fixture-never-decrypted',nextRunAt:new Date(0)}});
    connectors.push(c.id);
   }
  }
  await db.watchSchedule.create({data:{organizationId:f.ids[0],configuredById:f.user.id,sourceId:'synthetic',enabled:true}});
  assert.equal(await claimFairConnector([]),null);
  await db.evidenceConnector.update({where:{id:connectors[0]},data:{nextRunAt:new Date(Date.now()+3600000),failureCode:'RATE_LIMITED'}});
  await db.evidenceConnector.update({where:{id:connectors[2]},data:{encryptedSecret:null}});
  assert.equal(await claimFairConnector(['GITHUB']),null,'cooldowns and missing credentials are excluded');
  const manualToken=randomUUID();
  assert.equal(await db.$transaction(tx=>claimManualConnectorLane(tx,f.ids[0],manualToken)),true);
  const scheduled=await claimFairConnector(['MICROSOFT365']);assert.ok(scheduled);assert.equal(scheduled.organizationId,f.ids[1]);
  assert.equal(await claimFairConnector(['MICROSOFT365']),null,'manual slot excludes scheduled claims');
  assert.equal(await db.$transaction(tx=>claimManualConnectorLane(tx,f.ids[1],randomUUID())),false,'scheduled slot excludes manual claims');
  assert.equal((await claimFairWatch())?.organizationId,f.ids[0],'source work is independent of connector slot');
  await releaseDispatchLease('CONNECTOR',{organizationId:f.ids[0],leaseToken:randomUUID()});
  assert.equal(await claimFairConnector(['MICROSOFT365']),null,'incorrect token cannot release manual slot');
  await releaseDispatchLease('CONNECTOR',{organizationId:f.ids[0],leaseToken:manualToken});
  const second=await claimFairConnector(['MICROSOFT365']);assert.ok(second);assert.equal(second.organizationId,f.ids[0]);
  await db.evidenceConnector.update({where:{id:second.id},data:{leaseUntil:new Date(0)}});
  await db.dispatchLane.updateMany({where:{organizationId:second.organizationId,kind:'CONNECTOR'},data:{leaseUntil:new Date(0)}});
  const recovered=await claimFairConnector(['MICROSOFT365']);assert.ok(recovered);assert.equal(recovered.id,second.id);assert.notEqual(recovered.leaseToken,second.leaseToken);
  await releaseDispatchLease('CONNECTOR',second);
  assert.equal(await claimFairConnector(['MICROSOFT365']),null,'stale connector completion cannot release recovered work');
  await assert.rejects(()=>db.$transaction(async tx=>{
   await tx.dispatchLane.updateMany({where:{organizationId:f.ids[0],kind:'CONNECTOR'},data:{leaseUntil:new Date(0)}});
   throw new Error('synthetic transaction rollback');
  }));
  assert.equal(await claimFairConnector(['MICROSOFT365']),null,'rollback preserves active slot');
 }finally{await f.cleanup();}
});
