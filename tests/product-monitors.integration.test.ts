import test from 'node:test';
import assert from 'node:assert/strict';
import {assuranceFixture} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
import {collectConfiguredConnector,saveConnector,executeConnector,claimConnector} from '../lib/server/connector-service';
import {productMonitorCommand} from '../lib/server/product-monitor-service';
import {productReads,productTotal} from '../lib/connectors/product-recipes';
import {pdSample,readProduct} from '../lib/connectors/pipedream';
import {monitoringProduct} from '../lib/connectors/monitoring-product';

const setup=()=>Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ef'.repeat(32),
 REGPILOT_PIPEDREAM_PROJECT_ID:'proj_unitFixture',REGPILOT_PIPEDREAM_CLIENT_ID:'unit-client',REGPILOT_PIPEDREAM_CLIENT_SECRET:'fictional',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});

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
    assert.equal(req.pathname,'/v1/connect/proj_unitFixture/users/regpilot-'+org+'/accounts');
    assert.equal(req.searchParams.get('include_credentials'),'false');assert.equal(req.searchParams.get('app'),product.app);validations++;
    return Response.json([{id:'apn_abc123',healthy:true,app:{name_slug:product.app}}]);
   }
   assert.equal(req.pathname,'/v1/connect/proj_unitFixture/actions/run');
   assert.deepEqual(JSON.parse(String(opts?.body)),{id:product.app+'-'+product.action,version:product.version,external_user_id:'regpilot-'+org,configured_props:{[product.prop]:{authProvisionId:'apn_abc123'}}});reads++;
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
  if(path.endsWith('/accounts'))return Response.json(path.includes(f.a.id)?[{id:account,healthy,updated_at:updatedAt,app:{name_slug:product.app}}]:[]);
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
