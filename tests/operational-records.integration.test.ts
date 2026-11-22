import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {saveConnector,verifyConnectorNow,exportConnectorRun} from "../lib/server/connector-service";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {records,token} from "./helpers/operational-record-fixtures";

test("five operational sources can be configured, collected and exported within one workspace", async () => {
  const f = await assuranceFixture(), original = globalThis.fetch;
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"dc".repeat(32),SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"});
  try {
    const programme = await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
    const control = await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:"evidence",title:"Operational evidence",description:"Review the source records",testProcedure:"Compare against the expected record",theme:"quality",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    for (const row of records) {
      const flag = "REGPILOT_"+row.provider+"_ENABLED";
      const input = {provider:row.provider,...row.target,controlId:control.id,version:0,consent:true,enabled:true,intervalHours:24,token};
      process.env[flag]="false";
      await assert.rejects(saveConnector(f.o,input),rejects(503));
      process.env[flag]="true";
      await assert.rejects(saveConnector(f.out,input),rejects(404));
      const saved = await saveConnector(f.o,input);
      globalThis.fetch=async url => {assert.equal(String(url),row.url);return Response.json(row.changed);};
      const observed = await verifyConnectorNow(f.o,saved.id,saved.version);
      assert.equal(observed.outcome,"FOLLOW_UP",row.provider);
      const run = await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id}});
      const exported = await exportConnectorRun(f.o,run.id);
      assert.equal(exported.currentAtExport,true);
      await assert.rejects(exportConnectorRun(f.out,run.id),rejects(404));
      assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:"COMPLETE"}}}),1);
    }
  } finally {globalThis.fetch=original;await f.cleanup();}
});

test('managed AI access, renewal and successive sync receipts are isolated to the authorising organisation',async()=>{
 const {marketplaceAction,resolveCustomerAi,aiChoice}=await import('../lib/server/integration-marketplace');
 const f=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_MARKETPLACE_ENABLED:'true',REGPILOT_NANGO_API_KEY:token,REGPILOT_CUSTOMER_OPENAI_MODELS:'exact-model',REGPILOT_SYNC_MODELS:'{"regpilot-openai":["AuditItem"]}'});
 const integration='regpilot-openai',connectionId='own-connection',row={provider:'openai',provider_config_key:integration,connection_id:connectionId,errors:[] as string[],tags:{organization_id:f.a.id,regpilot_integration:integration}};
 let recordId='first',foreign=false;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'api.nango.dev');
  if(url.pathname==='/integrations')return Response.json({data:[{unique_key:integration,provider:'openai',display_name:'Own model'}]});
  if(url.pathname==='/connections')return Response.json({connections:[foreign?{...row,tags:{...row.tags,organization_id:f.b.id}}:row]});
  if(url.pathname==='/proxy/v1/models/exact-model')return Response.json({id:'exact-model'});
  if(url.pathname==='/records')return Response.json({records:[{id:recordId,private:'do-not-persist',_nango_metadata:{last_modified_at:'2026-01-01T12:00:00Z',last_action:'ADDED'}}],next_cursor:null});
  assert.equal(url.pathname,'/connect/sessions/reconnect');
  const body=JSON.parse(String(init?.body));assert.equal(body.connection_id,connectionId);assert.equal(body.integration_id,integration);assert.equal(body.tags.organization_id,f.a.id);assert.equal(body.tags.regpilot_integration,integration);
  return Response.json({data:{connect_link:'https://connect.nango.dev/?session_token=example',expires_at:new Date(Date.now()+60000).toISOString()}});
 };
 try{
  const bind={action:'SET_AI',integration,connectionId,model:'exact-model',previous:null};
  await assert.rejects(marketplaceAction(f.ed,bind,fetcher),rejects(403));
  await marketplaceAction(f.o,bind,fetcher);const own=await aiChoice(f.ed);assert.equal(own.model,'exact-model');
  assert.equal((await aiChoice(f.out)).provider,null);
  assert.equal((await resolveCustomerAi(f.ed,own.version!,fetcher)).connectionId,connectionId);
  await assert.rejects(marketplaceAction(f.o,bind,fetcher),rejects(409));
  const capture={action:'COLLECT',integration,connectionId,model:'AuditItem'};
  const a=await marketplaceAction(f.o,capture,fetcher),b=await marketplaceAction(f.o,capture,fetcher);
  assert.ok('changed' in a&&a.changed===null);assert.ok('changed' in b&&b.changed===false);
  recordId='second';const c=await marketplaceAction(f.o,capture,fetcher);assert.ok('changed' in c&&c.changed===true);
  row.errors=['expired'];await assert.rejects(resolveCustomerAi(f.ed,own.version!,fetcher));await marketplaceAction(f.o,{action:'RENEW',integration,connectionId},fetcher);row.errors=[];
  foreign=true;await assert.rejects(marketplaceAction(f.o,capture,fetcher));await assert.rejects(marketplaceAction(f.o,{action:'RENEW',integration,connectionId},fetcher));
  foreign=false;await marketplaceAction(f.o,{action:'UNLINK_AI',previous:own.version},fetcher);await assert.rejects(resolveCustomerAi(f.ed,own.version!,fetcher),rejects(409));
  const events=await db.auditEvent.findMany({where:{organizationId:f.a.id}});assert.doesNotMatch(JSON.stringify(events),/do-not-persist|fictional-connector-token/);
 }finally{await f.cleanup();}
});

test('repeated logger collection checks the physical serial, rotated key and current certificate review on each collection',async()=>{
 const f=await assuranceFixture(),original=globalThis.fetch;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_UBIBOT_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});
 try{
  const file=await f.file(),cert=await db.evidence.findUniqueOrThrow({where:{id:file.id}});
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'logger',title:'Logger calibration',description:'Check the current calibrated thermometer',testProcedure:'Read the current channel',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const base={provider:'UBIBOT',scope:'812',record:'WS1-fixture',reference:[file.id,cert.reviewVersion,'2025-01-01','2030-01-01',2,8,15].join('/'),controlId:control.id,consent:true,enabled:true,intervalHours:24};
  let expected=token;
  globalThis.fetch=async raw=>{assert.equal(new URL(String(raw)).searchParams.get('api_key'),expected);return Response.json({result:'success',channels:[{channel_id:812,serial:'WS1-fixture',last_values:{field1:{value:4,created_at:Math.floor(Date.now()/1000)-30}}}]});};
  const saved=await saveConnector(f.o,{...base,token,version:0});
  assert.equal((await verifyConnectorNow(f.o,saved.id,saved.version)).outcome,'OBSERVED');
  expected=token+'-rotated';const updated=await saveConnector(f.o,{...base,id:saved.id,version:saved.version,token:expected});
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'OBSERVED');
  await db.evidence.update({where:{id:file.id},data:{scanStatus:'QUARANTINED'}});
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'INCOMPLETE');
  assert.equal(await db.connectorRun.count({where:{organizationId:f.a.id,connectorId:saved.id}}),3);
 }finally{globalThis.fetch=original;await f.cleanup();}
});
