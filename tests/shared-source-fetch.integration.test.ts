import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {db} from '../lib/server/db';
import {loadSharedPublicSource,publicSourceKey,SourceFetchDeferred,prunePublicSourceFetches} from '../lib/server/shared-source-fetch';
import {REGULATORY_SOURCES,officialSourceUrl} from '../lib/regulatory-sources.mjs';
import {checkOfficialSource,listSourceSnapshots} from '../lib/server/regulatory-watch';
import {configureWatch,claimWatch,executeWatch} from '../lib/server/monitoring-service';
import type {AuthorizedContext} from '../lib/server/authorization';
const source=REGULATORY_SOURCES.find(s=>s.id==='uk-data-protection')!,key=publicSourceKey(source);
const publication=(revision='baseline')=>({id:source.id,title:'Fictional public source',url:officialSourceUrl(source),updatedAt:null,revisionAt:null,text:('Fictional '+revision+' publication on retaining supplier evidence and periodically reviewing documented staff training records. ').repeat(3)});
const clean=()=>db.publicSourceFetch.deleteMany({where:{key}});
const isDeferred=(error:unknown)=>error instanceof SourceFetchDeferred;

test('200 simultaneous consumers across eight processes share one public retrieval and its original timestamp',async t=>{
 await clean();const started=performance.now(),children:ChildProcess[]=[];
 let fetches=0;const results:{count:number;fetchedAt:string[];reused:number}[]=[];
 try{
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('connection_limit','2');
  const ready:Promise<void>[]=[],finished:Promise<void>[]=[];
  for(let i=0;i<8;i++){
   const child=fork('tests/helpers/source-fetch-worker.ts',[],{execArgv:['--import','tsx'],env:{...process.env,DATABASE_URL:url.toString(),REGPILOT_SHARED_FETCH_FIXTURE:'true'},stdio:['ignore','ignore','ignore','ipc']});children.push(child);
   ready.push(new Promise((resolve,reject)=>{
    child.on('message',(message:any)=>{if(message.kind==='ready')resolve();if(message.kind==='fetch')fetches++;if(message.kind==='result')results.push(message);});
    child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(Error('Fixture worker failed'));});
   }));
   finished.push(new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Fixture worker failed')));}));
  }
  // Attach handlers immediately so startup failures cannot become unhandled rejections.
  const completion=Promise.all(finished);void completion.catch(()=>{});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([(async()=>{await Promise.all(ready);children.forEach(c=>c.send('go'));await completion;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Multiprocess fixture timed out')),30000);})]);
  }finally{if(timer)clearTimeout(timer);}
  assert.equal(fetches,1);assert.equal(results.length,8);assert.equal(results.reduce((n,r)=>n+r.count,0),200);
  assert.equal(results.reduce((n,r)=>n+r.reused,0),199);assert.equal(new Set(results.flatMap(r=>r.fetchedAt)).size,1);
  const row=await db.publicSourceFetch.findUniqueOrThrow({where:{key}});
  assert.equal(results[0].fetchedAt[0],row.fetchedAt!.toISOString());assert.equal(row.leaseToken,null);
  t.diagnostic('shared public retrieval benchmark '+JSON.stringify({processes:8,consumers:200,upstreamFetches:fetches,reused:199,durationMs:Math.round(performance.now()-started)}));
 }finally{children.forEach(c=>{if(c.exitCode===null)c.kill();});await clean();}
});

test('expired or corrupted cache cannot pass as a successful source check; outage cooldown suppresses a retry storm',async()=>{
 await clean();let calls=0;const loader=async()=>{calls++;return publication(String(calls));};
 try{
  const first=await loadSharedPublicSource(source,loader);
  const second=await loadSharedPublicSource(source,loader);assert.equal(calls,1);assert.equal(second.reused,true);assert.deepEqual(first.fetchedAt,second.fetchedAt);
  await db.publicSourceFetch.update({where:{key},data:{payload:publication('corrupted')}});
  assert.equal((await loadSharedPublicSource(source,loader)).reused,false);assert.equal(calls,2);
  await db.publicSourceFetch.update({where:{key},data:{expiresAt:new Date(0)}});
  await assert.rejects(()=>loadSharedPublicSource(source,async()=>{calls++;throw Error('private upstream token must never persist');}),isDeferred);
  const failed=await db.publicSourceFetch.findUniqueOrThrow({where:{key}});
  assert.equal(failed.failures,1);assert.equal(failed.failureCode,'SOURCE_FETCH_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(failed),/private upstream/);
  assert.deepEqual(failed.payload,publication('2'),'last good public body is retained for diagnostics, not served as fresh');
  const storm=await Promise.allSettled(Array.from({length:100},()=>loadSharedPublicSource(source,loader)));
  assert.equal(storm.filter(r=>r.status==='rejected'&&isDeferred(r.reason)).length,100);assert.equal(calls,3);
  await db.publicSourceFetch.update({where:{key},data:{retryAt:new Date(0)}});
  assert.equal((await loadSharedPublicSource(source,loader)).reused,false);assert.equal(calls,4);
  const recovered=await db.publicSourceFetch.findUniqueOrThrow({where:{key}});assert.equal(recovered.failures,0);assert.equal(recovered.failureCode,null);
 }finally{await clean();}
});

test('mismatched upstream identity is never cached or treated as fresh evidence',async()=>{
 await clean();
 try{
  await assert.rejects(()=>loadSharedPublicSource(source,async()=>({...publication(),url:'https://internal.invalid/private'})),isDeferred);
  const row=await db.publicSourceFetch.findUniqueOrThrow({where:{key}});assert.equal(row.payload,null);assert.equal(row.fetchedAt,null);
 }finally{await clean();}
});

test('replacement workers fence both late success and late failure after a crashed fetch lease expires',async()=>{
 for(const failure of [false,true]){
  await clean();let release!:()=>void,started!:()=>void;
  const barrier=new Promise<void>(r=>{release=r;}),begun=new Promise<void>(r=>{started=r;});
  const old=loadSharedPublicSource(source,async()=>{started();await barrier;if(failure)throw Error('late failure');return publication('old');});
  const rejection=assert.rejects(old,(e:unknown)=>e instanceof SourceFetchDeferred&&e.code==='SOURCE_FETCH_SUPERSEDED');
  try{
   await begun;await db.publicSourceFetch.update({where:{key},data:{leaseUntil:new Date(0)}});
   const replacement=await loadSharedPublicSource(source,async()=>publication('replacement'));release();await rejection;
   const row=await db.publicSourceFetch.findUniqueOrThrow({where:{key}});
   assert.deepEqual(row.payload,replacement.official);assert.equal(row.retryAt,null);assert.equal(row.failureCode,null);
  }finally{release();await rejection;await clean();}
 }
});

test('shared public bytes retain fetch provenance while tenant snapshots and review decisions remain isolated',async()=>{
 await clean();const marker=randomUUID(),user=await db.user.create({data:{externalId:marker,email:marker+'@example.invalid'}});
 const orgs=await Promise.all(['A','B'].map(n=>db.organization.create({data:{name:'Fictional public reuse '+n+marker}}))),ids=orgs.map(o=>o.id);
 const ctx=(organizationId:string):AuthorizedContext=>({organizationId,userId:user.id,role:'OWNER'});
 try{
  await db.membership.createMany({data:ids.map(organizationId=>({organizationId,userId:user.id,role:'OWNER' as const}))});
  await loadSharedPublicSource(source,async()=>publication());
  const actualFetch=new Date(Date.now()-60000);await db.publicSourceFetch.update({where:{key},data:{fetchedAt:actualFetch}});
  const shared=await loadSharedPublicSource(source,async()=>{throw Error('Must reuse public retrieval');});
  const loader=async()=>({...shared.official,sourceFetchedAt:shared.fetchedAt});
  const [a,b]=await Promise.all(ids.map(id=>checkOfficialSource(ctx(id),source.id,loader)));
  assert.notEqual(a.snapshot.id,b.snapshot.id);assert.equal(a.snapshot.contentHash,b.snapshot.contentHash);
  const stored=await db.regulatorySnapshot.findMany({where:{organizationId:{in:ids}}});
  assert.equal(stored.length,2);assert.ok(stored.every(r=>r.sourceFetchedAt?.getTime()===actualFetch.getTime()));
  await db.regulatorySnapshot.update({where:{id:a.snapshot.id},data:{reviewStatus:'REVIEWED'}});
  const other=await listSourceSnapshots(ctx(ids[1]));assert.equal(other.length,1);assert.equal(other[0].reviewStatus,'NEEDS_REVIEW');
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.regulatorySnapshot.deleteMany({where:{organizationId:{in:ids}}});
  await db.membership.deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.delete({where:{id:user.id}});await clean();
 }
});

test('shared upstream deferral preserves tenant retry budget and never fabricates snapshots or success',async()=>{
 const marker=randomUUID(),user=await db.user.create({data:{externalId:marker,email:marker+'@example.invalid'}}),org=await db.organization.create({data:{name:'Fictional shared deferral '+marker}});
 const ctx:AuthorizedContext={organizationId:org.id,userId:user.id,role:'OWNER'};
 process.env.REGPILOT_AI_ALLOWED_EMAILS=user.email;process.env.REGPILOT_MONITORING_ENABLED='true';
 try{
  await db.membership.create({data:{organizationId:org.id,userId:user.id,role:'OWNER'}});
  const watch=await configureWatch(ctx,{sourceId:source.id,enabled:true,intervalHours:24,version:0}),retryAt=new Date(Date.now()+60000);
  for(let i=0;i<4;i++){
   await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(0)}});
   const job=await claimWatch();assert.ok(job);
   assert.equal(await executeWatch(job,async()=>{throw new SourceFetchDeferred('SOURCE_FETCH_UNAVAILABLE',retryAt);}),'SOURCE_DEFERRED');
  }
  const row=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});
  assert.equal(row.attempts,0);assert.equal(row.enabled,true);assert.equal(row.lastSuccessAt,null);assert.equal(row.leaseToken,null);assert.deepEqual(row.nextCheckAt,retryAt);
  assert.equal(await db.regulatorySnapshot.count({where:{organizationId:org.id}}),0);
  assert.equal(await db.obligation.count({where:{organizationId:org.id}}),0);
  assert.equal(await db.dispatchLane.count({where:{organizationId:org.id,leaseToken:{not:null}}}),0);
 }finally{
  await db.watchSchedule.deleteMany({where:{organizationId:org.id}});await db.auditEvent.deleteMany({where:{organizationId:org.id}});
  await db.membership.deleteMany({where:{organizationId:org.id}});await db.organization.delete({where:{id:org.id}});await db.user.delete({where:{id:user.id}});
 }
});

test('cache retention is bounded and protects active fetch leases',async()=>{
 const prefix=randomUUID(),keys=Array.from({length:252},(_,i)=>prefix+'-'+i),old=new Date(Date.now()-31*86400000);
 try{
  await db.publicSourceFetch.createMany({data:keys.map((key,i)=>({key,sourceId:'fictional-retention',updatedAt:old,...(i===251?{leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000)}:{})}))});
  assert.equal(await prunePublicSourceFetches(),250);assert.equal(await db.publicSourceFetch.count({where:{key:{in:keys}}}),2);
  assert.equal(await prunePublicSourceFetches(),1);assert.equal(await db.publicSourceFetch.count({where:{key:keys[251]}}),1);
 }finally{await db.publicSourceFetch.deleteMany({where:{key:{in:keys}}});}
});
