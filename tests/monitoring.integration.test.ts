import {checkOfficialSource} from "../lib/server/regulatory-watch";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {configureWatch,claimWatch,executeWatch,listWatches} from "../lib/server/monitoring-service";
import {saveBusinessProfile} from "../lib/server/intelligence-service";
import {configureWatchPortfolio,planSourcePortfolio} from "../lib/server/watch-portfolio";
import type {AuthorizedContext} from "../lib/server/authorization";

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
    const saved=await configureWatch(ctx,config);
    await assert.rejects(()=>configureWatch(ctx,config),(e:any)=>e.status===409);
    assert.equal((await listWatches({...ctx,organizationId:ids[1]})).length,0);
    const claims=await Promise.all([claimWatch(),claimWatch()]);assert.equal(claims.filter(Boolean).length,1);
    const first=claims.find(Boolean)!;assert.equal(await executeWatch(first,loader),"BASELINE");assert.equal(fetches,1);
    assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1);
    assert.equal(await db.obligation.count({where:{organizationId:ids[0]}}),0,"monitoring cannot accept recommendations");
    assert.equal(await db.aiDailyUsage.count({where:{organizationId:ids[0]}}),0,"monitoring never reserves paid AI");
    assert.equal(await claimWatch(),null);
    await due(saved.id);const old=(await claimWatch())!;
    await db.watchSchedule.update({where:{id:saved.id},data:{leaseUntil:new Date(Date.now()-1000)}});
    const recovered=(await claimWatch())!;assert.notEqual(old.leaseToken,recovered.leaseToken);
    assert.equal(await executeWatch(old,loader),"SUPERSEDED");assert.equal(await executeWatch(recovered,loader),"COOLDOWN");
    assert.equal(fetches,1);assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1);
    await db.regulatorySnapshot.updateMany({where:{organizationId:ids[0]},data:{lastCheckedAt:new Date(Date.now()-3600000)}});
    await due(saved.id);const pausedJob=(await claimWatch())!;
    assert.equal(await executeWatch(pausedJob,async()=>{await configureWatch(ctx,{...config,enabled:false,version:1});return {...official,text:official.text+" A changed fictional passage."};}),"SUPERSEDED");
    assert.equal(await db.regulatorySnapshot.count({where:{organizationId:ids[0]}}),1,"paused in-flight work cannot write a snapshot");
    await configureWatch(ctx,{...config,version:2});
    const lastSuccess=(await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}})).lastSuccessAt;
    for(let n=1;n<=3;n++){
      await due(saved.id);const job=(await claimWatch())!;
      const result=await executeWatch(job,async()=>{throw new Error("secret raw provider error must not be stored");});
      assert.equal(result,n===3?"ATTENTION":"FAILED");
    }
    const failed=await db.watchSchedule.findUniqueOrThrow({where:{id:saved.id}});
    assert.equal(failed.enabled,false);assert.equal(failed.attempts,3);assert.equal(failed.failureCode,"CHECK_OR_ANALYSIS_FAILED");assert.deepEqual(failed.lastSuccessAt,lastSuccess);
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
