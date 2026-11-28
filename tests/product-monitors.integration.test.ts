import test from 'node:test';
import assert from 'node:assert/strict';
import {assuranceFixture} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
import {collectConfiguredConnector,saveConnector,executeConnector,claimConnector,nextHostedHour} from '../lib/server/connector-service';
import {productMonitorCommand} from '../lib/server/product-monitor-service';
import {productReads,productTotal} from '../lib/connectors/product-recipes';
import {generateKeyPairSync} from 'node:crypto';
import {jwtVerify} from 'jose';
import {pdAccounts,pdSample,readProduct,pdLink} from '../lib/connectors/pipedream';
import {githubInventoryChecks} from '../lib/connectors/github-inventory-checks';
import {runStagingProductProbe,stagingProbeTarget,stagingProductHistory} from '../lib/server/staging-product-probe';
import {pdConfig,pdProjectHealth} from '../lib/connectors/pipedream-client';
import {profiles,profileFields,type ResourcePolicy} from '../lib/connectors/resource-control';
import {monitoringProduct} from '../lib/connectors/monitoring-product';

const setup=()=>Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ef'.repeat(32),
 REGPILOT_PIPEDREAM_PROJECT_ID:'proj_unitFixture',REGPILOT_PIPEDREAM_CLIENT_ID:'unit-client',REGPILOT_PIPEDREAM_CLIENT_SECRET:'fictional',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});

test('project signing binds the issuer, audience and scope and returns only a verified account count',async()=>{
 setup();
 const previousKey=process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY;
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'}).toString();
 delete process.env.REGPILOT_PIPEDREAM_CLIENT_SECRET;
 try{
  assert.ok(pdConfig());
  const seen=new Set<string>(),codes=new Map<string,string>();
  let wrongProject=false,omitTotal=false;
  const fetcher:typeof fetch=async(input,options)=>{
   const u=new URL(String(input)),headers=new Headers(options?.headers);
   assert.equal(u.origin,'https://api.pipedream.com');
   if(u.pathname==='/v1/oauth/token'){
    const body=JSON.parse(String(options?.body));
    assert.equal(body.client_secret,undefined);
    assert.equal(body.client_assertion_type,'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    const {payload,protectedHeader}=await jwtVerify(body.client_assertion,publicKey,{
     issuer:'unit-client',subject:'unit-client',audience:u.origin,algorithms:['ES256']
    });
    assert.equal(protectedHeader.typ,'client-authentication+jwt');
    assert.equal(payload.exp!-payload.iat!,60);assert.match(payload.jti!,/^[a-f0-9-]{36}$/);
    assert.equal(seen.has(payload.jti!),false);seen.add(payload.jti!);
    codes.set(body.scope,'unit-token-'+seen.size);
    return Response.json({access_token:codes.get(body.scope),expires_in:3600});
   }
   assert.equal(headers.get('x-pd-environment'),'development');
   if(u.pathname==='/v1/connect/projects/proj_unitFixture'){
    assert.equal(headers.get('authorization'),'Bearer '+codes.get('connect:projects:read'));
    return Response.json({id:wrongProject?'proj_wrong':'proj_unitFixture',name:'private project'});
   }
   if(u.pathname.endsWith('/tokens')){
    assert.equal(headers.get('authorization'),'Bearer '+codes.get('connect:tokens:create'));
    const payload=JSON.parse(String(options?.body));
    assert.equal(payload.scope,'connect:accounts:read connect:accounts:write connect:apps:*');
    assert.equal(payload.app_id,'github');
    return Response.json({connect_link_url:'https://pipedream.com/connect/fixture',expires_at:new Date(Date.now()+300000).toISOString()});
   }
   assert.equal(u.pathname,'/v1/connect/proj_unitFixture/accounts');
   assert.equal(u.searchParams.get('include_credentials'),'false');assert.equal(u.searchParams.get('limit'),'1');
   assert.equal(headers.get('authorization'),'Bearer '+codes.get('connect:accounts:read'));
   return Response.json({data:[{name:'private account'}],page_info:omitTotal?{}:{total_count:3}});
  };
  const receipt=await pdProjectHealth(fetcher);
  assert.equal(receipt.accounts,3);assert.deepEqual(Object.keys(receipt).sort(),['accounts','checkedAt','environment']);
  await pdProjectHealth(fetcher);assert.equal(seen.size,2);
  const link=new URL(await pdLink('794e38e1-b6aa-40ab-9b5f-925f87138d6a','github',fetcher));
  assert.equal(link.searchParams.get('app'),'github');assert.equal(link.searchParams.get('oauthScopeProfile'),'read_only');
  assert.equal(seen.size,3);
  wrongProject=true;await assert.rejects(pdProjectHealth(fetcher),(e:{code:string})=>e.code==='TARGET_MISMATCH');
  wrongProject=false;omitTotal=true;await assert.rejects(pdProjectHealth(fetcher),(e:{code:string})=>e.code==='INVALID_RESPONSE');
 }finally{
  if(previousKey)process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY=previousKey;else delete process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY;
  setup();
 }
});
test('GitHub repository policies distinguish missing fields, actual failures and the 180-day boundary',()=>{
 const now=Date.UTC(2026,10,25);
 const source={id:1,disabled:false,archived:false,pushed_at:new Date(now-180*86400000).toISOString(),delete_branch_on_merge:false,
  security_and_analysis:{secret_scanning:{status:'enabled'},secret_scanning_push_protection:{status:'disabled'}}};
 const statuses=(rows:unknown[])=>githubInventoryChecks(rows,now).map(c=>c.status);
 assert.deepEqual(statuses([source]),['PASS','FAIL','FAIL','PASS','FAIL']);
 assert.deepEqual(statuses([{}]),Array(5).fill('UNKNOWN'));
 assert.deepEqual(statuses([]),Array(5).fill('UNKNOWN'));
 assert.deepEqual(statuses([{...source,archived:true},{}]),['UNKNOWN','UNKNOWN','FAIL','UNKNOWN','FAIL']);
 assert.equal(statuses([{...source,pushed_at:new Date(now-180*86400000+1).toISOString()}])[1],'PASS');
 const recipe=productReads.find(r=>r.app==='github'&&r.action==='list-repositories')!;
 setup();const sample=pdSample([source],'794e38e1-b6aa-40ab-9b5f-925f87138d6a',recipe);
 assert.deepEqual(sample.policyChecks?.map(c=>c.status),githubInventoryChecks([source]).map(c=>c.status));
});
test('the GitHub monitor verifies bounded single-repository settings using the same authorised account',async()=>{
 setup();
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',account='apn_detail';
 const recipe=productReads.find(r=>r.app==='github'&&r.action==='list-repositories')!;
 const repos=Array.from({length:5},(_,i)=>({id:i+1,full_name:'owner/repo-'+i,disabled:false}));
 let substitute=false,detailReads=0;
 const fetcher:typeof fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/oauth/token'))return Response.json({access_token:'test-details',expires_in:3600});
  if(url.pathname.endsWith('/accounts')){
   assert.equal(url.searchParams.get('external_user_id'),'regpilot-'+org);
   return Response.json({data:[{id:account,healthy:false,app:{name_slug:'github'}}],page_info:{total_count:1}});
  }
  const body=JSON.parse(String(options?.body));
  assert.equal(body.external_user_id,'regpilot-'+org);assert.equal(body.configured_props.github.authProvisionId,account);
  if(body.id==='github-list-repositories')return Response.json({ret:repos});
  assert.equal(body.id,'github-get-repository');assert.equal(body.version,'0.1.3');detailReads++;
  const row=repos.find(r=>r.full_name===body.configured_props.repoFullname)!;assert.ok(row);
  if(row.id===2)return Response.json({error:'permission denied'},{status:403});
  return Response.json({ret:{...row,id:substitute?10:row.id,delete_branch_on_merge:row.id!==1}});
 };
 const observed=await readProduct(org,account,recipe,fetcher);
 assert.equal(detailReads,4);assert.equal(observed.count,5);
 const policy=observed.policyChecks!.find(p=>p.id==='repository_branch_delete_on_merge_enabled')!;
 assert.equal(policy.status,'FAIL');assert.equal(policy.observed,'2 passed, 1 failed, 2 unknown across 5 repositories.');
 substitute=true;await assert.rejects(readProduct(org,account,recipe,fetcher),(e:{code:string})=>e.code==='TARGET_MISMATCH');
});
test('hosted hourly deadlines retain their UTC minute after a slow read and across midnight',()=>{
 const created=new Date('2026-09-02T07:14:55.123Z');
 assert.equal(nextHostedHour(created,new Date('2026-11-26T05:19:32Z')).toISOString(),'2026-11-26T06:14:00.000Z');
 assert.equal(nextHostedHour(created,new Date('2026-11-26T23:59:59Z')).toISOString(),'2026-11-27T00:14:00.000Z');
});
test('an incomplete hosted grant list cannot falsely revoke a later account',async()=>{
 setup();
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',row=(id:string)=>({id,app:{name_slug:'github'}});
 let failure='';let reads=0;
 const fetcher:typeof fetch=async input=>{
  const u=new URL(String(input));if(u.pathname.endsWith('/oauth/token'))return Response.json({access_token:'page-test',expires_in:300});
  reads++;
  if(!u.searchParams.has('after'))return Response.json({data:[row('apn_first')],page_info:{total_count:2,...(failure==='cursor'?{}:{end_cursor:'next'})}});
  return Response.json({data:[row(failure==='duplicate'?'apn_first':'apn_second')],page_info:failure==='total'?{total_count:3}:{}});
 };
 assert.deepEqual((await pdAccounts(org,'github',fetcher)).map(r=>r.id),['apn_first','apn_second']);assert.equal(reads,2);
 for(failure of ['cursor','duplicate','total'])await assert.rejects(pdAccounts(org,'github',fetcher),(e:{code:string})=>e.code==='INVALID_RESPONSE');
});

test('a mapped product policy detects a settings failure with unchanged inventory and preserves unknown values',()=>{
 setup();
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',product=productReads[0];
 const policy={profile:'supplierPayment' as const,mapping:{verified:'payment.verified',approverId:'approver',requesterId:'requester',paidAt:'paid',approvedAt:'approved'}};
 const payment={payment:{verified:true},approver:'private-approver',requester:'private-requester',paid:'2026-01-02T00:00:00Z',approved:'2026-01-01T00:00:00Z'};
 const sample=(rows:unknown[])=>pdSample(rows,org,product,policy);
 const suggested=pdSample([{id:'p',attributes:{approver_id:'private-name'},approvedAt:'x',payment:{approved_at:'y'},
  'privateCustomer':{requester_id:'private-person'}}],org,product,'supplierPayment').suggestions;
 assert.deepEqual(suggested,{approverId:'attributes.approver_id'});
 const good={...payment,id:'private-payment-a'},bad={...payment,id:'private-payment-b',approver:payment.requester};
 const before=sample([good,bad]),after=sample([{...bad,id:good.id},{...good,id:bad.id}]);
 assert.equal(before.digest,after.digest);assert.notEqual(before.mapped!.digest,after.mapped!.digest);
 assert.notEqual(before.mapped!.checks[1].observed,after.mapped!.checks[1].observed);
 assert.equal(before.mapped!.digest,sample([bad,good]).mapped!.digest);
 assert.deepEqual(before.mapped!.checks.map(r=>r.status),['PASS','FAIL','PASS']);
 assert.equal(sample([{...good,payment:{verified:'yes'}}]).mapped!.checks[0].status,'UNKNOWN');
 assert.equal(sample([]).mapped!.observable,false);
 assert.ok(!JSON.stringify(before).includes('private-'));
});

test('all nine mapped control profiles execute on pinned product samples',()=>{
 setup();
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',product=productReads[0];
 const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
 const fields={mfaEnabled:true,orphaned:false,accessReviewedAt:past,encrypted:true,supported:true,lastSeenAt:past,lastBackupAt:past,
  restoredAt:past,certificateId:'fixture-certificate',validUntil:future,inRange:true,sampledAt:past,approved:true,authorisedReviewer:true,
  reviewerId:'reviewer',authorId:'author',decidedAt:past,modifiedAt:past,approverId:'approver',deployedAt:past,approvedAt:past,
  verified:true,requesterId:'requester',paidAt:past,qualified:true,qualificationExpiresAt:future,operatorId:'operator',
  completed:true,assessed:true,expiresAt:future};
 for(const profile of Object.keys(profiles) as ResourcePolicy['profile'][]){
  const mapping=Object.fromEntries(profileFields(profile).map(field=>[field,'source.'+field]));
  const sample=pdSample([{id:'private-fixture',source:fields}],org,product,{profile,mapping});
  assert.equal(sample.mapped?.observable,true,profile);
  assert.ok(sample.mapped!.checks.every(c=>c.status==='PASS'),profile);
  const missing=pdSample([{id:'private-fixture',source:{}}],org,product,{profile,mapping});
  assert.equal(missing.mapped?.observable,false);assert.ok(missing.mapped!.checks.every(c=>c.status==='UNKNOWN'));
 }
});
test('the staging probe validates its precise grant on both sides of a read and records no source identifiers',async()=>{
 setup();
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',account='apn_probe';
 const recipe=productReads.find(p=>p.app==='github'&&p.action==='list-repositories')!;
 const target={org,account,recipe,scopeHash:'d'.repeat(64),policyRevision:1};
 let flags:{healthy?:boolean;dead?:boolean;error?:string}={healthy:false},calls=0,grants=0,revokeAfter=false;
 const fetcher:typeof fetch=async(input)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/oauth/token'))return Response.json({access_token:'probe-token',expires_in:300});
  if(url.pathname.endsWith('/accounts')){
   assert.equal(url.searchParams.get('external_user_id'),'regpilot-'+org);grants++;
   return Response.json({data:[{id:account,app:{name_slug:'github'},...flags,...(revokeAfter&&grants===2?{dead:true}:{})}],page_info:{total_count:1}});
  }
  calls++;return Response.json({ret:[{id:719,full_name:'private source name'}]});
 };
 const read=await runStagingProductProbe(target,fetcher);
 assert.ok(read.state==='read');assert.equal(read.providerHealth,false);assert.equal(read.count,1);assert.equal(calls,1);assert.equal(grants,2);
 assert.ok(!JSON.stringify(read).includes('private source name')&&!JSON.stringify(read).includes(account));
 const monitored=await readProduct(org,account,recipe,fetcher);assert.equal(monitored.count,1);assert.equal(monitored.digest,read.digest);
 flags={dead:true};const dead=await runStagingProductProbe(target,fetcher);assert.equal(dead.state,'attention');assert.equal(calls,2);
 flags={healthy:false,error:'missing scope private source name'};
 const failed=await runStagingProductProbe(target,fetcher);assert.ok(failed.state==='attention');assert.equal(failed.code,'INSUFFICIENT_SCOPE');assert.equal(calls,2);
 flags={};grants=0;revokeAfter=true;
 const changed=await runStagingProductProbe(target,fetcher);assert.ok(changed.state==='attention');assert.equal(changed.code,'CREDENTIAL_REJECTED');assert.equal(calls,3);
});
test('every published product emits a pinned account-scoped read and keeps provider identifiers private',async()=>{
 setup();assert.ok(productTotal>500);
 const org='794e38e1-b6aa-40ab-9b5f-925f87138d6a',other='b04c640e-4e26-49c9-aca7-1d4273cdba2e';
 for(const product of productReads){
  assert.ok(monitoringProduct('PIPEDREAM_READ',product.family));
  let reads=0,validations=0;
  const fetcher:typeof fetch=async(url,opts)=>{
   const req=new URL(String(url));assert.equal(req.origin,'https://api.pipedream.com');
   if(req.pathname==='/v1/oauth/token')return Response.json({access_token:'fixture-token',expires_in:3000});
   if(req.pathname.endsWith('/accounts')){
    assert.equal(req.pathname,'/v1/connect/proj_unitFixture/accounts');
    assert.equal(req.searchParams.get('external_user_id'),'regpilot-'+org);
    assert.equal(req.searchParams.get('include_credentials'),'false');assert.equal(req.searchParams.get('app'),product.app);validations++;
    return Response.json({data:[{id:'apn_abc123',healthy:true,app:{name_slug:product.app}}],page_info:{total_count:1}});
   }
   assert.equal(req.pathname,'/v1/connect/proj_unitFixture/actions/run');
   assert.deepEqual(JSON.parse(String(opts?.body)),{id:product.app+'-'+product.action,version:product.version,external_user_id:'regpilot-'+org,configured_props:{...(product.app==='github'&&product.action==='list-repositories'?{maxResults:100,sort:'full_name',direction:'asc'}:{}),[product.prop]:{authProvisionId:'apn_abc123'}}});reads++;
   return Response.json({ret:[{label:'private description',value:'customer-inventory-id'}],os:[]});
  };
  const returned=await readProduct(org,'apn_abc123',product,fetcher);
  assert.equal(reads,1);assert.equal(validations,2);assert.equal(returned.count,1);
  assert.match(returned.keys[0],/^[a-f0-9]{64}$/);
  assert.notEqual(pdSample(['customer-inventory-id'],other,product).digest,returned.digest);
 }
});
test('scheduled inventory history is visible only in the authorised workspace and counts actual hours',async()=>{
 setup();const f=await assuranceFixture(),oldEnv=process.env.VERCEL_ENV,oldTarget=process.env.REGPILOT_PIPEDREAM_STAGING_PROBE;
 const ids:string[]=[];
 try{
  process.env.VERCEL_ENV='preview';process.env.REGPILOT_PIPEDREAM_STAGING_PROBE=JSON.stringify({org:f.a.id,account:'apn_history',app:'github',action:'list-repositories'});
  const {scopeHash}=stagingProbeTarget()!;
  const previousHour=Math.floor(Date.now()/3600000)*3600000-3600000;
  for(const [instant,state] of [[previousHour+10000,'read'],[previousHour+20000,'read'],[Date.now()-1,'attention']] as const){
   const time=new Date(instant),receipt=state==='read'?{count:2,digest:'a'.repeat(64),providerHealth:false}:{code:'CREDENTIAL_REJECTED'};
   const row=await db.workerRun.create({data:{invocationKey:'history-'+f.a.id+'-'+instant,startedAt:time,finishedAt:time,leaseUntil:time,state:'COMPLETED',
    summary:{stagingProduct:{scopeHash,state,checkedAt:time.toISOString(),...receipt}}}});
   ids.push(row.id);
  }
  const result=await stagingProductHistory(f.a.id);
  assert.equal(result?.providerHealth,false);assert.equal(result?.previousDay.missing.length,24-result!.previousDay.hours);
  assert.equal(result?.reads,2);assert.equal(result?.hours,1);assert.equal(result?.count,2);assert.equal(result?.latestError,'CREDENTIAL_REJECTED');
  assert.equal(await stagingProductHistory(f.b.id),null);assert.ok(!JSON.stringify(result).includes(scopeHash));
 }finally{
  if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
  if(oldTarget===undefined)delete process.env.REGPILOT_PIPEDREAM_STAGING_PROBE;else process.env.REGPILOT_PIPEDREAM_STAGING_PROBE=oldTarget;
  await db.workerRun.deleteMany({where:{id:{in:ids}}});await f.cleanup();
 }
});
test('an hourly product monitor rejects another tenant, detects inventory drift and recovers the original grant for the same control',async()=>{
 setup();const f=await assuranceFixture(),original=globalThis.fetch;
 const product=productReads[0],desired={app:product.app,action:product.action},account='apn_fictionalA';
 let healthy=true,updatedAt=new Date(0).toISOString(),rows:Record<string,unknown>[]=[{id:'account-resource-a'}];
 globalThis.fetch=async(url,options)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/oauth/token'))return Response.json({access_token:'fixture-token',expires_in:3000});
  if(path.endsWith('/accounts')){
   const match=new URL(String(url)).searchParams.get('external_user_id')==='regpilot-'+f.a.id;
   return Response.json({data:match?[{id:account,healthy,updated_at:updatedAt,app:{name_slug:product.app}}]:[],page_info:{total_count:match?1:0}});
  }
  if(path.endsWith('/tokens'))return Response.json({connect_link_url:'https://pipedream.com/_static/connect.html?token=fixture',expires_at:new Date(Date.now()+300000).toISOString()});
  assert.equal(path,'/v1/connect/proj_unitFixture/actions/run');
  assert.equal(JSON.parse(String(options?.body)).external_user_id,'regpilot-'+f.a.id);
  if(!healthy)return Response.json({error:{message:'Bad credentials'}});
  return Response.json({ret:rows});
 };
 try{
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'inventory',title:'Customer inventory',description:'Approved sample',testProcedure:'Read account',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const call=(op:string,extra:object={})=>productMonitorCommand(f.o,{op,...desired,account,...extra});
  const preview=await call('PREVIEW');
  assert.ok('digest' in preview);
  await assert.rejects(productMonitorCommand(f.out,{op:'PREVIEW',...desired,account}));
  const approve={controlId:control.id,consent:true,digest:preview.digest};
  const saved=await call('APPROVE',approve);assert.ok('id' in saved&&'version' in saved);
  assert.deepEqual(await call('APPROVE',approve),saved);
  const monitor=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});
  assert.equal(monitor.intervalHours,1);assert.equal(monitor.encryptedSecret,null);
  await assert.rejects(collectConfiguredConnector({...monitor,organizationId:f.b.id},''));
  async function scheduled(){
   const now=Date.now();const current=await db.evidenceConnector.findUniqueOrThrow({where:{id:monitor.id}});
   await db.evidenceConnector.update({where:{id:monitor.id},data:{nextRunAt:new Date(now-1000),...(current.lastSuccessAt?{lastSuccessAt:new Date(now-3602000)}:{})}});
   const job=await claimConnector();assert.equal(job?.id,monitor.id);
   return executeConnector(job!);
  }
  assert.equal(await scheduled(),'OBSERVED');
  rows=[{id:'account-resource-b'}];assert.equal(await scheduled(),'FOLLOW_UP');
  await assert.rejects(call('APPROVE',approve));
  healthy=false;await scheduled();
  const failed=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});
  assert.equal(failed.failureCode,'CREDENTIAL_REJECTED');assert.equal(failed.enabled,false);
  await assert.rejects(saveConnector(f.o,{provider:monitor.provider,scope:desired.app,record:desired.action,reference:monitor.branch,id:monitor.id,version:failed.version,controlId:control.id,consent:true,enabled:true,intervalHours:1}));
  const renew=await productMonitorCommand(f.o,{op:'START_RENEWAL',id:monitor.id,version:failed.version});assert.ok('requestId' in renew);
  const verify={op:'VERIFY_RENEWAL',id:monitor.id,version:failed.version,requestId:renew.requestId};
  await assert.rejects(productMonitorCommand(f.o,verify));healthy=true;
  await assert.rejects(productMonitorCommand(f.o,verify));await new Promise(r=>setTimeout(r,12));updatedAt=new Date().toISOString();
  rows=[{id:'account-resource-a'}];
  const renewed=await productMonitorCommand(f.o,verify);assert.ok('version' in renewed);assert.equal(renewed.version,failed.version+1);
  assert.equal(await scheduled(),'OBSERVED');
  assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),3);
  const policy={profile:'endpoint',mapping:{encrypted:'disk.encrypted',supported:'supported',lastSeenAt:'lastSeen'}};
  rows=[{id:'account-resource-a',disk:{encrypted:true},supported:true,lastSeen:new Date().toISOString()}];
  const mapped=await call('PREVIEW',{policy});assert.ok('reviewDigest' in mapped&&mapped.reviewDigest&&mapped.observable);
  const approval={...approve,policy,reviewDigest:mapped.reviewDigest};
  rows[0].supported=false;await assert.rejects(call('APPROVE',approval));
  rows[0].supported=true;
  const configured=await call('APPROVE',approval);assert.ok('id' in configured&&configured.id!==saved.id);
  const bound=await db.evidenceConnector.findUniqueOrThrow({where:{id:configured.id}});
  const collect=()=>collectConfiguredConnector(bound,'');
  const check=(o:Awaited<ReturnType<typeof collect>>,field:string)=>o.checks.find(c=>c.id==='mapped-endpoint-'+field)?.status;
  assert.equal(check(await collect(),'encrypted'),'PASS');
  rows[0].disk={encrypted:false};assert.equal(check(await collect(),'encrypted'),'FAIL');
  delete rows[0].disk;assert.equal(check(await collect(),'encrypted'),'UNKNOWN');
  const incomplete=await call('PREVIEW',{policy});assert.ok('observable' in incomplete&&!incomplete.observable);
  await assert.rejects(call('APPROVE',{...approval,reviewDigest:incomplete.reviewDigest}));
  // Exercise the deployed clock's ordinary dispatch path against the disposable provider.
  const {runDatabaseWorker}=await import('../lib/server/worker-runtime');
  const environment={...process.env},bucket=Math.floor(Date.now()/6)*6;
  const dueKeys=[bucket,bucket+2].map(n=>'dbclock:'+n);
  try{
   Object.assign(process.env,{VERCEL_ENV:'preview',REGPILOT_WORKER_ENABLED:'true',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_WORKER_SLOTS:'1'});
   delete process.env.REGPILOT_PIPEDREAM_STAGING_PROBE;
   rows[0].disk={encrypted:false};delete rows[0].supported;
   const previousRead=new Date(Date.now()-2*3600000);
   await db.evidenceConnector.update({where:{id:bound.id},data:{lastSuccessAt:previousRead,nextRunAt:nextHostedHour(bound.createdAt,previousRead)}});
   await db.evidenceConnector.update({where:{id:saved.id},data:{intervalHours:24,nextRunAt:new Date(0)}});
   const first=await runDatabaseWorker(bucket);
   assert.equal(first.status,200);assert.equal(first.body.state,'queue_only');
   const worker=await db.workerRun.findUniqueOrThrow({where:{invocationKey:dueKeys[0]}});
   assert.deepEqual((worker.summary as any).hostedQueue.outcomes,{FOLLOW_UP:1});
   const observation=await db.connectorRun.findFirstOrThrow({where:{connectorId:bound.id}});
   assert.ok((observation.result as any).checks.some((c:{id:string;status:string})=>c.id==='mapped-endpoint-encrypted'&&c.status==='FAIL'));
   const receipt=await db.auditEvent.findFirstOrThrow({where:{entityId:bound.id,action:'connector.evidence_collected'}});
   assert.equal((receipt.details as any).collectionMode,'SCHEDULED');
   const {monitoringCalendar}=await import('../lib/server/monitoring-calendar');
   const {connectorScopeHash}=await import('../lib/server/connector-verification');
   const calendar=await db.$transaction(tx=>monitoringCalendar(tx,f.a.id,bound.id,bound.provider,connectorScopeHash(bound),Date.now()+86400000));
   const sourceAt=new Date((observation.result as any).capturedAt);
   const day=calendar.hourly!.find(d=>d.date===sourceAt.toISOString().slice(0,10))!;
   assert.equal(day.observedHours,1);assert.equal(day.partial,1);assert.equal(day.withFailures,1);assert.equal(day.missing.length,23);
   assert.ok(!day.missing.includes(sourceAt.getUTCHours()));assert.equal(calendar.observedDays7,0);
   const next=await db.evidenceConnector.findUniqueOrThrow({where:{id:bound.id}});
   assert.equal(next.nextRunAt.toISOString(),nextHostedHour(bound.createdAt,next.lastSuccessAt!).toISOString());
   assert.equal((await runDatabaseWorker(bucket)).body.reused,true);
   assert.equal((await runDatabaseWorker(bucket+2)).status,200);
   assert.equal(await db.connectorRun.count({where:{connectorId:bound.id}}),1);
   assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}})).nextRunAt.getTime(),0);
   const list=await call('SCHEDULES');assert.ok('schedules' in list);assert.deepEqual(list.schedules.map(row=>row.id),[bound.id]);
   assert.equal(list.schedules[0].state,'Scheduled');
   const outside=await productMonitorCommand(f.out,{op:'SCHEDULES'});assert.ok('schedules' in outside&&!outside.schedules.length);
  }finally{
   await db.workerRun.deleteMany({where:{invocationKey:{in:dueKeys}}});
   for(const k of Object.keys(process.env))if(!(k in environment))delete process.env[k];
   Object.assign(process.env,environment);
  }

 }finally{globalThis.fetch=original;await f.cleanup();}
});
