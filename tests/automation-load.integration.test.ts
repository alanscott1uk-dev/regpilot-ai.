import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {db} from '../lib/server/db';
import {claimAutomationEvent} from '../lib/server/automation-queue';
import {releaseDispatchLease} from '../lib/server/fair-dispatch';
import {hashValue} from '../lib/regulatory/intelligence';
test('100,000 durable automation events: 16 claimers preserve fairness across 250 workspaces without duplicate delivery',async t=>{
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ab'.repeat(32),SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
 const marker=randomUUID(),user=await db.user.create({data:{externalId:marker,email:marker+'@example.invalid'}});
 process.env.REGPILOT_AI_ALLOWED_EMAILS=user.email;
 const rows=Array.from({length:250},()=>({organizationId:randomUUID(),programmeId:randomUUID(),controlId:randomUUID(),connectorId:randomUUID()}));
 const orgs=rows.map(r=>r.organizationId),where={organizationId:{in:orgs}},latencies:number[]=[],seen=new Set<string>();
 try{
  await db.organization.createMany({data:rows.map(r=>({id:r.organizationId,name:'Synthetic outbox '+r.organizationId}))});
  await db.programmeImport.createMany({data:rows.map(r=>({id:r.programmeId,organizationId:r.organizationId,createdById:user.id,inputHash:r.organizationId,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}))});
  await db.managedControl.createMany({data:rows.map(r=>({id:r.controlId,organizationId:r.organizationId,importId:r.programmeId,proposalKey:'outbox-load',title:'Synthetic control',description:'Fixture',testProcedure:'Fixture',theme:'security',ownerId:user.id,scheduledById:user.id,intervalDays:30,nextReviewAt:new Date()}))});
  await db.evidenceConnector.createMany({data:rows.map(r=>({id:r.connectorId,organizationId:r.organizationId,controlId:r.controlId,configuredById:user.id,repository:'fixture/'+r.organizationId,branch:'main'}))});
  const records=rows.flatMap((r,i)=>Array.from({length:400},(_,n)=>({organizationId:r.organizationId,connectorId:r.connectorId,eventKey:hashValue({id:r.connectorId,n}),kind:'CONNECTOR_FAILED',configVersion:1,fingerprint:hashValue('fixture'),reasonCode:'FIXTURE',availableAt:new Date(0),createdAt:new Date(i)})));
  for(let i=0;i<records.length;i+=1000)await db.automationEvent.createMany({data:records.slice(i,i+1000)});
  assert.equal(await db.dispatchLane.count({where:{...where,kind:'AUTOMATION'}}),250);
  for(let round=0;round<10;round++){
   const served=new Set<string>();
   while(served.size<250){
    const events=await Promise.all(Array.from({length:Math.min(16,250-served.size)},async()=>{const start=performance.now(),event=await claimAutomationEvent();latencies.push(performance.now()-start);assert.ok(event);return event;}));
    for(const event of events){assert.equal(seen.has(event.id),false);seen.add(event.id);assert.equal(served.has(event.organizationId),false);served.add(event.organizationId);}
    const active=await db.automationEvent.groupBy({by:['organizationId'],where:{...where,state:'PROCESSING'},_count:{id:true}});assert.ok(active.every(g=>g._count.id===1));
    // This benchmark measures dispatch, not provider throughput or reaction execution.
    await db.automationEvent.updateMany({where:{id:{in:events.map(e=>e.id)}},data:{state:'DONE',leaseToken:null,leaseUntil:null,finishedAt:new Date()}});
    await Promise.all(events.map(e=>releaseDispatchLease('AUTOMATION',e)));
   }
  }
  assert.equal(seen.size,2500);assert.equal(await db.automationEvent.count({where:{...where,state:'PENDING'}}),97500);
  latencies.sort((a,b)=>a-b);const metrics={queuedEvents:100000,workspaces:250,concurrency:16,claims:seen.size,p50Ms:Math.round(latencies[Math.floor(latencies.length*.5)]),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),maxMs:Math.round(latencies.at(-1)!)};
  t.diagnostic('automation dispatch benchmark '+JSON.stringify(metrics));assert.ok(metrics.p95Ms<2000,'CI dispatch regression budget');
 }finally{
  await db.evidenceConnector.deleteMany({where});await db.managedControl.deleteMany({where});await db.programmeImport.deleteMany({where});
  await db.organization.deleteMany({where:{id:{in:orgs}}});await db.user.delete({where:{id:user.id}});
 }
});
