import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {db} from '../lib/server/db';
import {configureConnectorWebhook,receiveConnectorWebhook,pruneWebhookReceipts} from '../lib/server/connector-webhooks';
import {claimConnector,executeConnector,disconnectConnector} from '../lib/server/connector-service';
import {encryptConnectorSecret} from '../lib/server/connector-secret';
import {acquireProviderPermit,settleProviderPermit} from '../lib/server/provider-gate';
import {operationsWorkspace} from '../lib/server/operations-service';
import type {AuthorizedContext} from '../lib/server/authorization';
import type {GithubObservation} from '../lib/connectors/github';
import type {WebhookProvider} from '../lib/connectors/webhook-signature';

async function fixture(){
 const env={...process.env},marker=randomUUID();
 const user=await db.user.create({data:{externalId:marker,email:marker+'@example.invalid'}});
 const orgs=await Promise.all([0,1].map(()=>db.organization.create({data:{name:'Synthetic webhook '+randomUUID()}})));
 const ids=orgs.map(o=>o.id),ctx:AuthorizedContext={organizationId:ids[0],userId:user.id,role:'OWNER'};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_WEBHOOKS_ENABLED:'true',REGPILOT_GITLAB_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:user.email,REGPILOT_CONNECTOR_ENCRYPTION_KEY:'fe'.repeat(32),NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture'});
 await db.membership.createMany({data:ids.map(organizationId=>({organizationId,userId:user.id,role:'OWNER'}))});
 const connectors=[];
 for(const organizationId of ids){
  const p=await db.programmeImport.create({data:{organizationId,createdById:user.id,inputHash:randomUUID(),method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const c=await db.managedControl.create({data:{organizationId,importId:p.id,proposalKey:'synthetic',title:'Synthetic control',description:'Test',testProcedure:'Test',theme:'security',ownerId:user.id,scheduledById:user.id,intervalDays:30,nextReviewAt:new Date()}});
  for(const provider of ['GITHUB','GITLAB']){
   const id=randomUUID();
   connectors.push(await db.evidenceConnector.create({data:{id,organizationId,controlId:c.id,configuredById:user.id,provider,repository:(provider==='GITLAB'?'gitlab:':'')+'synthetic/project',branch:'main',encryptedSecret:encryptConnectorSecret('synthetic-credential-never-sent',organizationId,id),enabled:true,nextRunAt:new Date(Date.now()+86400000)}}));
  }
 }
 return {ctx,ids,user,connectors,async cleanup(){
  const where={organizationId:{in:ids}};
  await db.connectorRun.deleteMany({where});await db.obligation.deleteMany({where});await db.auditEvent.deleteMany({where});
  await db.evidenceConnector.deleteMany({where});await db.managedControl.deleteMany({where});await db.programmeImport.deleteMany({where});
  await db.membership.deleteMany({where});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.delete({where:{id:user.id}});
  await db.providerGate.deleteMany();
  for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);
 }};
}
function request(provider:WebhookProvider,secret:string,n:number,options:{id?:string;repository?:string;branch?:string;body?:string}={}){
 const id=options.id||randomUUID(),repository=options.repository||'synthetic/project',branch=options.branch||'main';
 const body=options.body||JSON.stringify(provider==='GITHUB'?{repository:{full_name:repository},ref:'refs/heads/'+branch,after:String(n),private_marker:'payload-never-stored'}:{project:{path_with_namespace:repository},object_kind:'push',ref:'refs/heads/'+branch,after:String(n),private_marker:'payload-never-stored'});
 const headers:Record<string,string>={'content-type':'application/json'};
 if(provider==='GITHUB')Object.assign(headers,{'x-github-delivery':id,'x-github-event':'push','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')});
 else{const stamp=String(Math.floor(Date.now()/1000));Object.assign(headers,{'webhook-id':id,'webhook-timestamp':stamp,'x-gitlab-event':'Push Hook','webhook-signature':'v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+stamp+'.'+body).digest('base64')});}
 return new Request('https://fixture.invalid/events',{method:'POST',body,headers});
}
const observation=():GithubObservation=>({engine:'github-branch-2.0.0',repository:'synthetic/project',branch:'main',sourceUrl:'https://github.com/synthetic/project',capturedAt:new Date().toISOString(),checks:[{id:'peer-review',label:'Synthetic check',status:'PASS',observed:'Synthetic value',nextStep:'Review'}],limitations:['Synthetic provider fixture']});

test('signed event burst is deduplicated, tenant-bound and coalesced without storing payloads',async t=>{
 const f=await fixture(),c=f.connectors[0];
 try{
  const config=await configureConnectorWebhook(f.ctx,c.id,{version:1,enabled:true});assert.ok(config.secret);
  const delivery=randomUUID(),start=performance.now();
  const duplicates=await Promise.all(Array.from({length:20},()=>receiveConnectorWebhook(request('GITHUB',config.secret!,1,{id:delivery}),'GITHUB',c.id)));
  assert.equal(duplicates.filter(r=>!r.duplicate).length,1);
  assert.equal((await receiveConnectorWebhook(request('GITHUB',config.secret,1),'GITHUB',c.id)).duplicate,true,'changed unsigned ID cannot replay identical payload');
  for(let offset=0;offset<500;offset+=10){
   await Promise.all(Array.from({length:10},(_,i)=>receiveConnectorWebhook(request('GITHUB',config.secret!,offset+i+2),'GITHUB',c.id)));
  }
  const row=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});
  assert.equal(row.eventRevision,501);assert.equal(row.attempts,0);assert.equal(row.leaseToken,null);
  assert.ok(row.nextRunAt.getTime()<=Date.now()+60000);
  assert.equal(await db.webhookReceipt.count({where:{connectorId:c.id}}),501);
  assert.equal(await db.connectorRun.count({where:{connectorId:c.id}}),0,'events queue reads, never fabricate evidence');
  assert.doesNotMatch(JSON.stringify(await db.webhookReceipt.findMany({where:{connectorId:c.id}})),/payload-never-stored|synthetic\/project/);
  await assert.rejects(()=>receiveConnectorWebhook(request('GITHUB',config.secret!,999,{id:delivery}),'GITHUB',c.id),(e:any)=>e.status===409);
  await assert.rejects(()=>receiveConnectorWebhook(request('GITHUB',config.secret!,1000,{repository:'outside/project'}),'GITHUB',c.id),(e:any)=>e.status===403);
  const other=await configureConnectorWebhook({...f.ctx,organizationId:f.ids[1]},f.connectors[2].id,{version:1,enabled:true});
  await assert.rejects(()=>receiveConnectorWebhook(request('GITHUB',config.secret!,1000),'GITHUB',other.id),(e:any)=>e.status===401);
  await assert.rejects(()=>configureConnectorWebhook({...f.ctx,organizationId:f.ids[1]},c.id,{version:2,enabled:false}));
  const workspace=await operationsWorkspace(f.ctx);assert.doesNotMatch(JSON.stringify(workspace),/encryptedWebhookSecret|"secret"|payload-never-stored/);
  t.diagnostic('webhook burst benchmark '+JSON.stringify({deliveries:521,uniqueReceipts:501,collectionJobs:1,durationMs:Math.round(performance.now()-start)}));
 }finally{await f.cleanup();}
});

test('events arriving during collection remain pending; provider cooldown and capacity cannot be bypassed by events',async()=>{
 const f=await fixture(),c=f.connectors[0];
 try{
  const config=await configureConnectorWebhook(f.ctx,c.id,{version:1,enabled:true});
  await receiveConnectorWebhook(request('GITHUB',config.secret!,1),'GITHUB',c.id);
  const due=()=>db.evidenceConnector.update({where:{id:c.id},data:{nextRunAt:new Date(0)}});
  await due();const job=await claimConnector();assert.ok(job);assert.equal(job.id,c.id);assert.equal(job.eventRevision,1);
  assert.equal(await executeConnector(job,async()=>{
   await receiveConnectorWebhook(request('GITHUB',config.secret!,2),'GITHUB',c.id);return observation();
  }),'OBSERVED');
  let current=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});
  assert.equal(current.eventRevision,2);assert.equal(current.collectedEventRevision,1);assert.ok(current.nextRunAt.getTime()<Date.now()+61000);
  await due();assert.equal(await executeConnector((await claimConnector())!,async()=>observation()),'OBSERVED');
  current=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});assert.equal(current.collectedEventRevision,2);assert.ok(current.nextRunAt.getTime()>Date.now()+23*3600000);
  const cooldown=new Date(Date.now()+7200000);
  await db.evidenceConnector.update({where:{id:c.id},data:{failureCode:'RATE_LIMITED',nextRunAt:cooldown}});
  await receiveConnectorWebhook(request('GITHUB',config.secret!,3),'GITHUB',c.id);
  assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}})).nextRunAt.getTime(),cooldown.getTime());
  const permits=await Promise.all(Array.from({length:4},()=>acquireProviderPermit('GITHUB',randomUUID())));assert.ok(permits.every(p=>p.allowed));
  await due();let calls=0;
  assert.equal(await executeConnector((await claimConnector())!,async()=>{calls++;return observation();}),'PROVIDER_DEFERRED');
  assert.equal(calls,0);current=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});assert.equal(current.attempts,0);assert.equal(current.eventRevision,3);assert.equal(current.collectedEventRevision,2);
  await Promise.all(permits.map(p=>p.allowed?settleProviderPermit(p.permit,'SUCCESS'):Promise.resolve()));
  await due();assert.equal(await executeConnector((await claimConnector())!,async()=>observation()),'OBSERVED');
  assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}})).collectedEventRevision,3);
 }finally{await f.cleanup();}
});

test('GitLab signing, secret rotation, permission revocation and bounded retention remain enforced',async()=>{
 const f=await fixture(),c=f.connectors[1];
 try{
  const config=await configureConnectorWebhook(f.ctx,c.id,{version:1,enabled:true});assert.ok(config.secret?.startsWith('whsec_'));
  assert.equal((await receiveConnectorWebhook(request('GITLAB',config.secret!,1),'GITLAB',c.id)).accepted,true);
  const rotated=await configureConnectorWebhook(f.ctx,c.id,{version:2,enabled:true});
  await assert.rejects(()=>receiveConnectorWebhook(request('GITLAB',config.secret!,2),'GITLAB',c.id),(e:any)=>e.status===401);
  assert.equal((await receiveConnectorWebhook(request('GITLAB',rotated.secret!,2),'GITLAB',c.id)).accepted,true);
  await db.membership.update({where:{organizationId_userId:{organizationId:f.ctx.organizationId,userId:f.user.id}},data:{role:'VIEWER'}});
  await assert.rejects(()=>receiveConnectorWebhook(request('GITLAB',rotated.secret!,3),'GITLAB',c.id),(e:any)=>e.status===403);
  await assert.rejects(()=>configureConnectorWebhook(f.ctx,c.id,{version:3,enabled:false}),(e:any)=>e.status===403);
  await db.membership.update({where:{organizationId_userId:{organizationId:f.ctx.organizationId,userId:f.user.id}},data:{role:'OWNER'}});
  await db.webhookReceipt.updateMany({where:{connectorId:c.id},data:{receivedAt:new Date(0)}});
  assert.equal(await pruneWebhookReceipts(),2);
  await disconnectConnector(f.ctx,c.id,3);
  assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}})).encryptedWebhookSecret,null);
  await assert.rejects(()=>receiveConnectorWebhook(request('GITLAB',rotated.secret!,4),'GITLAB',c.id),(e:any)=>e.status===401);
  assert.equal(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:f.ctx.organizationId}})).includes(rotated.secret!),false);
 }finally{await f.cleanup();}
});
