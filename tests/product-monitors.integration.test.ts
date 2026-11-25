import test from 'node:test';
import assert from 'node:assert/strict';
import {assuranceFixture} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
import {collectConfiguredConnector,saveConnector,executeConnector,claimConnector} from '../lib/server/connector-service';
import {productMonitorCommand} from '../lib/server/product-monitor-service';
import {productReads,productTotal} from '../lib/connectors/product-recipes';
import {generateKeyPairSync} from 'node:crypto';
import {jwtVerify} from 'jose';
import {pdSample,readProduct,pdLink} from '../lib/connectors/pipedream';
import {pdConfig,pdProjectHealth} from '../lib/connectors/pipedream-client';
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
  await pdLink('794e38e1-b6aa-40ab-9b5f-925f87138d6a','github',fetcher);assert.equal(seen.size,3);
  wrongProject=true;await assert.rejects(pdProjectHealth(fetcher),(e:{code:string})=>e.code==='TARGET_MISMATCH');
  wrongProject=false;omitTotal=true;await assert.rejects(pdProjectHealth(fetcher),(e:{code:string})=>e.code==='INVALID_RESPONSE');
 }finally{
  if(previousKey)process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY=previousKey;else delete process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY;
  setup();
 }
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
test('an hourly product monitor rejects another tenant, detects inventory drift and recovers the original grant for the same control',async()=>{
 setup();const f=await assuranceFixture(),original=globalThis.fetch;
 const product=productReads[0],desired={app:product.app,action:product.action},account='apn_fictionalA';
 let healthy=true,updatedAt=new Date(0).toISOString(),rows=[{id:'account-resource-a'}];
 globalThis.fetch=async(url,options)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/oauth/token'))return Response.json({access_token:'fixture-token',expires_in:3000});
  if(path.endsWith('/accounts')){
   const match=new URL(String(url)).searchParams.get('external_user_id')==='regpilot-'+f.a.id;
   return Response.json({data:match?[{id:account,healthy,updated_at:updatedAt,app:{name_slug:product.app}}]:[],page_info:{total_count:match?1:0}});
  }
  if(path.endsWith('/tokens'))return Response.json({connect_link_url:'https://pipedream.com/_static/connect.html?token=fixture',expires_at:new Date(Date.now()+300000).toISOString()});
  assert.equal(path,'/v1/connect/proj_unitFixture/actions/run');
  assert.equal(JSON.parse(String(options?.body)).external_user_id,'regpilot-'+f.a.id);return Response.json({ret:rows});
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
 }finally{globalThis.fetch=original;await f.cleanup();}
});
