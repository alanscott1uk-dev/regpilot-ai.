import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {db} from '../lib/server/db';
import {acquireProviderPermit,settleProviderPermit,providerGateHealth} from '../lib/server/provider-gate';
const providers=['GITHUB','MICROSOFT365','GOOGLE_WORKSPACE','GITLAB','CLOUDFLARE','COMPANIES_HOUSE','VERCEL','SUPABASE'];
async function admitted(provider:string,scope=randomUUID()){
 const result=await acquireProviderPermit(provider,scope);assert.ok(result.allowed);return result.permit;
}
test('configured capacity isolates busy workspaces, drains safely on reduction and keeps a single recovery probe',async()=>{
 const before=process.env.REGPILOT_PROVIDER_LIMITS;
 await db.providerGate.deleteMany();
 const configure=(maxConcurrent:number,perWorkspace:number)=>{process.env.REGPILOT_PROVIDER_LIMITS=JSON.stringify({GITHUB:{maxConcurrent,perWorkspace}});};
 try{
  configure(6,2);
  const busy=randomUUID();
  const attempts=await Promise.all(Array.from({length:12},()=>acquireProviderPermit('GITHUB',busy)));
  const first=attempts.flatMap(r=>r.allowed?[r.permit]:[]);
  assert.equal(first.length,2,'one customer cannot consume the whole provider allowance');
  const others=await Promise.all(Array.from({length:12},()=>acquireProviderPermit('GITHUB',randomUUID())));
  const rest=others.flatMap(r=>r.allowed?[r.permit]:[]);assert.equal(rest.length,4);
  assert.equal(await db.providerPermit.count({where:{provider:'GITHUB'}}),6);
  const health=(await providerGateHealth(['GITHUB','SUPABASE']));
  assert.equal(health[0].maxConcurrent,6);assert.equal(health[0].perWorkspace,2);assert.equal(health[1].maxConcurrent,4);
  configure(2,1);
  assert.equal((await acquireProviderPermit('GITHUB',randomUUID())).allowed,false);
  await Promise.all([...first,...rest].slice(0,5).map(p=>settleProviderPermit(p,'SUCCESS')));
  const replacement=await admitted('GITHUB');
  assert.equal((await acquireProviderPermit('GITHUB',randomUUID())).allowed,false);
  await settleProviderPermit(rest[3],'SUCCESS');await settleProviderPermit(replacement,'SUCCESS');
  configure(8,2);
  for(let i=0;i<3;i++)await settleProviderPermit(await admitted('GITHUB'),'PROVIDER_UNAVAILABLE');
  await db.providerGate.update({where:{provider:'GITHUB'},data:{openUntil:new Date(0)}});
  const probes=await Promise.all(Array.from({length:16},()=>acquireProviderPermit('GITHUB',randomUUID())));
  const allowed=probes.flatMap(r=>r.allowed?[r.permit]:[]);assert.equal(allowed.length,1,'larger capacity never multiplies outage probes');
  await settleProviderPermit(allowed[0],'SUCCESS');
  const scaled=await Promise.all(Array.from({length:16},()=>acquireProviderPermit('GITHUB',randomUUID())));
  const live=scaled.flatMap(r=>r.allowed?[r.permit]:[]);assert.equal(live.length,8);
  await Promise.all(live.map(p=>settleProviderPermit(p,'SUCCESS')));
  assert.equal(await db.providerPermit.count(),0);
  process.env.REGPILOT_PROVIDER_LIMITS='{"GITHUB":{"maxConcurrent":100,"perWorkspace":1}}';
  await assert.rejects(()=>acquireProviderPermit('GITHUB',randomUUID()));assert.equal(await db.providerPermit.count(),0);
 }finally{
  if(before===undefined)delete process.env.REGPILOT_PROVIDER_LIMITS;else process.env.REGPILOT_PROVIDER_LIMITS=before;
  await db.providerGate.deleteMany();
 }
});
test('distributed provider limits hold across 1,280 concurrent admission attempts without blocking unrelated providers',async t=>{
 await db.providerGate.deleteMany();const started=performance.now();let allowed=0,deferred=0;
 try{
  for(let round=0;round<10;round++){
   const results=await Promise.all(providers.flatMap(provider=>Array.from({length:16},()=>acquireProviderPermit(provider,randomUUID()))));
   const permits=results.flatMap(r=>r.allowed?[r.permit]:[]);allowed+=permits.length;deferred+=results.length-permits.length;
   assert.equal(permits.length,32);
   for(const provider of providers)assert.equal(permits.filter(p=>p.provider===provider).length,4);
   await Promise.all(permits.map(p=>settleProviderPermit(p,'SUCCESS')));
   assert.equal(await db.providerPermit.count(),0);
  }
  t.diagnostic('provider admission benchmark '+JSON.stringify({attempts:1280,allowed,deferred,providers:8,maxConcurrentPerProvider:4,durationMs:Math.round(performance.now()-started)}));
 }finally{await db.providerGate.deleteMany();}
});
test('one failing workspace, credential errors and tenant quotas never open a shared circuit',async()=>{
 const scope=randomUUID();await db.providerGate.deleteMany();
 try{
  for(let i=0;i<6;i++)await settleProviderPermit(await admitted('GITHUB',scope),'PROVIDER_UNAVAILABLE');
  assert.equal((await providerGateHealth(['GITHUB']))[0].state,'closed');
  for(const code of ['CREDENTIAL_REJECTED','RATE_LIMITED','ACCESS_OR_RATE_LIMIT','NEUTRAL'])await settleProviderPermit(await admitted('GITHUB'),code);
  assert.equal((await providerGateHealth(['GITHUB']))[0].state,'closed');
  assert.equal((await db.providerGate.findUniqueOrThrow({where:{provider:'GITHUB'}})).failures,1);
 }finally{await db.providerGate.deleteMany();}
});
test('cross-workspace outages open circuits; recovery uses one probe and fences crashed or stale workers',async()=>{
 await db.providerGate.deleteMany();
 try{
  const late=await admitted('GITHUB');
  for(let i=0;i<3;i++)await settleProviderPermit(await admitted('GITHUB'),'PROVIDER_UNAVAILABLE');
  assert.equal((await acquireProviderPermit('GITHUB',randomUUID())).allowed,false);
  await settleProviderPermit(late,'SUCCESS');
  assert.equal((await providerGateHealth(['GITHUB']))[0].state,'open','late healthy result cannot close a new circuit');
  await settleProviderPermit(await admitted('GITLAB'),'SUCCESS');
  await db.providerGate.update({where:{provider:'GITHUB'},data:{openUntil:new Date(0)}});
  const probes=await Promise.all(Array.from({length:32},()=>acquireProviderPermit('GITHUB',randomUUID())));
  const first=probes.flatMap(r=>r.allowed?[r.permit]:[]);assert.equal(first.length,1);assert.equal(first[0].probe,true);
  await db.providerPermit.update({where:{token:first[0].token},data:{expiresAt:new Date(0)}});
  await db.providerGate.update({where:{provider:'GITHUB'},data:{probeUntil:new Date(0)}});
  const recovered=await admitted('GITHUB');assert.notEqual(recovered.generation,first[0].generation);
  await settleProviderPermit(first[0],'SUCCESS');assert.equal((await providerGateHealth(['GITHUB']))[0].state,'probing');
  await settleProviderPermit(recovered,'PROVIDER_TIMEOUT');
  const reopened=await db.providerGate.findUniqueOrThrow({where:{provider:'GITHUB'}});
  assert.equal(reopened.trips,2);assert.ok(reopened.openUntil!.getTime()>Date.now()+110000);
  await db.providerGate.update({where:{provider:'GITHUB'},data:{openUntil:new Date(0)}});
  await settleProviderPermit(await admitted('GITHUB'),'SUCCESS');
  assert.equal((await providerGateHealth(['GITHUB']))[0].state,'closed');
  assert.equal(await db.providerPermit.count({where:{provider:'GITHUB'}}),0);
 }finally{await db.providerGate.deleteMany();}
});
test('crashed normal permits expire and old completion cannot remove a replacement permit',async()=>{
 await db.providerGate.deleteMany();
 try{
  const crashed=await Promise.all(Array.from({length:4},()=>admitted('SUPABASE')));
  assert.equal((await acquireProviderPermit('SUPABASE',randomUUID())).allowed,false);
  await db.providerPermit.updateMany({where:{provider:'SUPABASE'},data:{expiresAt:new Date(0)}});
  const recovered=await admitted('SUPABASE');
  await Promise.all(crashed.map(p=>settleProviderPermit(p,'PROVIDER_UNAVAILABLE')));
  assert.equal(await db.providerPermit.count({where:{token:recovered.token}}),1);
  await settleProviderPermit(recovered,'SUCCESS');
  assert.equal((await providerGateHealth(['SUPABASE']))[0].state,'closed');
 }finally{await db.providerGate.deleteMany();}
});
