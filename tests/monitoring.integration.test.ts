import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {configureWatch,claimWatch,executeWatch,listWatches} from "../lib/server/monitoring-service";
import {saveBusinessProfile} from "../lib/server/intelligence-service";
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
