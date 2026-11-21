import {Prisma} from "@prisma/client";
import {checkOfficialSource,recordManualSourceCheck} from "../lib/server/regulatory-watch";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {configureWatch,claimWatch,executeWatch,listWatches} from "../lib/server/monitoring-service";
import {saveBusinessProfile} from "../lib/server/intelligence-service";
import {configureWatchPortfolio,planSourcePortfolio} from "../lib/server/watch-portfolio";
import type {AuthorizedContext} from "../lib/server/authorization";
import {retryWatch} from '../lib/server/monitoring-recovery';
import {sourceCoverage} from '../lib/server/source-coverage';
import {publicSourceKey,SourceFetchDeferred} from '../lib/server/shared-source-fetch';
import {REGULATORY_SOURCES} from '../lib/regulatory-sources.mjs';
import {saveSetupWorkspace} from '../lib/server/setup-service';

test("monitoring leases, recovery, bounded retries, tenant isolation and revoked permissions",async()=>{
  const suffix=randomUUID(),user=await db.user.create({data:{externalId:suffix,email:suffix+"@example.invalid"}});
  const orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional monitoring "+n+suffix}})));
  const ids=orgs.map(o=>o.id),ctx:AuthorizedContext={userId:user.id,organizationId:ids[0],role:"OWNER"};
  process.env.REGPILOT_AI_ALLOWED_EMAILS=user.email;process.env.REGPILOT_MONITORING_ENABLED="true";
  const config={sourceId:"uk-data-protection",enabled:true,intervalHours:24,version:0};
  const official={id:config.sourceId,title:"Fictional monitoring test",url:"https://www.gov.uk/data-protection-your-business",updatedAt:null,revisionAt:null,text:"Fictional operators must retain supplier assessment records and keep them current. Staff should receive documented training before handling fictional widgets."};
  let fetches=0;const loader=async()=>{fetches++;return official;};
  const due=async(id:string)=>db.watchSchedule.update({where:{id},data:{nextCheckAt:new Date(Date.now()-1000)}});
  try{
    await db.membership.create({data:{userId:user.id,organizationId:ids[0],role:"OWNER"}});
    await saveBusinessProfile(ctx,{activities:["personal-data"],jurisdictions:["Scotland"]},0);
    await assert.rejects(()=>configureWatch({...ctx,role:"VIEWER"},config),(e:any)=>e.status===403);
    await assert.rejects(()=>configureWatch(ctx,{...config,sourceId:"https://internal.invalid/secret"}),(e:any)=>e.status===400);
    const manualId='scotland-fire-premises';
    await assert.rejects(()=>configureWatch(ctx,{...config,sourceId:manualId}),(e:any)=>e.status===409);
    await assert.rejects(()=>configureWatchPortfolio(ctx,{sourceIds:[manualId],enabled:true,intervalHours:24}),(e:any)=>e.status===409);
    const manual=await recordManualSourceCheck(ctx,manualId,null);
    const covered=(await sourceCoverage(ctx)).find(row=>row.sourceId===manualId)!;
    assert.equal(covered.manualCheck?.id,manual.id);assert.equal(covered.manualCheck?.by,user.email);
    assert.equal(covered.monitoring,'Manual refresh');assert.equal(covered.lastCheckedAt,null);assert.equal(covered.snapshotId,null);
    await assert.rejects(()=>recordManualSourceCheck(ctx,manualId,null),(e:any)=>e.status===409);
    await assert.rejects(()=>recordManualSourceCheck({...ctx,organizationId:ids[1]},manualId,null),(e:any)=>e.status===403);
    const oldWatch=await db.watchSchedule.create({data:{organizationId:ids[0],sourceId:manualId,configuredById:user.id,enabled:true,intervalHours:24,nextCheckAt:new Date(Date.now()-10000)}});
    const oldJob=(await claimWatch())!;assert.equal(oldJob.id,oldWatch.id);
    assert.equal(await executeWatch(oldJob,loader),'MANUAL_REFRESH');assert.equal(fetches,0);
    const retired=await db.watchSchedule.findUniqueOrThrow({where:{id:oldWatch.id}});
    assert.equal(retired.enabled,false);assert.equal(retired.lastSuccessAt,null);
    await assert.rejects(()=>retryWatch(ctx,{sourceId:manualId,version:retired.version}),(e:any)=>e.status===409);
    await db.watchSchedule.delete({where:{id:oldWatch.id}});
    const saved=await configureWatch(ctx,config);
    await assert.rejects(()=>configureWatch(ctx,config),(e:any)=>e.status===409);
    await assert.rejects(()=>listWatches({...ctx,organizationId:ids[1]}),(e:any)=>e.status===403,'an unowned workspace is rejected rather than returned as an empty success');
    const claims=await Promise.all([claimWatch(),claimWatch()]);assert.equal(claims.filter(Boolean).length,1);
    const first=claims.find(Boolean)!;assert.equal(await executeWatch(first,loader),"BASELINE");assert.equal(fetches,1);
    assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1);
    assert.equal(await db.obligation.count({where:{organizationId:ids[0]}}),0,"monitoring cannot accept recommendations");
    assert.equal(await db.aiDailyUsage.count({where:{organizationId:ids[0]}}),0,"monitoring never reserves paid AI");
    // Daily analysis capacity is a deferred stage, never a reason to disable a source.
    const baselineRun=await db.intelligenceRun.findFirstOrThrow({where:{organizationId:ids[0]}});
    const {id:runId,createdAt:runCreated,...runData}=baselineRun;
    await db.intelligenceRun.createMany({data:Array.from({length:29},(_,i)=>({...runData,engineVersion:"quota-fixture-"+i,result:runData.result as any,profile:runData.profile as any}))});
    await db.regulatorySnapshot.updateMany({where:{organizationId:ids[0]},data:{lastCheckedAt:new Date(0)}});
    await due(saved.id);const limited=(await claimWatch())!;
    const extra={...official,text:official.text+" A new publication version requires another independently reviewed analysis."};
    assert.equal(await executeWatch(limited,async()=>extra),"ANALYSIS_DEFERRED");
    const queued=await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}});
    assert.equal(queued.enabled,true);assert.equal(queued.attempts,0);assert.equal(queued.failureCode,"ANALYSIS_DEFERRED");
    await db.intelligenceRun.deleteMany({where:{organizationId:ids[0],engineVersion:{startsWith:"quota-fixture-"}}});
    // Remove only this isolated scenario's changed snapshot and investigation.
    await db.obligation.deleteMany({where:{organizationId:ids[0]}});
    await db.auditEvent.deleteMany({where:{organizationId:ids[0],action:{in:["regulatory.source_text_changed","monitoring.source_review_task_created"]}}});
    await db.regulatorySnapshot.deleteMany({where:{organizationId:ids[0],contentHash:{not:(await db.regulatorySnapshot.findUniqueOrThrow({where:{id:baselineRun.snapshotId}})).contentHash}}});
    await db.regulatorySnapshot.update({where:{id:baselineRun.snapshotId},data:{lastCheckedAt:new Date()}});
    assert.equal(await claimWatch(),null);
    await due(saved.id);const old=(await claimWatch())!;
    await db.watchSchedule.update({where:{id:saved.id},data:{leaseUntil:new Date(Date.now()-1000)}});
    await db.dispatchLane.updateMany({where:{organizationId:ids[0],kind:"SOURCE"},data:{leaseUntil:new Date(0)}});
    const recovered=(await claimWatch())!;assert.notEqual(old.leaseToken,recovered.leaseToken);
    assert.equal(await executeWatch(old,loader),"SUPERSEDED");assert.equal(await executeWatch(recovered,loader),"COOLDOWN");
    assert.equal(fetches,1);assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1);
    await db.regulatorySnapshot.updateMany({where:{organizationId:ids[0]},data:{lastCheckedAt:new Date(Date.now()-3600000)}});
    await due(saved.id);const pausedJob=(await claimWatch())!;
    assert.equal(await executeWatch(pausedJob,async()=>{await configureWatch(ctx,{...config,enabled:false,version:1});return {...official,text:official.text+" A changed fictional passage."};}),"SUPERSEDED");
    assert.equal(await db.regulatorySnapshot.count({where:{organizationId:ids[0]}}),1,"paused in-flight work cannot write a snapshot");
    await configureWatch(ctx,{...config,version:2});
    const lastSuccess=(await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}})).lastSuccessAt;
    await due(saved.id);const capacityJob=(await claimWatch())!;
    assert.equal(await executeWatch(capacityJob,async()=>{throw new Prisma.PrismaClientKnownRequestError("private pool details",{code:"P2028",clientVersion:"fixture"});}),"WORKER_DEFERRED");
    const deferred=await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}});
    assert.equal(deferred.enabled,true);assert.equal(deferred.attempts,0);assert.equal(deferred.failureCode,"DATABASE_BUSY");
    assert.deepEqual(deferred.lastSuccessAt,lastSuccess,"database pressure must not invent a successful collection");
    for(let n=1;n<=3;n++){
      await due(saved.id);const job=(await claimWatch())!;
      const result=await executeWatch(job,async()=>{throw new Error("secret raw provider error must not be stored");});
      assert.equal(result,n===3?"ATTENTION":"FAILED");
    }
    const failed=await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}});
    assert.equal(failed.enabled,false);assert.equal(failed.attempts,3);assert.equal(failed.failureCode,"FETCH_FAILED");assert.deepEqual(failed.lastSuccessAt,lastSuccess);
    assert.equal((await listWatches(ctx))[0].state,"attention");
    const events=await db.auditEvent.findMany({where:{organizationId:ids[0],action:"monitoring.check_failed"}});assert.equal(events.length,3);assert.doesNotMatch(JSON.stringify(events),/secret raw/);
    await configureWatch(ctx,{...config,version:3});const revoked=(await claimWatch())!;
    const before=fetches;
    await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:user.id}},data:{role:"VIEWER"}});
    assert.equal(await executeWatch(revoked,loader),"ATTENTION");assert.equal(fetches,before);
    assert.equal((await listWatches(ctx))[0].failureCode,"PERMISSION_REVOKED");
  }finally{
    await db.watchSchedule.deleteMany({where:{organizationId:{in:ids}}});await db.intelligenceRun.deleteMany({where:{organizationId:{in:ids}}});await db.businessProfile.deleteMany({where:{organizationId:{in:ids}}});
    await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.regulatorySnapshot.deleteMany({where:{organizationId:{in:ids}}});await db.membership.deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.delete({where:{id:user.id}});
  }
});

test("a bulk monitoring portfolio is scoped, idempotent and does not invent legal decisions",async()=>{
 const marker=randomUUID();
 const user=await db.user.create({data:{externalId:"portfolio-"+marker,email:marker+"@example.invalid"}});
 const org=await db.organization.create({data:{name:"Fictional portfolio "+marker}});
 const ctx:AuthorizedContext={organizationId:org.id,userId:user.id,role:"OWNER"};
 const ids=["uk-data-protection","mhra-gmp-gdp","companies-house-identity"];
 process.env.REGPILOT_AI_ALLOWED_EMAILS=user.email;
 try{
  await db.membership.create({data:{organizationId:org.id,userId:user.id,role:"OWNER"}});
  assert.equal(planSourcePortfolio({sourceIds:ids,enabled:true,intervalHours:24},ids).sourceIds.length,3);
  assert.throws(()=>planSourcePortfolio({sourceIds:[ids[0],ids[0]],enabled:true,intervalHours:24},ids));
  assert.throws(()=>planSourcePortfolio({sourceIds:["https://internal.invalid"],enabled:true,intervalHours:24},ids));
  const first=await configureWatchPortfolio(ctx,{sourceIds:ids,enabled:true,intervalHours:24});
  assert.equal(first.created,3);
  const second=await configureWatchPortfolio(ctx,{sourceIds:ids,enabled:true,intervalHours:24});
  assert.equal(second.unchanged,3);
  assert.equal((await db.watchSchedule.count({where:{organizationId:org.id}})),3);
  const third=await configureWatchPortfolio(ctx,{sourceIds:[ids[0]],enabled:true,intervalHours:168});
  assert.equal(third.updated,1);
  assert.equal((await db.watchSchedule.findUniqueOrThrow({where:{organizationId_sourceId:{organizationId:org.id,sourceId:ids[0]}}})).intervalHours,168);
  assert.equal(await db.regulatorySnapshot.count({where:{organizationId:org.id}}),0);
  await assert.rejects(()=>configureWatchPortfolio({...ctx,role:"VIEWER"},{sourceIds:ids,enabled:true,intervalHours:24}),(e:any)=>e.status===403);
 }finally{
  await db.watchSchedule.deleteMany({where:{organizationId:org.id}});
  await db.auditEvent.deleteMany({where:{organizationId:org.id}});
  await db.membership.deleteMany({where:{organizationId:org.id}});
  await db.organization.delete({where:{id:org.id}});
  await db.user.delete({where:{id:user.id}});
 }
});

test("real monitoring workflow links changed source text to one human-owned task, never a baseline or duplicate",async()=>{
 const stamp=randomUUID(),user=await db.user.create({data:{externalId:"review-"+stamp,email:stamp+"@example.invalid"}}),
 org=await db.organization.create({data:{name:"Fictional monitor-to-action "+stamp}});
 const ctx:AuthorizedContext={organizationId:org.id,userId:user.id,role:"OWNER"};
 const sourceId="uk-data-protection",url="https://www.gov.uk/data-protection-your-business";
 const first={id:sourceId,title:"Fictional current publication",url,updatedAt:null,revisionAt:null,
  text:"Fictional publication contains a continuing baseline requirement to document employee training and keep records of activity to be checked by an operator."};
 const later={...first,text:first.text+" This revised fictional publication adds a changed section that must be assessed by a human specialist."};
 process.env.REGPILOT_AI_ALLOWED_EMAILS=user.email;process.env.REGPILOT_MONITORING_ENABLED="true";
 try{
  await db.membership.create({data:{organizationId:org.id,userId:user.id,role:"OWNER"}});
  const watch=await configureWatch(ctx,{sourceId,enabled:true,intervalHours:24,version:0});
  let firstJob=await claimWatch();assert.ok(firstJob);
  assert.equal(await executeWatch(firstJob!,async()=>first),"BASELINE");
  assert.equal(await db.obligation.count({where:{organizationId:org.id}}),0,"a baseline is not a changed law");
  await db.regulatorySnapshot.updateMany({where:{organizationId:org.id},data:{lastCheckedAt:new Date(Date.now()-3600000)}});
  await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(Date.now()-1000)}});
  const job=await claimWatch();assert.ok(job);
  assert.equal(await executeWatch(job!,async()=>later),"CONTENT_CHANGED");
  const tasks=await db.obligation.findMany({where:{organizationId:org.id}});
  assert.equal(tasks.length,1);assert.equal(tasks[0].assigneeId,user.id);
  assert.match(tasks[0].title,/Review changed publication/);
  assert.match(tasks[0].notes,/not automatically a legal change/);
  assert.ok(tasks[0].automationKey?.startsWith("source-review:"));
  assert.equal((await db.regulatorySnapshot.findFirst({where:{organizationId:org.id},orderBy:{firstCapturedAt:"desc"}}))?.reviewStatus,"NEEDS_REVIEW");
  await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(Date.now()-1000)}});
  const same=await claimWatch();assert.ok(same);
  assert.equal(await executeWatch(same!,async()=>later),"COOLDOWN");
  assert.equal((await db.obligation.count({where:{organizationId:org.id}})),1);

  // Simulate capture committing, followed by process termination before enqueue.
  // Two later snapshots must both be recovered, including the older changed version.
  const beforeRecovery=await db.obligation.count({where:{organizationId:org.id}});
  for(let revision=1;revision<=2;revision++){
   await db.regulatorySnapshot.updateMany({where:{organizationId:org.id},data:{lastCheckedAt:new Date(Date.now()-3600000)}});
   assert.equal((await checkOfficialSource(ctx,sourceId,async()=>({...later,text:later.text+" Interrupted committed revision "+revision+" requires its own review."}))).state,"CONTENT_CHANGED");
  }
  assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforeRecovery);
  await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(Date.now()-1000)}});
  assert.equal(await executeWatch((await claimWatch())!,async()=>{throw Error("cooldown must not refetch");}),"COOLDOWN");
  assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforeRecovery+2);
  await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(Date.now()-1000)}});
  await executeWatch((await claimWatch())!,async()=>later);
  assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforeRecovery+2,"recovery must be idempotent");
 }finally{
  await db.watchSchedule.deleteMany({where:{organizationId:org.id}});
  await db.intelligenceRun.deleteMany({where:{organizationId:org.id}});
  await db.obligation.deleteMany({where:{organizationId:org.id}});
  await db.auditEvent.deleteMany({where:{organizationId:org.id}});
  await db.regulatorySnapshot.deleteMany({where:{organizationId:org.id}});
  await db.membership.deleteMany({where:{organizationId:org.id}});
  await db.organization.delete({where:{id:org.id}});
  await db.user.delete({where:{id:user.id}});
 }
});

test('an administrator recovers a failed source without clearing the incident, bypassing cooldown or duplicating work',async()=>{
 const saved={...process.env},stamp=randomUUID();
 const [owner,admin,foreign]=await Promise.all(['owner','admin','foreign'].map(n=>db.user.create({data:{externalId:randomUUID(),email:n+stamp+'@example.invalid'}})));
 const [org,outside]=await Promise.all(['A','B'].map(n=>db.organization.create({data:{name:'Fictional source recovery '+n+stamp}})));
 const ctx:AuthorizedContext={organizationId:org.id,userId:owner.id,role:'OWNER'},reviewer:AuthorizedContext={organizationId:org.id,userId:admin.id,role:'ADMIN'},out:AuthorizedContext={organizationId:outside.id,userId:foreign.id,role:'OWNER'};
 const source=REGULATORY_SOURCES.find(s=>s.id==='uk-data-protection')!,cacheKey=publicSourceKey(source);
 const first={id:source.id,title:'Fictional source recovery baseline',url:'https://www.gov.uk/data-protection-your-business',updatedAt:null,revisionAt:null,text:'Fictional operators retain supplier records and document staff training. This isolated test publication does not describe actual law or customer information.'};
 Object.assign(process.env,{REGPILOT_AI_ALLOWED_EMAILS:[owner.email,admin.email,foreign.email].join(','),REGPILOT_MONITORING_ENABLED:'true',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_WORKER_ENABLED:'true',REGPILOT_CRON_ENABLED:'false'});
 try{
  await db.membership.createMany({data:[ctx,reviewer,out]});
  const configured=await configureWatch(ctx,{sourceId:source.id,enabled:true,intervalHours:24,version:0});
  assert.equal(await executeWatch((await claimWatch())!,async()=>first),'BASELINE');
  const success=(await db.watchSchedule.findUniqueOrThrow({where:{id:configured.id}})).lastSuccessAt;
  await db.regulatorySnapshot.updateMany({where:{organizationId:org.id},data:{lastCheckedAt:new Date(0)}});
  for(let n=0;n<3;n++){
   await db.watchSchedule.update({where:{id:configured.id},data:{nextCheckAt:new Date(0)}});
   await executeWatch((await claimWatch())!,async()=>{throw Error('private provider credentials must never enter recovery history');});
  }
  let failed=await db.watchSchedule.findUniqueOrThrow({where:{id:configured.id}});
  assert.equal(failed.enabled,false);assert.equal(failed.failureCode,'FETCH_FAILED');assert.deepEqual(failed.lastSuccessAt,success);
  await assert.rejects(()=>retryWatch({...reviewer,role:'VIEWER'},{sourceId:source.id,version:failed.version}),(e:any)=>e.status===403);
  await assert.rejects(()=>retryWatch({...out,organizationId:org.id},{sourceId:source.id,version:failed.version}),(e:any)=>e.status===403);
  await assert.rejects(()=>retryWatch(reviewer,{sourceId:source.id,version:failed.version+1}),(e:any)=>e.status===409);
  await db.membership.update({where:{organizationId_userId:{organizationId:org.id,userId:admin.id}},data:{role:'VIEWER'}});
  await assert.rejects(()=>retryWatch(reviewer,{sourceId:source.id,version:failed.version}),(e:any)=>e.status===403,'the current database role overrides a stale authorized context');
  await db.membership.update({where:{organizationId_userId:{organizationId:org.id,userId:admin.id}},data:{role:'ADMIN'}});
  await db.watchSchedule.update({where:{id:failed.id},data:{enabled:true,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000)}});
  await assert.rejects(()=>retryWatch(reviewer,{sourceId:source.id,version:failed.version}),(e:any)=>e.status===409,'an administrator cannot steal an active collection lease');
  await db.watchSchedule.update({where:{id:failed.id},data:{enabled:false,leaseToken:null,leaseUntil:null}});
  const cooldown=new Date(Date.now()+60000);
  await db.publicSourceFetch.upsert({where:{key:cacheKey},create:{key:cacheKey,sourceId:source.id,retryAt:cooldown,failureCode:'SOURCE_FETCH_UNAVAILABLE'},update:{retryAt:cooldown,failureCode:'SOURCE_FETCH_UNAVAILABLE'}});
  const concurrent=await Promise.all([retryWatch(reviewer,{sourceId:source.id,version:failed.version}),retryWatch(reviewer,{sourceId:source.id,version:failed.version})]);
  assert.equal(concurrent.filter(r=>!r.reused).length,1,'competing requests enqueue one recovery');
  const retry=concurrent.find(r=>!r.reused)!;
  assert.equal(retry.reused,false);assert.equal(retry.version,failed.version+1);assert.deepEqual(new Date(retry.nextCheckAt),cooldown);
  const duplicate=await retryWatch(reviewer,{sourceId:source.id,version:failed.version});assert.equal(duplicate.reused,true);assert.equal(duplicate.version,retry.version);
  assert.equal((await retryWatch(reviewer,{sourceId:source.id,version:retry.version})).reused,true);
  assert.equal(await db.auditEvent.count({where:{organizationId:org.id,action:'monitoring.retry_requested'}}),1);
  assert.equal(await claimWatch(),null,'a queued retry respects shared publisher cooldown');
  const queued=await db.watchSchedule.findUniqueOrThrow({where:{id:failed.id}});
  assert.equal(queued.failureCode,'FETCH_FAILED');assert.deepEqual(queued.lastSuccessAt,success);assert.equal(queued.configuredById,admin.id);
  const foreignEvent=await db.auditEvent.create({data:{organizationId:outside.id,actorId:foreign.id,action:'monitoring.check_failed',entityType:'WatchSchedule',entityId:failed.id,details:{outcome:'FAILED',failureCode:'FOREIGN_PRIVATE_FAILURE'}}});
  const coverage=(await sourceCoverage(reviewer)).find(s=>s.sourceId===source.id)!;
  assert.equal(coverage.schedule?.recoveryPending,true);assert.equal(coverage.schedule?.retryAvailable,false);assert.equal(coverage.schedule?.failureCode,'FETCH_FAILED');
  assert.equal(coverage.schedule?.history?.length,5);assert.equal(coverage.schedule?.historyLimited,true);
  assert.equal(coverage.schedule?.history?.some(e=>e.id===foreignEvent.id),false);
  assert.doesNotMatch(JSON.stringify(coverage),/private provider|FOREIGN_PRIVATE_FAILURE/);
  assert.match(coverage.reviewHref!,new RegExp('organizationId='+org.id));assert.match(coverage.reviewHref!,/sourceId=uk-data-protection/);
  assert.equal((await listWatches(out)).length,0);
  // Advance only the isolated persisted schedule/cooldown. No wall-clock sleep or external fetch.
  await db.publicSourceFetch.update({where:{key:cacheKey},data:{retryAt:new Date(0)}});
  await db.watchSchedule.update({where:{id:failed.id},data:{nextCheckAt:new Date(0)}});
  const job=(await claimWatch())!;
  assert.equal(await executeWatch(job,async()=>({...first,text:first.text+' A newly captured fictional section asks an independent reviewer to inspect a changed record-retention procedure.'})),'CONTENT_CHANGED');
  const recovered=await db.watchSchedule.findUniqueOrThrow({where:{id:failed.id}});
  assert.equal(recovered.failureCode,null);assert.equal(recovered.lastOutcome,'CONTENT_CHANGED');assert.equal(recovered.attempts,0);assert.ok(recovered.lastSuccessAt!>=success!);
  const latest=await db.regulatorySnapshot.findFirstOrThrow({where:{organizationId:org.id},orderBy:{firstCapturedAt:'desc'}});
  assert.equal(latest.reviewStatus,'NEEDS_REVIEW');assert.equal(latest.capturedById,admin.id);
  const work=await db.obligation.findMany({where:{organizationId:org.id}});assert.equal(work.length,1);assert.equal(work[0].automationKey,'source-review:'+latest.id);assert.equal(work[0].assigneeId,admin.id);
  await assert.rejects(()=>retryWatch(reviewer,{sourceId:source.id,version:retry.version}),(e:any)=>e.status===409,'success is not queued for a duplicate new check');
  assert.equal(await db.aiDailyUsage.count({where:{organizationId:org.id}}),0);
 }finally{
  const ids=[org.id,outside.id];
  await db.publicSourceFetch.deleteMany({where:{key:cacheKey}});
  for(const table of [db.watchSchedule,db.intelligenceRun,db.obligation,db.auditEvent,db.regulatorySnapshot,db.membership] as any[])await table.deleteMany({where:{organizationId:{in:ids}}});
  await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:[owner.id,admin.id,foreign.id]}}});
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
 }
});

test('schedule edits and repeated publisher deferrals cannot erase or flood a source incident',async()=>{
 const saved={...process.env},stamp=randomUUID(),user=await db.user.create({data:{externalId:stamp,email:stamp+'@example.invalid'}}),org=await db.organization.create({data:{name:'Fictional retained incident '+stamp}});
 const ctx:AuthorizedContext={organizationId:org.id,userId:user.id,role:'OWNER'},sourceId='uk-data-protection';
 Object.assign(process.env,{REGPILOT_AI_ALLOWED_EMAILS:user.email,REGPILOT_MONITORING_ENABLED:'true'});
 try{
  await db.membership.create({data:ctx});
  const watch=await configureWatch(ctx,{sourceId,enabled:true,intervalHours:24,version:0});
  await db.watchSchedule.update({where:{id:watch.id},data:{enabled:false,failureCode:'FETCH_FAILED',lastOutcome:'FAILED',lastSuccessAt:new Date(1000)}});
  await configureWatch(ctx,{sourceId,enabled:true,intervalHours:168,version:1});
  let row=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});assert.equal(row.failureCode,'FETCH_FAILED');assert.equal(row.lastOutcome,'RECOVERY_QUEUED');assert.deepEqual(row.lastSuccessAt,new Date(1000));
  await configureWatchPortfolio(ctx,{sourceIds:[sourceId],enabled:true,intervalHours:24});
  row=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});assert.equal(row.failureCode,'FETCH_FAILED');
  await saveSetupWorkspace(ctx,{profileVersion:0,activities:['personal-data'],jurisdictions:['Scotland'],sources:[{sourceId,version:row.version}],intervalHours:168,reviewAcknowledged:true});
  row=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});assert.equal(row.failureCode,'FETCH_FAILED');assert.deepEqual(row.lastSuccessAt,new Date(1000));
  for(let n=0;n<3;n++){
   await db.watchSchedule.update({where:{id:watch.id},data:{nextCheckAt:new Date(0)}});
   assert.equal(await executeWatch((await claimWatch())!,async()=>{throw new SourceFetchDeferred('SOURCE_FETCH_BUSY',new Date(Date.now()+60000));}),'SOURCE_DEFERRED');
  }
  row=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});assert.equal(row.failureCode,'FETCH_FAILED');assert.equal(row.attempts,0);assert.deepEqual(row.lastSuccessAt,new Date(1000));
  assert.equal(await db.auditEvent.count({where:{organizationId:org.id,action:'monitoring.check_deferred'}}),1,'only the first transition creates an audit record');
  assert.equal(await db.regulatorySnapshot.count({where:{organizationId:org.id}}),0);
  assert.equal((await sourceCoverage(ctx)).find(s=>s.sourceId===sourceId)?.schedule?.history?.[0].failureCode,'FETCH_FAILED');
 }finally{
  for(const table of [db.watchSchedule,db.intelligenceRun,db.businessProfile,db.obligation,db.auditEvent,db.regulatorySnapshot,db.membership] as any[])await table.deleteMany({where:{organizationId:org.id}});
  await db.organization.delete({where:{id:org.id}});await db.user.delete({where:{id:user.id}});
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
 }
});
