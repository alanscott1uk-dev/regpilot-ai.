import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {WatchSchedule} from '@prisma/client';
import {db} from '../lib/server/db';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {runConnectorBatch,executeConnector,maxConnectorReadsPerTick} from '../lib/server/connector-service';
import {recordKeys} from '../lib/connectors/operational-records';
import {encryptConnectorSecret} from '../lib/server/connector-secret';
import {verifiedObservation} from '../lib/server/connector-observation';
import {claimFairWatch,claimFairConnector,claimFairConnectors,claimManualConnectorLane,releaseDispatchLease} from '../lib/server/fair-dispatch';

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

async function benchmarkFleet(t:TestContext,tenantCount:number){
 const f=await fixture(tenantCount),originalFetch=globalThis.fetch,previous={...process.env};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',
  REGPILOT_CONNECTOR_ENCRYPTION_KEY:'b2'.repeat(32),REGPILOT_AI_ALLOWED_EMAILS:f.user.email,
  SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_HEALTHCHECKS_JOB_ENABLED:'true'});
 const orgWhere={organizationId:{in:f.ids}},targets=new Map<string,{org:string;slug:string;token:string}>();
 const requests=new Map<string,number>(),activeTenants=new Set<string>();
 const latencies:number[]=[];let peakAtSource=0,violations=0;
 const server=createServer((req,res)=>{
  const key=req.url?.split('/').at(-1)??'',target=targets.get(key);
  if(!target||req.headers['x-api-key']!==target.token){violations++;res.writeHead(403).end();return;}
  if(activeTenants.has(target.org))violations++;
  activeTenants.add(target.org);peakAtSource=Math.max(peakAtSource,activeTenants.size);
  requests.set(key,(requests.get(key)??0)+1);
  const entered=performance.now();
  setTimeout(()=>{
   activeTenants.delete(target.org);latencies.push(performance.now()-entered);
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({
    unique_key:key,slug:target.slug,status:'up',last_ping:new Date(Date.now()-60000).toISOString()}));
  },parseInt(key.slice(-6),16)%25===0?55:5);
 });
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
  globalThis.fetch=async(input,options)=>{
   const url=new URL(String(input));assert.equal(url.origin,'https://healthchecks.io');
   const local='http://127.0.0.1:'+address.port+url.pathname;
   const received=await originalFetch(local,options);assert.equal(received.url,local);
   const response=new Response(received.body,{status:received.status,headers:received.headers});
   Object.defineProperty(response,'url',{value:url.href});
   return response;
  };
  await db.membership.createMany({data:f.ids.map(organizationId=>({organizationId,userId:f.user.id,role:'OWNER'}))});
  const imports=f.ids.map(organizationId=>({organizationId,id:randomUUID(),createdById:f.user.id,inputHash:randomUUID(),method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}));
  await db.programmeImport.createMany({data:imports});
  const controls=imports.map(row=>({organizationId:row.organizationId,id:randomUUID(),importId:row.id,proposalKey:'scheduled',title:'Scheduled collection',description:'Observe source',testProcedure:'Read configured target',theme:'operations',ownerId:f.user.id,scheduledById:f.user.id,intervalDays:1,nextReviewAt:new Date()}));
  await db.managedControl.createMany({data:controls});
  const due=new Date(Date.now()-1000);
  const perTenant=500/tenantCount;
  const jobs=controls.flatMap((control,orgIndex)=>Array.from({length:perTenant},(_,index)=>{
   const id=randomUUID(),key=(perTenant*orgIndex+index).toString(16).padStart(40,'0'),slug='job-'+index,token='load-test-'+control.organizationId;
   targets.set(key,{org:control.organizationId,slug,token});
   return {id,organizationId:control.organizationId,controlId:control.id,configuredById:f.user.id,provider:'HEALTHCHECKS_JOB',enabled:true,
    ...recordKeys('HEALTHCHECKS_JOB',{scope:slug,record:key,reference:'60'}),encryptedSecret:encryptConnectorSecret(token,control.organizationId,id),
    intervalHours:1,nextRunAt:due,lastSuccessAt:new Date(due.getTime()-3600000)};
  }));
  await db.evidenceConnector.createMany({data:jobs});
  const claims=await Promise.all([claimFairConnectors(['HEALTHCHECKS_JOB'],4),claimFairConnectors(['HEALTHCHECKS_JOB'],4)]);
  const crashed=claims.flat();assert.equal(crashed.length,Math.min(8,tenantCount));assert.equal(new Set(crashed.map(j=>j.organizationId)).size,crashed.length);
  assert.equal(new Set(crashed.map(j=>j.leaseToken)).size,crashed.length);
  await db.evidenceConnector.updateMany({where:{id:{in:crashed.map(j=>j.id)}},data:{leaseUntil:new Date(0)}});
  await db.dispatchLane.updateMany({where:{organizationId:{in:crashed.map(j=>j.organizationId)},kind:'CONNECTOR'},data:{leaseUntil:new Date(0)}});
  const started=performance.now();let processed=0,dispatches=0,peakInFlight=0,ticks=0;
  while(processed<500&&ticks<10){
   const result=await runConnectorBatch();ticks++;processed+=result.processed;dispatches+=result.dispatches;
   peakInFlight=Math.max(peakInFlight,result.peakInFlight);
   if(result.outcomes.some(outcome=>outcome!=='OBSERVED')){
    const failures=await db.evidenceConnector.groupBy({by:['failureCode'],where:orgWhere,_count:true});
    assert.fail('Unexpected collection outcomes '+JSON.stringify({outcomes:[...new Set(result.outcomes)],failures,sourceRequests:requests.size,violations}));
   }
   assert.ok(result.processed>0,'A due fleet must make progress');
  }
  const elapsedMs=Math.round(performance.now()-started);
  assert.equal(processed,500);assert.equal(requests.size,500);assert.ok([...requests.values()].every(n=>n===1));assert.equal(violations,0);
  assert.ok(peakAtSource>=Math.min(2,tenantCount)&&peakAtSource<=Math.min(tenantCount,4));
  assert.equal(await executeConnector(crashed[0]),'SUPERSEDED');assert.equal(requests.size,500);
  const reads=await db.connectorRun.findMany({where:orgWhere});
  assert.equal(new Set(reads.map(r=>r.connectorId)).size,500);assert.equal(reads.length,500);
  assert.ok(reads.every(r=>verifiedObservation(r)?.checks.length===2));
  const scheduled=await db.auditEvent.count({where:{...orgWhere,action:'connector.evidence_collected',details:{path:['collectionMode'],equals:'SCHEDULED'}}});
  const recovered=await db.auditEvent.count({where:{...orgWhere,action:'connector.evidence_collected',details:{path:['collectionMode'],equals:'RETRY'}}});
  assert.equal(scheduled,500-crashed.length);assert.equal(recovered,crashed.length);assert.equal(await db.evidenceConnector.count({where:{...orgWhere,nextRunAt:{lte:new Date()}}}),0);
  latencies.sort((a,b)=>a-b);
  const metrics={targets:500,tenants:tenantCount,checks:1000,scheduledReceipts:scheduled,retryReceipts:recovered,duplicateReads:0,expiredLeasesRecovered:crashed.length,
   ticks,elapsedMs,readsPerSecond:Math.round(500000/elapsedMs*10)/10,dispatchQueries:dispatches,peakInFlight,
   sourceLatencyP95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),admissionCeiling:maxConnectorReadsPerTick,
   scope:'PostgreSQL and an isolated HTTP fixture with the native Healthchecks parser'};
  t.diagnostic('connector engine '+JSON.stringify(metrics));
  return metrics;
 }finally{
  globalThis.fetch=originalFetch;
  server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
  await db.automationEvent.deleteMany({where:orgWhere});
  await db.auditEvent.deleteMany({where:orgWhere});
  await db.obligation.deleteMany({where:orgWhere});
  await db.connectorRun.deleteMany({where:orgWhere});
  await db.membership.deleteMany({where:orgWhere});
  await f.cleanup();
 }
}

test('the scheduled connector engine drains 500 distinct HTTP targets in a single tenant and across 25 tenants, recovering crashed leases',async t=>{
 const scenarios=[];
 for(const tenants of [1,25])scenarios.push(await benchmarkFleet(t,tenants));
 if(process.env.REGPILOT_FLEET_BENCHMARK_OUTPUT)
  await writeFile(process.env.REGPILOT_FLEET_BENCHMARK_OUTPUT,JSON.stringify({format:'regpilot-connector-capacity-v1',scenarios},null,2)+'\n');
});
