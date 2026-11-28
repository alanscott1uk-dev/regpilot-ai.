import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQualityCase,investigateQualityCase} from '../lib/server/capa-service';
import {readZipParts} from './helpers/zip-inspection.mjs';
import {createHash} from 'node:crypto';
import {excursionArchive,excursionCommand,excursionWorkspace} from '../lib/server/excursion-pilot';
import test from "node:test";
import assert from "node:assert/strict";
import {workInbox,workTask} from '../lib/server/work-hub-service';
import {applyConnectorReaction} from '../lib/server/connector-reactions';
import {verificationReceipt} from '../lib/server/connector-verification';
import {approveLoggerCalibration} from '../lib/server/logger-calibration';
import {db} from "../lib/server/db";
import {saveConnector,verifyConnectorNow,exportConnectorRun,claimConnector,executeConnector} from "../lib/server/connector-service";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {records,recordAuth,token} from "./helpers/operational-record-fixtures";

test("operational connectors can be configured, collected, renewed and exported within their workspace", async () => {
  const f = await assuranceFixture(), original = globalThis.fetch;
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"dc".repeat(32),SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"});
  try {
    const programme = await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
    const control = await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:"evidence",title:"Operational evidence",description:"Review the source records",testProcedure:"Compare against the expected record",theme:"quality",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    for (const row of records) {
      const flag = "REGPILOT_"+row.provider+"_ENABLED";
      const input = {provider:row.provider,...row.target,controlId:control.id,version:0,consent:true,enabled:true,intervalHours:row.provider==='PAGERDUTY_SERVICE'||row.provider==='HEALTHCHECKS_JOB'?1:24,token};
      process.env[flag]="false";
      await assert.rejects(saveConnector(f.o,input),rejects(503));
      process.env[flag]="true";
      await assert.rejects(saveConnector(f.out,input),rejects(404));
      const saved = await saveConnector(f.o,input);
      let acceptedCredential=token;
      globalThis.fetch=async (url,options) => {
        assert.equal(String(url),row.url);
        const auth=recordAuth(row.provider,acceptedCredential);
        if(new Headers(options?.headers).get(auth.name)!==auth.value)return new Response(null,{status:401});
        return Response.json(row.changed);
      };
      const observed = await verifyConnectorNow(f.o,saved.id,saved.version);
      assert.equal(observed.outcome,"FOLLOW_UP",row.provider);
      const run = await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id}});
      const exported = await exportConnectorRun(f.o,run.id);
      assert.equal(exported.currentAtExport,true);
      await assert.rejects(exportConnectorRun(f.out,run.id),rejects(404));
      assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:"COMPLETE"}}}),1);
      const first=await verificationReceipt(f.o,saved.id);
      assert.equal(first.currentVersionRead,run.id);
      assert.equal(first.readsAtLeastOneIntervalApart,false);
      await assert.rejects(verificationReceipt(f.out,saved.id),rejects(404));
      acceptedCredential=token+'-replacement';
      await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
      const rejected=await verifyConnectorNow(f.o,saved.id,saved.version);
      assert.equal(rejected.observed,false);
      if(row.provider==='GITHUB_SCIM'){
       const {customerSourceProof}=await import('../lib/server/customer-source-proof');
       const past=await customerSourceProof(f.o,saved.id);
       assert.equal(past.depth.failures[0].stage?.label,'Read the configured record');
       assert.match(past.depth.failures[0].stage!.guidance,/credential/);
       const {operationsWorkspace}=await import('../lib/server/operations-service');
       const {exportConnectorHealth}=await import('../lib/server/connector-health-service');
       const operations=await operationsWorkspace(f.o,undefined,saved.id);
       assert.equal(operations.connectors[0].failureStage?.label,'Read the configured record');
       const failureExport=await exportConnectorHealth(f.o,{filter:'collection-failed'});
       assert.match(failureExport.csv,/Read the configured record/);
      }
      assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}})).failureCode,'CREDENTIAL_REJECTED');
      const renewed=await saveConnector(f.o,{...input,id:saved.id,version:saved.version,token:acceptedCredential});
      const before=await verificationReceipt(f.o,saved.id);
      assert.deepEqual(before.credentialReplacements.map(r=>[r.before,r.after]),[[run.id,null]]);
      await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
      await verifyConnectorNow(f.o,saved.id,renewed.version);
      const after=await verificationReceipt(f.o,saved.id);
      assert.equal(after.verifiedReadsInWindow,2);
      assert.ok(after.currentVersionRead&&after.credentialReplacements[0].after===after.currentVersionRead);
      if(row===records[0]){
        const {customerSourceProof,customerBenchmarkPage,declareSource}=await import('../lib/server/customer-source-proof');
        await declareSource(f.ad,{connectionId:saved.id,configVersion:renewed.version,confirm:true,category:'STAGING'});
        const trace=await customerSourceProof(f.o,saved.id);
        assert.equal(trace.qualifies,false);assert.equal(trace.depth.scheduledReads,0);assert.equal(trace.depth.recoveries.length,1);
        assert.ok(trace.depth.reads.every(r=>r.mode==='MANUAL'&&r.checks.length>0));
        assert.equal((await customerBenchmarkPage(f.o)).connections.find(r=>r.id===saved.id)?.qualified,false);
        await assert.rejects(customerSourceProof(f.st,saved.id),rejects(403));

        const task=await db.obligation.findFirstOrThrow({where:{organizationId:f.a.id,connectorId:saved.id}});
        const query={view:'sources' as const,q:'',page:1};
        const inbox=await workInbox(f.ed,query);
        assert.equal(inbox.counts.sources,1);assert.equal(inbox.items[0].id,task.id);
        assert.equal((await workInbox(f.st,query)).counts.sources,0);
        assert.equal((await workTask(f.st,task.id)).sourceObservations,null);
        await assert.rejects(workTask(f.out,task.id),rejects(404));
        assert.equal((await exportConnectorRun(f.ed,run.id,task.id)).id,run.id);
        await assert.rejects(exportConnectorRun(f.st,run.id,task.id),rejects(404));
        await assert.rejects(exportConnectorRun(f.o,run.id,f.task.id),rejects(404));
        await db.obligation.update({where:{id:task.id},data:{assigneeId:f.re.userId}});
        await assert.rejects(exportConnectorRun(f.ed,run.id,task.id),rejects(404));
        assert.equal((await workTask(f.ed,task.id)).sourceObservations,null);
        assert.equal((await exportConnectorRun(f.re,run.id,task.id)).id,run.id);
        await db.obligation.update({where:{id:task.id},data:{assigneeId:f.ed.userId}});
        const event=await db.automationEvent.findFirstOrThrow({where:{organizationId:f.a.id,runId:after.currentVersionRead}});
        await db.$transaction(tx=>applyConnectorReaction(tx,event));
        const reads=(await workTask(f.ed,task.id)).sourceObservations!;
        assert.deepEqual(reads.items.map(r=>r.runId),[after.currentVersionRead,run.id]);
        assert.equal(reads.unavailable,0);assert.ok(reads.items.every(r=>r.exceptionCount>0));
        assert.doesNotMatch(JSON.stringify(reads),/fictional-connector-token|"observed":/);
        await db.connectorRun.update({where:{id:run.id},data:{signalHash:'0'.repeat(64)}});
        const checked=(await workTask(f.o,task.id)).sourceObservations!;
        await assert.rejects(exportConnectorRun(f.ed,run.id,task.id),rejects(404));
        const historical=await exportConnectorRun(f.o,run.id);
        assert.equal(historical.signalIntegrity,'UNVERIFIED');assert.equal(historical.currentAtExport,false);
        assert.equal(checked.unavailable,1);assert.deepEqual(checked.items.map(r=>r.runId),[after.currentVersionRead]);
        globalThis.fetch=async()=>Response.json(row.good);
        await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
        const recovered=await verifyConnectorNow(f.o,saved.id,renewed.version);
        assert.equal(recovered.outcome,'OBSERVED');
        const latest=(await workTask(f.ed,task.id)).sourceObservations!.items[0];
        assert.equal(latest.exceptionCount,0);assert.equal(latest.changed,true);
        assert.ok(latest.changes.some(c=>c.before==='FAIL'&&c.after==='PASS'));
        assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:'COMPLETE'}}}),1);
        // Exercise two worker dispatches with a simulated interval in this disposable database.
        await db.connectorRun.update({where:{id:run.id},data:{signalHash:run.signalHash}});
        const day=86400000;
        async function due(){
         const now=Date.now();await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(now-day-1000),nextRunAt:new Date(now-100)}});
         const job=await claimConnector();assert.equal(job?.id,saved.id);assert.equal(await executeConnector(job!), 'OBSERVED');
         return db.connectorRun.findUniqueOrThrow({where:{leaseToken:job!.leaseToken!}});
        }
        const dayOne=await due();await db.connectorRun.update({where:{id:dayOne.id},data:{capturedAt:new Date(Date.now()-day-1000)}});
        await due();
        const staged=await customerSourceProof(f.o,saved.id);assert.equal(staged.depth.cadence,true);assert.equal(staged.qualifies,false);
        await declareSource(f.ad,{connectionId:saved.id,configVersion:renewed.version,confirm:true,category:'CUSTOMER'});
        assert.equal((await customerSourceProof(f.o,saved.id)).qualifies,true);
        await declareSource(f.ad,{connectionId:saved.id,configVersion:renewed.version,confirm:true,category:'STAGING'});
        assert.equal((await customerSourceProof(f.o,saved.id)).qualifies,false);
      }
      await saveConnector(f.o,{...input,id:saved.id,version:renewed.version,token:token+'-replacement'});
      assert.equal((await verificationReceipt(f.o,saved.id)).credentialReplacements.length,1);
    }
  } finally {globalThis.fetch=original;await f.cleanup();}
});

test('managed AI access, renewal and successive sync receipts are isolated to the authorising organisation',async()=>{
 const {marketplaceAction,resolveCustomerAi,aiChoice}=await import('../lib/server/integration-marketplace');
 const f=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_MARKETPLACE_ENABLED:'true',REGPILOT_NANGO_API_KEY:token,REGPILOT_CUSTOMER_OPENAI_MODELS:'exact-model',REGPILOT_SYNC_MODELS:'{"regpilot-openai":["AuditItem"]}'});
 const integration='regpilot-openai',connectionId='own-connection',row={provider:'openai',provider_config_key:integration,connection_id:connectionId,errors:[] as string[],tags:{organization_id:f.a.id,regpilot_integration:integration}};
 const completedAt=new Date().toISOString();
 let recordId='first',foreign=false,encrypted=true,population=1;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'api.nango.dev');
  if(url.pathname==='/integrations')return Response.json({data:[{unique_key:integration,provider:'openai',display_name:'Own model'}]});
  if(url.pathname==='/connections')return Response.json({connections:[foreign?{...row,tags:{...row.tags,organization_id:f.b.id}}:row]});
  if(url.pathname==='/proxy/v1/models/exact-model')return Response.json({id:'exact-model'});
  if(url.pathname==='/sync/status')return Response.json({syncs:[{connection_id:connectionId,status:'SUCCESS',finishedAt:completedAt,recordCount:{AuditItem:population}}]});
  if(url.pathname==='/records')return Response.json({records:[{id:recordId,device:{encrypted,supported:true,lastSeenAt:completedAt},private:'do-not-persist',_nango_metadata:{last_modified_at:'2026-01-01T12:00:00Z',last_action:'ADDED'}}],next_cursor:null});
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
  const bindPolicy={...capture,action:'BIND_POLICY',policy:{profile:'endpoint',mapping:{encrypted:'device.encrypted',supported:'device.supported',lastSeenAt:'device.lastSeenAt'}}};
  await assert.rejects(marketplaceAction(f.ed,bindPolicy,fetcher),rejects(403));
  const policy=await marketplaceAction(f.o,bindPolicy,fetcher);assert.ok('policyId' in policy);
  assert.deepEqual(await marketplaceAction(f.o,bindPolicy,fetcher),policy);
  const scoped={...capture,policyId:policy.policyId};
  await assert.rejects(marketplaceAction(f.out,scoped,fetcher),rejects(409));
  const healthy=await marketplaceAction(f.o,scoped,fetcher);
  assert.ok('rules' in healthy&&healthy.rules.length===3&&healthy.rules.every(r=>r.status==='PASS'));
  encrypted=false;
  const failed=await marketplaceAction(f.o,scoped,fetcher);
  assert.ok('findings' in failed&&failed.changed&&failed.findings.length===1&&failed.rules[0].status==='FAIL');
  assert.match(failed.findings[0].resource,/^[a-f0-9]{24}$/);
  encrypted=true;population=2;
  const partial=await marketplaceAction(f.o,scoped,fetcher);
  assert.ok('rules' in partial&&partial.rules.every(r=>r.status==='UNKNOWN')&&partial.populationComplete===false);
  recordId='second';const c=await marketplaceAction(f.o,capture,fetcher);assert.ok('changed' in c&&c.changed===true);
  row.errors=['expired'];await assert.rejects(resolveCustomerAi(f.ed,own.version!,fetcher));await marketplaceAction(f.o,{action:'RENEW',integration,connectionId},fetcher);row.errors=[];
  foreign=true;await assert.rejects(marketplaceAction(f.o,capture,fetcher));await assert.rejects(marketplaceAction(f.o,{action:'RENEW',integration,connectionId},fetcher));
  foreign=false;await marketplaceAction(f.o,{action:'UNLINK_AI',previous:own.version},fetcher);await assert.rejects(resolveCustomerAi(f.ed,own.version!,fetcher),rejects(409));
  const events=await db.auditEvent.findMany({where:{organizationId:f.a.id}});assert.doesNotMatch(JSON.stringify(events),/do-not-persist|fictional-connector-token/);
 }finally{await f.cleanup();}
});

for(const slug of ['slack','bitbucket'])test(slug==='bitbucket'?'a newly indexed Bitbucket product binds monitored controls to fresh upstream receipts and workspace-scoped credential recovery':'a hosted monitor resumes only after scoped broker reauthorisation and earns recovery only after a new complete upstream sync',async()=>{
 const {marketplaceAction}=await import('../lib/server/integration-marketplace');
 const {customerSourceProof,customerBenchmarkPage}=await import('../lib/server/customer-source-proof');
 const {completedManagedSync,monitoringProduct}=await import('../lib/connectors/monitoring-product');
 const f=await assuranceFixture(),original=globalThis.fetch;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'cd'.repeat(32),
  SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional',REGPILOT_MARKETPLACE_ENABLED:'true',REGPILOT_NANGO_API_KEY:token});
 const integration='regpilot-'+slug,connectionId='workspace-membership',model='Member',scope={integration,connectionId},ownerTags={organization_id:f.a.id,regpilot_integration:integration};
 let tags:Record<string,string>={...ownerTags},issued:Record<string,string>={},fault=false,upstream=new Date(Date.now()-5000).toISOString(),size=1;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.nango.dev');
  if(url.pathname==='/integrations')return Response.json({data:[{unique_key:integration,provider:slug}]});
  if(url.pathname==='/connections')return Response.json({connections:[{provider:slug,provider_config_key:integration,connection_id:connectionId,tags,errors:fault?[{type:'auth'}]:[]}]});
  if(url.pathname==='/sync/status')return Response.json({syncs:[{connection_id:connectionId,status:'SUCCESS',finishedAt:upstream,recordCount:{Member:size}}]});
  if(url.pathname==='/records')return Response.json({records:[{id:'private-user',mfa:true,orphan:false,reviewed:upstream,_nango_metadata:{last_modified_at:upstream,last_action:'UPDATED'}}],next_cursor:null});
  assert.equal(url.pathname,'/connect/sessions/reconnect');issued=JSON.parse(String(init?.body)).tags;
  return Response.json({data:{connect_link:'https://connect.nango.dev/?session_token=stub-private',expires_at:new Date(Date.now()+600000).toISOString()}});
 };
 try{
  const pack=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:pack.id,proposalKey:'identity',title:'Identity check',description:'Check approved access',testProcedure:'Inspect mapped accounts',theme:'identity',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const bound=await marketplaceAction(f.o,{action:'BIND_POLICY',...scope,model,policy:{profile:'identity',mapping:{mfaEnabled:'mfa',orphaned:'orphan',accessReviewedAt:'reviewed'}}});
  assert.ok('policyId' in bound&&bound.controls.some(c=>c.id===control.id));
  const intervalHours=slug==='bitbucket'?1:24;
  const input={provider:'NANGO_SYNC',scope:integration+'/'+connectionId,record:model,reference:slug+'/'+bound.policyId,controlId:control.id,intervalHours,version:0,enabled:true,consent:true};
  await assert.rejects(saveConnector(f.out,input),rejects(409));
  const [monitor,again]=await Promise.all([saveConnector(f.o,input),saveConnector(f.o,input)]);assert.deepEqual(monitor,again);
  const selected=await marketplaceAction(f.o,{action:'MONITOR',monitorId:monitor.id});assert.ok('grant' in selected&&selected.grant?.id===connectionId&&selected.model===model);
  await assert.rejects(marketplaceAction(f.out,{action:'MONITOR',monitorId:monitor.id}),rejects(404));
  async function collect(){
   await db.evidenceConnector.update({where:{id:monitor.id},data:{nextRunAt:new Date()}});
   const job=await claimConnector();assert.equal(job?.id,monitor.id);
   return executeConnector(job!,undefined,{deferAutomation:true});
  }
  upstream=new Date(Date.now()-7200000).toISOString();
  assert.equal(await collect(),intervalHours===1?'FOLLOW_UP':'OBSERVED');
  const older=await db.connectorRun.findFirstOrThrow({where:{connectorId:monitor.id},orderBy:{capturedAt:'desc'}});
  const {observationSchema}=await import('../lib/connectors/observation');
  const olderSource=observationSchema.parse(older.result).checks.find(c=>c.id==='source-sync');
  assert.equal(olderSource?.status,intervalHours===1?'FAIL':'PASS');
  assert.equal((await customerSourceProof(f.o,monitor.id)).current,intervalHours!==1);
  upstream=new Date(Date.now()-5000).toISOString();
  assert.equal(await collect(),'OBSERVED');assert.equal((await customerSourceProof(f.o,monitor.id)).productKey,slug.toUpperCase());
  const schedule=await db.evidenceConnector.findUniqueOrThrow({where:{id:monitor.id}});
  assert.ok(schedule.lastSuccessAt);
  assert.ok(Math.abs(schedule.nextRunAt.getTime()-schedule.lastSuccessAt.getTime()-intervalHours*3600000)<1000);
  fault=true;assert.equal(await collect(),'ATTENTION');
  const paused=await db.evidenceConnector.findUniqueOrThrow({where:{id:monitor.id}});assert.equal(paused.enabled,false);assert.equal(paused.failureCode,'CREDENTIAL_REJECTED');
  const portfolio=await customerBenchmarkPage(f.o);assert.ok(portfolio.connections.some(c=>c.id===monitor.id&&!c.qualified&&c.failures===1));
  const renew={...scope,action:'RENEW'},verify={...scope,action:'VERIFY_RENEWAL'};
  await marketplaceAction(f.o,renew);const oldTags={...issued};await marketplaceAction(f.o,renew);
  await assert.rejects(marketplaceAction(f.ed,verify),rejects(403));
  await assert.rejects(marketplaceAction(f.ad,verify),rejects(409));
  fault=false;await assert.rejects(marketplaceAction(f.ad,verify),rejects(409));
  tags={...oldTags};await assert.rejects(marketplaceAction(f.ad,verify),rejects(409));
  tags={...issued,organization_id:f.b.id};await assert.rejects(marketplaceAction(f.out,verify),rejects(409));
  tags={...issued,end_user_id:f.admin.id};await assert.rejects(marketplaceAction(f.ad,verify),rejects(409));
  tags={...issued};const [verified,replayed]=await Promise.all([marketplaceAction(f.ad,verify),marketplaceAction(f.ad,verify)]);
  assert.ok('resumed' in verified&&verified.resumed===1);assert.deepEqual(replayed,verified);
  assert.equal(await collect(),'INCOMPLETE');let proof=await customerSourceProof(f.o,monitor.id);
  assert.equal(proof.depth.recoveries.length,0,'broker cache from before the renewal cannot prove restoration');
  upstream=new Date().toISOString();size=2;assert.equal(await collect(),'INCOMPLETE');
  assert.equal((await customerSourceProof(f.o,monitor.id)).depth.recoveries.length,0,'incomplete populations cannot prove a recovery');
  upstream=new Date().toISOString();size=1;assert.equal(await collect(),'OBSERVED');proof=await customerSourceProof(f.o,monitor.id);
  assert.equal(proof.rotated,true);assert.equal(proof.depth.recoveries.length,1);assert.equal(proof.qualifies,false);assert.equal(proof.category,'UNCONFIRMED');
  assert.equal(proof.depth.failures[0].stage?.label,'Verify the workspace grant');
  await marketplaceAction(f.o,renew);
  await assert.rejects(marketplaceAction(f.o,verify),rejects(409),'an earlier verified receipt cannot complete a newly opened renewal');
  const audits=await db.auditEvent.findMany({where:{organizationId:f.a.id}});
  assert.doesNotMatch(JSON.stringify(audits),/stub-private|private-user/);
  assert.equal(monitoringProduct('GITHUB_WORKFLOW'),monitoringProduct('NANGO_SYNC','github-app'));
  assert.equal(monitoringProduct('NANGO_SYNC','unknown-app'),null);assert.equal(monitoringProduct('EUROPE_PMC'),null);
  const latest=await db.connectorRun.findFirstOrThrow({where:{connectorId:monitor.id},orderBy:{capturedAt:'desc'}});
  const reading=observationSchema.parse(latest.result);
  assert.ok(completedManagedSync(reading));assert.equal(completedManagedSync({...reading,engine:'managed-sync-metadata-v1'}),null);
 }finally{globalThis.fetch=original;await f.cleanup();}
});

for(const scenario of ['UBIBOT','TANDD_WEBSTORAGE','UBIBOT_HISTORY'] as const)test(scenario==='UBIBOT_HISTORY'?'an instrument-identified hourly excursion carries its reported range and stock decision through a signed site inspection even after the current reading recovers':scenario==='TANDD_WEBSTORAGE'?'a T&D WebStorage logger recovers after credential rejection and carries its serial and channel into the signed site inspection':'repeated logger collection checks the physical serial, rotated key and current certificate review on each collection',async()=>{
 const f=await assuranceFixture(),original=globalThis.fetch;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_UBIBOT_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});
 try{
  const file=await f.file(),cert=await db.evidence.findUniqueOrThrow({where:{id:file.id}});
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'logger',title:'Logger calibration',description:'Check the current calibrated thermometer',testProcedure:'Read the current channel',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const archiveHours=scenario==='UBIBOT_HISTORY',tandd=scenario==='TANDD_WEBSTORAGE',loggerProvider=tandd?'TANDD_WEBSTORAGE':'UBIBOT';
  const base={provider:loggerProvider,scope:tandd?'2':'812',record:tandd?'52A021FE':'WS1-fixture',reference:[file.id,cert.reviewVersion,'2025-01-01','2030-01-01',2,8,15].join('/')+(archiveHours?'/history':''),controlId:control.id,consent:true,enabled:true,intervalHours:tandd||archiveHours?1:24};
  let temperature=4,expected=token,rejectCredential=false,intervalFailed=false,failedHour='';
  const credentials=(replaced:boolean)=>tandd?{credentials:{loginId:'qa000001',password:'fixture-pass',apiKey:(replaced?'b':'a').repeat(45)}}:{token:expected};
  const clock=Math.floor(Date.now()/1000);let sensorTime=clock-180;
  globalThis.fetch=async(raw,init)=>{
   if(tandd){
    assert.equal(String(raw),'https://api.webstorage-service.com/v1/devices/current');
    const body=JSON.parse(String(init?.body));
    assert.deepEqual(body['remote-serial'],[base.record]);
    if(rejectCredential&&body['api-key']!=='b'.repeat(45))return new Response(null,{status:401});
    return Response.json({devices:[{serial:base.record,unixtime:String(sensorTime),channel:[{num:'1',unit:'%',value:'41'},{num:'2',unit:'C',value:String(temperature)}]}]});
   }
   assert.equal(new URL(String(raw)).searchParams.get('api_key'),expected);
   if(new URL(String(raw)).pathname.endsWith('/summary.json')){
    const start=Date.parse(new URL(String(raw)).searchParams.get('start')!.replace(' ','T')+'Z');
    const feeds=Array.from({length:24},(_,i)=>({created_at:new Date(start+i*3600000).toISOString(),field1:{count:12,min:4,max:intervalFailed&&i===23?11:6}}));
    failedHour=feeds[23].created_at;
    return Response.json({result:'success',channel:{channel_id:'812',serial:base.record},is_truncated:false,feeds});
   }
   return Response.json({result:'success',channels:[{channel_id:812,serial:base.record,last_values:{field1:{value:temperature,created_at:sensorTime}}}]});
  };
  const saved=await saveConnector(f.o,{...base,...credentials(false),version:0});
  await assert.rejects(approveLoggerCalibration(f.o,saved.id,saved.version,true),rejects(403));
  await assert.rejects(approveLoggerCalibration(f.out,saved.id,saved.version,true),rejects(409));
  assert.equal((await verifyConnectorNow(f.o,saved.id,saved.version)).outcome,'INCOMPLETE');
  const approval=await approveLoggerCalibration(f.ad,saved.id,saved.version,true);
  assert.deepEqual(await approveLoggerCalibration(f.ad,saved.id,saved.version,true),approval);
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,saved.version)).outcome,'OBSERVED');
  if(tandd){
   rejectCredential=true;
   await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
   await verifyConnectorNow(f.o,saved.id,saved.version);
   assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}})).failureCode,'CREDENTIAL_REJECTED');
  }
  expected=token+'-rotated';const updated=await saveConnector(f.o,{...base,id:saved.id,version:saved.version,...credentials(true)});
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'OBSERVED');
  const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id},orderBy:{capturedAt:'desc'}});
  assert.equal((await exportConnectorRun(f.o,run.id)).currentAtExport,true);
  sensorTime=clock-90;temperature=archiveHours?5:10;intervalFailed=archiveHours;await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'FOLLOW_UP');
  const excursion=await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id},orderBy:{capturedAt:'desc'}});
  const sampleAt=archiveHours?new Date(failedHour):new Date(sensorTime*1000);
  const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
  const occurredOn=dateFormat.format(sampleAt),reviewDue=dateFormat.format(new Date(Date.now()+7*86400000));
  const q=await createQualityCase(f.ed,{title:'Fictional storage excursion',kind:'DEVIATION',classification:'MAJOR',requestKey:randomUUID(),
   ownerId:f.ed.userId,occurredAt:occurredOn,impact:'The fictional affected lot was segregated pending a decision.',description:'The fixture logger reported a temperature above the site operating limit.',containment:'Segregate the identified stock at the test site until reviewed.'});
  const stock=await f.file(),signed=await f.file(),authority=await f.file();
  const candidates=await excursionWorkspace(f.ed,q.id);
  assert.deepEqual(candidates.candidates.readings.map(r=>r.runId),[excursion.id]);
  await assert.rejects(excursionWorkspace(f.out,q.id),rejects(404));
  const attach={action:'LINK',requestKey:randomUUID(),version:q.version,runId:excursion.id,...(archiveHours?{hourStart:failedHour}:{}),site:'Fictional cold room',stock:['TEST-001'],stockEvidenceId:stock.id};
  await assert.rejects(excursionCommand(f.out,q.id,attach,f.store),rejects(404));
  await assert.rejects(excursionCommand(f.ed,q.id,{...attach,runId:run.id},f.store),rejects(409));
  const linked=await excursionCommand(f.ed,q.id,attach,f.store);assert.equal((await excursionCommand(f.ed,q.id,attach,f.store)).digest,linked.digest);
  const assessed=await investigateQualityCase(f.ed,q.id,{requestKey:randomUUID(),version:q.version+1,ownerId:f.ed.userId,containment:'The identified fictional lot stays segregated pending independent review.',investigationNotes:'Compared the excursion timing against the stock and certificate in the fixture.',rootCause:'The fictional cold-room door was left open during a documented transfer.',effectivenessCriteria:'Verify the handover and logger condition on the next agreed review.',effectivenessDueAt:reviewDue});
  const disposition={action:'DECIDE',requestKey:randomUUID(),version:assessed.version,sourceRef:'TEST-QD-1',signatory:'Fictional delegated decision maker',disposition:'QUARANTINE',decidedAt:new Date().toISOString(),rationale:'The signed fixture decision retains the affected lot in quarantine.',decisionEvidenceId:signed.id,authorityEvidenceId:authority.id,confirmed:true};
  sensorTime=clock-20;temperature=6;intervalFailed=false;
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'OBSERVED');
  const restored=await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id},orderBy:{capturedAt:'desc'}});
  await excursionCommand(f.o,q.id,disposition,f.store);
  const fetchRecord={action:'RETRIEVE',version:assessed.version+1,requestKey:randomUUID()};
  await assert.rejects(excursionCommand(f.o,q.id,fetchRecord,f.store),rejects(403));
  await assert.rejects(excursionCommand(f.ad,q.id,fetchRecord,f.store),rejects(403));
  await db.membership.update({where:{organizationId_userId:{organizationId:f.a.id,userId:f.re.userId}},data:{role:'ADMIN'}});
  const independent=await excursionCommand(f.re,q.id,fetchRecord,f.store);
  await assert.rejects(excursionArchive(f.ad,q.id,{...fetchRecord,requestKey:randomUUID()},f.store),rejects(403));
  const archive=await readZipParts(await excursionArchive(f.re,q.id,fetchRecord,f.store)) as Map<string,Buffer>;
  const inspection=JSON.parse(archive.get('inspection.json')!.toString());
  assert.equal(inspection.digest,independent.digest);
  if(archiveHours){
   assert.equal(inspection.record.reading.data.reportedHour.maximum,11);
   assert.match(archive.get(inspection.hourlyRanges)!.toString(),/4,11,12/);
   assert.equal(inspection.record.reading.data.temperature.includes('Reported hourly range'),true);
  }
  const historyPoints=inspection.record.disposition.data.history.points;
  assert.deepEqual(historyPoints.map((p:{celsius:number})=>p.celsius),archiveHours?[4,5,6]:[4,10,6]);
  assert.deepEqual(historyPoints.map((p:{runId:string})=>p.runId),[run.id,excursion.id,restored.id]);
  assert.ok(archive.get(inspection.temperatureReadings)!.toString().includes(excursion.resultHash));
  assert.deepEqual(inspection.sources.map((s:{role:string})=>s.role).sort(),['affected-stock','calibration','signatory-authority','signed-decision']);
  for(const source of inspection.sources)assert.equal(createHash('sha256').update(archive.get(source.entry)!).digest('hex'),source.sha256);
  assert.match(JSON.stringify(independent),/TEST-001/);assert.match(JSON.stringify(independent),/TEST-QD-1/);
  assert.equal((await excursionWorkspace(f.re,q.id)).retrieved.length,1);
  const previousBuild=process.env.VERCEL_GIT_COMMIT_SHA,release='c'.repeat(40);
  try{
   process.env.VERCEL_GIT_COMMIT_SHA=release;
   const {recordTrial}=await import('../lib/server/capability-trial-service');
   const {siteQualification,recordSiteDecision}=await import('../lib/server/site-qualification-service');
   const {retainValidation}=await import('../lib/server/retained-validation');
   const {siteInspectionArchive}=await import('../lib/server/site-inspection-archive');
   const {makeAuditZip}=await import('../lib/audit-archive');
   const {declareSource}=await import('../lib/server/customer-source-proof');
   const {id}=await recordTrial(f.ed,{action:'START',requestKey:randomUUID(),track:'site_qualification',steps:['cold-chain'],release,
    intendedUse:'Trace a customer site excursion to the independently reviewed stock disposition.',environment:'PROTECTED_PILOT',ukExternal:true,
    siteProtocol:{site:attach.site,operator:'Fictional warehouse',licence:'Fixture-WDA-1',configuration:'Calibrated storage configuration A',
     criteria:[{step:'cold-chain',expected:'Retrieve the calibrated reading, affected stock and independently reviewed disposition.'}]}});
   const testProof=await f.file(),siteSigned=await f.file(),siteAuthority=await f.file();
   await recordTrial(f.ed,{action:'FINISH',id,results:[{step:'cold-chain',notes:'The operator retrieved the source and recorded a site test result.',evidenceId:testProof.id,outcome:'PASS',unsupported:0,edits:0,assisted:false}]},f.store);
   await recordTrial(f.ad,{action:'REVIEW',id,decision:'ACCEPT',notes:'Independently checked the trial result and signed test evidence.'},f.store);
   const bytes=makeAuditZip([{name:'validation.json',bytes:Buffer.from('{"environment":"fixture"}')}]);
   await retainValidation(f.o,id,bytes,async revision=>({state:'AVAILABLE',revision,runUrl:'https://github.com/example/run',downloadUrl:'https://github.com/example/archive',digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),expiresAt:new Date(Date.now()+86400000).toISOString()}));
   const newRetrieval=()=>excursionCommand(f.re,q.id,{...fetchRecord,requestKey:randomUUID()},f.store);
   const unconfirmed=await newRetrieval();
   let dossier=await siteQualification(f.o,id);
   const approve={requestKey:randomUUID(),basisHash:dossier.basisHash,decision:'APPROVE',signatory:'Fictional site quality lead',role:'Quality Director',rationale:'Restricted to the recorded configuration, intended use and signed trial result.',decisionFile:siteSigned.id,authorityFile:siteAuthority.id,confirmed:true};
   assert.equal(dossier.excursionChoices.length,0);
   await assert.rejects(recordSiteDecision(f.o,id,{...approve,excursionReceiptId:unconfirmed.receiptId},f.store),rejects(409));
   const ownership=await declareSource(f.ad,{connectionId:saved.id,configVersion:updated.version,category:'CUSTOMER',confirm:true});
   const retrieved=await newRetrieval();
   dossier=await siteQualification(f.o,id);assert.equal(dossier.excursionChoices[0].id,retrieved.receiptId);
   await assert.rejects(recordSiteDecision(f.o,id,{...approve,excursionReceiptId:unconfirmed.receiptId},f.store),rejects(409));
   await recordSiteDecision(f.o,id,{...approve,excursionReceiptId:retrieved.receiptId},f.store);
   const siteZip=await siteInspectionArchive(f.re,id,f.store);
   const files=await readZipParts(siteZip) as Map<string,Buffer>;
   const bundle=JSON.parse(files.get('site-inspection.json')!.toString());
   assert.equal(bundle.site.status,'APPROVED_FOR_SITE_USE');assert.equal(bundle.site.decisions[0].excursion.qualification.ownership.id,ownership.id);
   assert.equal(bundle.site.decisions[0].excursion.provider,loggerProvider);assert.equal(bundle.site.decisions[0].excursion.channel,base.scope);
   const directory=mkdtempSync(join(tmpdir(),'regpilot-site-check-'));
   try{
    const zip=join(directory,'site.zip');writeFileSync(zip,siteZip);
    const digest='sha-256=:'+createHash('sha256').update(siteZip).digest('base64')+':';
    const cli=['public/site-validation/verify.py',zip,'--site',bundle.site.protocol.site,'--release',bundle.site.protocol.release,'--digest',digest,'--serial',base.record,'--stock'];
    const checked=JSON.parse(execFileSync('python3',[...cli,'TEST-001'],{encoding:'utf8'}));assert.equal(checked.case,q.id);
    assert.equal(checked.temperatureEvidence.state,'VERIFIED');
    assert.equal(checked.temperatureEvidence.readings,bundle.site.decisions[0].excursion.history.points.length);
    assert.equal(checked.temperatureEvidence.hourlyRanges,bundle.site.decisions[0].excursion.history.hourlyTemperature?.hours.length??0);
    // Recompute the outer digest to exercise the independent CSV-to-receipt comparison itself.
    const {makeAuditZip}=await import('../lib/audit-archive');
    const wrongEntry=archiveHours?bundle.temperatureReadings[0].rangesEntry:bundle.temperatureReadings[0].entry;
    const modified=makeAuditZip([...files].map(([name,bytes])=>({name,bytes:name===wrongEntry?Buffer.concat([bytes,Buffer.from('unexpected,row\r\n')]):bytes})));
    const modifiedPath=join(directory,'mismatched.zip');writeFileSync(modifiedPath,modified);
    const wrongCli=[...cli];wrongCli[1]=modifiedPath;wrongCli[wrongCli.indexOf(digest)]=createHash('sha256').update(modified).digest('hex');
    assert.throws(()=>execFileSync('python3',[...wrongCli,'TEST-001','--require-history'],{stdio:'pipe'}));
    assert.throws(()=>execFileSync('python3',[...cli,'DIFFERENT-LOT'],{stdio:'pipe'}));
   }finally{rmSync(directory,{recursive:true,force:true});}
   assert.equal(bundle.site.decisions[0].excursion.serial,base.record);assert.deepEqual(bundle.site.decisions[0].excursion.stock,['TEST-001']);
   assert.equal(bundle.site.decisions[0].excursion.disposition,'QUARANTINE');assert.equal(bundle.site.decisions[0].excursion.assessorId,f.re.userId);
   assert.deepEqual(bundle.sources.flatMap((s:{roles:string[]})=>s.roles).filter((r:string)=>r.startsWith('excursion-')).sort(),['excursion-authority','excursion-calibration','excursion-disposition','excursion-stock']);
   for(const source of bundle.sources)assert.equal(createHash('sha256').update(files.get(source.entry)!).digest('hex'),source.sha256);
   assert.deepEqual(files.get(bundle.temperatureReadings[0].entry),archive.get(inspection.temperatureReadings));
   if(archiveHours)assert.deepEqual(files.get(bundle.temperatureReadings[0].rangesEntry),archive.get(inspection.hourlyRanges));
   await db.connectorRun.update({where:{id:restored.id},data:{resultHash:'0'.repeat(64)}});
   await assert.rejects(excursionCommand(f.re,q.id,fetchRecord,f.store),rejects(409));
   await assert.rejects(siteInspectionArchive(f.re,id,f.store),rejects(409));
   await db.connectorRun.update({where:{id:restored.id},data:{resultHash:restored.resultHash}});
   const originalCase=await db.qualityCase.findUniqueOrThrow({where:{id:q.id}});
   await db.qualityCase.update({where:{id:q.id},data:{rootCause:'A changed investigation requires another decision.'}});
   assert.equal((await siteQualification(f.o,id)).status,'REASSESSMENT_REQUIRED');
   await db.qualityCase.update({where:{id:q.id},data:{rootCause:originalCase.rootCause}});
   await db.evidence.update({where:{id:stock.id},data:{scanStatus:'QUARANTINED'}});
   await assert.rejects(siteInspectionArchive(f.re,id,f.store),rejects(409));
   await db.evidence.update({where:{id:stock.id},data:{scanStatus:'CLEAN'}});
  }finally{if(previousBuild===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;else process.env.VERCEL_GIT_COMMIT_SHA=previousBuild;}
  temperature=4;
  await db.evidence.update({where:{id:file.id},data:{scanStatus:'QUARANTINED'}});
  await assert.rejects(excursionCommand(f.re,q.id,{...fetchRecord,requestKey:randomUUID()},f.store),rejects(409));
  await assert.rejects(excursionArchive(f.re,q.id,fetchRecord,f.store),rejects(409));
  assert.equal((await exportConnectorRun(f.o,run.id)).currentAtExport,false);
  await db.evidenceConnector.update({where:{id:saved.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  assert.equal((await verifyConnectorNow(f.o,saved.id,updated.version)).outcome,'INCOMPLETE');
  const history=await db.connectorRun.findMany({where:{organizationId:f.a.id,connectorId:saved.id},orderBy:{capturedAt:'asc'},select:{outcome:true}});
  assert.deepEqual(history.map(read=>read.outcome),['INCOMPLETE','OBSERVED','OBSERVED','FOLLOW_UP','OBSERVED','INCOMPLETE']);
 }finally{globalThis.fetch=original;await f.cleanup();}
});

test('self-service provisions an eligible provider once for the requesting organisation and hides other customer configurations', async()=>{
 const {marketplaceAction}=await import('../lib/server/integration-marketplace');
 const {workspaceIntegrationId,catalogUrl}=await import('../lib/connectors/marketplace');
 const f=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_MARKETPLACE_ENABLED:'true',REGPILOT_MARKETPLACE_SELF_SERVICE_ENABLED:'true',REGPILOT_NANGO_API_KEY:token});
 const expected=workspaceIntegrationId(f.a.id,'example'),foreign=workspaceIntegrationId(f.b.id,'example');
 const integrations=[{unique_key:foreign,provider:'example',display_name:'Another account'}];
 let creates=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input)===catalogUrl)return new Response('| `example` | Example | API_KEY | docs | connect | | ERP |\n| `oauth` | OAuth | OAUTH2 | docs | connect | | ERP |');
  assert.equal(String(input),'https://api.nango.dev/integrations');
  if(init?.method==='POST'){
   const data=JSON.parse(String(init.body));assert.deepEqual(data,{unique_key:expected,provider:'example'});
   creates++;integrations.push({...data,display_name:'Connected example'});return Response.json({data});
  }
  return Response.json({data:integrations});
 };
 try{
  await assert.rejects(marketplaceAction(f.ed,{action:'ENABLE',slug:'example'},fetcher),rejects(403));
  await assert.rejects(marketplaceAction(f.o,{action:'ENABLE',slug:'oauth'},fetcher),rejects(400));
  await marketplaceAction(f.o,{action:'ENABLE',slug:'example'},fetcher);
  await marketplaceAction(f.o,{action:'ENABLE',slug:'example'},fetcher);
  assert.equal(creates,1);
  const a=await marketplaceAction(f.o,{action:'AVAILABLE'},fetcher),b=await marketplaceAction(f.out,{action:'AVAILABLE'},fetcher);
  assert.ok('integrations' in a&&Array.isArray(a.integrations)&&'integrations' in b&&Array.isArray(b.integrations));
  assert.deepEqual(a.integrations.map(s=>s.integration),[expected]);
  assert.deepEqual(b.integrations.map(s=>s.integration),[foreign]);
 }finally{await f.cleanup();}
});

test('an organisation can manage 1,000 targets and retrieve a connection outside the recent history window',async()=>{
 const {operationsWorkspace}=await import('../lib/server/operations-service');
 const {maxWorkspaceConnectorTargets}=await import('../lib/connectors/capacity');
 const f=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_UBIBOT_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});
 try{
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'fleet',title:'Site devices',description:'Monitor the site equipment',testProcedure:'Verify the current source',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const base={organizationId:f.a.id,controlId:control.id,configuredById:f.o.userId,provider:'GITHUB',branch:'main'};
  const oldest=await db.evidenceConnector.create({data:{...base,repository:'example/oldest',createdAt:new Date('2020-01-01T00:00:00Z')}});
  await db.evidenceConnector.createMany({data:Array.from({length:maxWorkspaceConnectorTargets-2},(_,i)=>({...base,repository:'example/fleet-'+i}))});
  const input={provider:'GITHUB',repository:'example/last',branch:'main',controlId:control.id,version:0,enabled:false,intervalHours:24,token:'github_pat_'+'F'.repeat(22)};
  await saveConnector(f.o,input);
  await assert.rejects(saveConnector(f.o,{...input,repository:'example/over-limit'}),rejects(429));
  const overview=await operationsWorkspace(f.o);
  assert.equal(overview.connectionDirectory.length,1000);assert.equal(overview.connectors.length,20);
  assert.equal(overview.connectors.some(c=>c.id===oldest.id),false);
  assert.deepEqual((await operationsWorkspace(f.ad,undefined,oldest.id)).connectors.map(row=>row.id),[oldest.id]);
  assert.equal((await operationsWorkspace(f.out,undefined,oldest.id)).connectors.length,0);
  const {getConnectorHealth,exportConnectorHealth}=await import('../lib/server/connector-health-service');
  const {researchWorkspaceQuestion}=await import('../lib/server/company-knowledge-service');
  const {hashValue}=await import('../lib/regulatory/intelligence');
  const capturedAt=new Date(Date.now()-25*3600000),result={engine:'fleet-fixture',sourceUrl:'https://example.invalid/oldest',capturedAt:capturedAt.toISOString(),
    checks:[{id:'test',label:'Required review',status:'FAIL',observed:'Review missing',nextStep:'Assign reviewer'}],limitations:[]};
  await db.connectorRun.create({data:{organizationId:f.a.id,connectorId:oldest.id,leaseToken:randomUUID(),configVersion:oldest.version,
    result,resultHash:hashValue(result),signalHash:hashValue({engine:result.engine,checks:result.checks}),outcome:'FOLLOW_UP',capturedAt}});
  await db.evidenceConnector.update({where:{id:oldest.id},data:{enabled:true,lastSuccessAt:capturedAt,failureCode:'CREDENTIAL_REJECTED'}});
  const first=await getConnectorHealth(f.ad);
  assert.equal(first.configured,1000);assert.equal(first.pages,50);assert.equal(first.items.length,20);
  assert.equal(first.countsByFilter.overdue,1);assert.equal(first.countsByFilter['failed-checks'],1);assert.equal(first.countsByFilter['awaiting-read'],999);
  const last=await getConnectorHealth(f.ad,{page:50});assert.ok(last.items.some(row=>row.id===oldest.id));
  const issue=await getConnectorHealth(f.st,{q:'Site devices',filter:'collection-failed'});
  assert.equal(issue.matched,1);assert.equal(issue.items[0].id,oldest.id);assert.equal(issue.items[0].status,'revoked');
  assert.equal(issue.items[0].findings[0].observed,'Review missing');
  const filtered=await getConnectorHealth(f.ad,{q:'example/oldest',filter:'failed-checks',page:51});
  assert.equal(filtered.page,1);assert.equal(filtered.items[0].runId,issue.items[0].runId);
  const csv=await exportConnectorHealth(f.st,{});assert.equal(csv.rows,1000);assert.equal(csv.csv.split('\r\n').length,1001);
  const report=await exportConnectorHealth(f.st,{q:f.editor.email,filter:'failed-checks'});assert.equal(report.rows,1);
  assert.ok(report.csv.includes(oldest.id)&&report.csv.includes(issue.items[0].runId!));
  assert.ok(!(await exportConnectorHealth(f.out,{})).csv.includes(oldest.id));
  Object.assign(process.env,{REGPILOT_EVIDENCE_ENABLED:'true',REGPILOT_ASSURANCE_ENABLED:'true',
    SUPABASE_SECRET_KEY:'fictional',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture'});
  const answer=await researchWorkspaceQuestion(f.ad,{question:'Check oldest repository evidence'},async()=>({
    status:'no_match' as const,catalogueSize:0,nations:[],checked:[],unavailable:0,citations:[],answer:{points:[],model:null}}));
  assert.deepEqual(answer.connections.map(row=>row.id),[oldest.id]);
  await db.evidenceConnector.update({where:{id:oldest.id},data:{version:{increment:1}}});
  assert.equal((await getConnectorHealth(f.ad,{filter:'failed-checks'})).matched,0);
  assert.equal((await getConnectorHealth(f.ad,{filter:'awaiting-read'})).matched,1000);

 }finally{await f.cleanup();}
});

test('customer model proof requires active ownership, generation, repeated collection and an observed credential replacement',async()=>{
 const {marketplaceAction,aiChoice,resolveCustomerAi}=await import('../lib/server/integration-marketplace');
 const {recordModelInference}=await import('../lib/server/direct-model-account');
 const {declareSource,customerSourceProof,proofTargets}=await import('../lib/server/customer-source-proof');
 const f=await assuranceFixture(),original=globalThis.fetch;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});
 try{
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'ai',title:'Model access',description:'Verify named model',testProcedure:'Check access and independent attribution',theme:'technology',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const config={provider:'OPENAI_PROJECT_MODEL',scope:'proj_stage',record:'staging-model',controlId:control.id,consent:true,enabled:true,intervalHours:24};
  let expected=token;
  globalThis.fetch=async(raw,init)=>{assert.equal(new Headers(init?.headers).get('OpenAI-Project'),config.scope);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+expected);assert.equal(String(raw),'https://api.openai.com/v1/models/staging-model');return Response.json({object:'model',id:config.record});};
  const first=await saveConnector(f.o,{...config,token,version:0});
  assert.equal((await proofTargets(f.out)).length,0);await assert.rejects(customerSourceProof(f.ed,first.id),rejects(403));
  assert.equal((await verifyConnectorNow(f.o,first.id,first.version)).outcome,'OBSERVED');
  expected=token+'-renewed';
  const next=await saveConnector(f.o,{...config,id:first.id,version:first.version,token:expected});
  const declaration={connectionId:next.id,configVersion:next.version,category:'CUSTOMER' as const,confirm:true as const};
  await assert.rejects(declareSource(f.o,declaration),rejects(403));await declareSource(f.ad,declaration);
  await db.evidenceConnector.update({where:{id:next.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  await verifyConnectorNow(f.o,next.id,next.version);
  let proof=await customerSourceProof(f.o,next.id);
  assert.deepEqual([proof.current,proof.repeat,proof.rotated,proof.inference,proof.customerVerified],[true,false,true,false,false]);
  const bind={action:'SET_DIRECT_AI',connectionId:next.id,configVersion:next.version,previous:null,confirmDrafting:true};
  await assert.rejects(marketplaceAction(f.out,bind),rejects(409));await marketplaceAction(f.o,bind);
  const choice=await aiChoice(f.o),account=await resolveCustomerAi(f.ed,choice.version!);assert.ok('modelConnector' in account);
  await recordModelInference(f.ed,account,choice.version!,'fixture-request-id');
  const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:next.id,configVersion:next.version}});
  await db.connectorRun.update({where:{id:run.id},data:{capturedAt:new Date(Date.now()-25*3600000)}});
  await db.evidenceConnector.update({where:{id:next.id},data:{lastSuccessAt:new Date(Date.now()-600000)}});
  await verifyConnectorNow(f.o,next.id,next.version);
  proof=await customerSourceProof(f.o,next.id);assert.equal(proof.customerVerified,true);
  await marketplaceAction(f.o,{action:'UNLINK_AI',previous:choice.version});
  assert.equal((await customerSourceProof(f.o,next.id)).customerVerified,false);
  await assert.rejects(recordModelInference(f.ed,account,choice.version!,'after-unlink'),rejects(409));
  const events=await db.auditEvent.findMany({where:{entityId:next.id}});assert.doesNotMatch(JSON.stringify(events),/fictional-connector-token/);
 }finally{globalThis.fetch=original;await f.cleanup();}
});

test('each public pharmaceutical register can be enrolled without a secret, collected and exported from its owning workspace',async()=>{
 const {referenceRegisters}=await import('../lib/connectors/pharma-registers');
 const f=await assuranceFixture(),original=globalThis.fetch;
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional'});
 try{
  const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'registers',title:'Pharmaceutical register monitoring',description:'Review identified public releases',testProcedure:'Review current source records',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
  const [nhs,trial,fda,label,paper,guide]=referenceRegisters,pkgId='2aab7706-8c93-42f6-9f49-39a53cfdaa1c';
  const resource={id:nhs.target.record,package_id:pkgId,state:'active',format:'CSV',name:'BNF_SNOMED_MAPPING_DATA_202609'};
  globalThis.fetch=async(raw,req)=>{
   assert.equal(new Headers(req?.headers).has('Authorization'),false);
   const url=new URL(String(raw));
   if(url.host==='opendata.nhsbsa.net')return Response.json({success:true,result:url.pathname.endsWith('package_show')?{id:pkgId,name:nhs.target.scope,num_resources:1,state:'active',resources:[resource]}:resource});
   if(url.host==='clinicaltrials.gov')return Response.json({protocolSection:{identificationModule:{nctId:trial.target.scope},statusModule:{overallStatus:'COMPLETED',lastUpdatePostDateStruct:{date:'2025-09-10'},resultsFirstPostDateStruct:{date:'2025-08-10'}}}});
   if(url.host==='dailymed.nlm.nih.gov')return Response.json({metadata:{current_page:1,total_pages:1,total_elements:1},data:{
    spl:{setid:label.target.scope},history:[{spl_version:Number(label.target.record),published_date:'Jun 15, 2026'}]}});
   if(url.host==='www.ebi.ac.uk')return Response.json({hitCount:1,resultList:{result:[{source:'MED',id:paper.target.scope,pmid:paper.target.scope,
    doi:paper.target.reference,dateOfRevision:paper.target.record,pubTypeList:{pubType:['Journal Article']}}]}});
   if(url.host==='www.gov.uk')return Response.json({content_id:guide.target.record,base_path:'/guidance/'+guide.target.scope,document_type:'detailed_guide',
    public_updated_at:guide.target.reference,withdrawn_notice:{},links:{primary_publishing_organisation:[{content_id:'240f72bd-9a4d-4f39-94d9-77235cadde8e'}]}});
   assert.equal(url.host,'api.fda.gov');return Response.json({meta:{results:{total:1}},results:[{event_id:fda.target.scope,recall_number:fda.target.record,product_type:'Drugs',classification:'Class II',status:'Terminated',report_date:'20250304',recall_initiation_date:'20250301',termination_date:'20250401'}]});
  };
  for(const {provider,target} of referenceRegisters){
   const input={provider,...target,controlId:control.id,consent:true,enabled:true,intervalHours:24,version:0};
   await assert.rejects(saveConnector(f.o,{...input,token:'unexpected-customer-secret'}));
   const saved=await saveConnector(f.o,input),result=await verifyConnectorNow(f.o,saved.id,saved.version);
   assert.equal(result.outcome,'OBSERVED',provider);
   const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id}});assert.equal((await exportConnectorRun(f.o,run.id)).currentAtExport,true);
   await assert.rejects(exportConnectorRun(f.out,run.id),rejects(404));
  }
 }finally{globalThis.fetch=original;await f.cleanup();}
});

test('live publication changes reach a private workspace control and its follow-up',
 {skip:process.env.REGPILOT_PUBLIC_REGISTER_ACCEPTANCE!=='true'},async()=>{
  const {referenceRegisters}=await import('../lib/connectors/register-targets');
  const f=await assuranceFixture();
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',
    REGPILOT_CONNECTOR_ENCRYPTION_KEY:'dc'.repeat(32),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
  try {
    const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,
      inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
    const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,
      proposalKey:'public-revisions',title:'Reviewed public source revisions',description:'Identify an update requiring review',
      testProcedure:'Compare the real publisher revision with the baseline',theme:'quality',ownerId:f.editor.id,
      scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    const {recordTrial,trialWorkspace}=await import('../lib/server/capability-trial-service');
    const steps=['connect-first','find-failure','export-reading'];
    const trial=await recordTrial(f.o,{action:'START',requestKey:randomUUID(),release:'a'.repeat(40),track:'operator_pilot',environment:'FIXTURE',ukExternal:false,firstTime:true,steps,intendedUse:'Automated rehearsal against a live publication in a disposable workspace.'});
    const baselines={DAILYMED_LABEL:{record:'34'},EUROPE_PMC:{record:'2021-01-01'},MHRA_GUIDANCE:{reference:'2020-01-01T00:00:00Z'}} as const;
    for(const [provider,baseline] of Object.entries(baselines)){
      const source=referenceRegisters.find(r=>r.provider===provider)!;
      const input={provider,...source.target,...baseline,controlId:control.id,version:0,consent:true,enabled:true,intervalHours:24};
      await assert.rejects(saveConnector(f.out,input),rejects(404));
      const connection=await saveConnector(f.o,input);
      let observed=await verifyConnectorNow(f.o,connection.id,connection.version);
      if(observed.outcome==='RETRY_SCHEDULED'){
        const failure=await db.evidenceConnector.findUniqueOrThrow({where:{id:connection.id},select:{failureCode:true,lastSuccessAt:true}});
        assert.ok(failure.failureCode==='PROVIDER_TIMEOUT'||failure.failureCode==='PROVIDER_UNAVAILABLE',provider+' reported '+failure.failureCode);
        assert.equal(failure.lastSuccessAt,null);
        assert.equal(await db.connectorRun.count({where:{connectorId:connection.id}}),0);
        console.info(provider+' recorded '+failure.failureCode+' before its first observation. Retrying the same connection once.');
        await new Promise(resolve=>setTimeout(resolve,10_000));
        observed=await verifyConnectorNow(f.o,connection.id,connection.version);
      }
      if(observed.outcome!=='FOLLOW_UP'){
        const connectionState=await db.evidenceConnector.findUniqueOrThrow({where:{id:connection.id},select:{failureCode:true}});
        assert.fail(provider+' returned '+observed.outcome+' ('+(connectionState.failureCode??'no provider failure')+'). Expected the live revision to create a follow-up.');
      }
      const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:connection.id}});
      assert.equal((await exportConnectorRun(f.o,run.id)).currentAtExport,true);
      await assert.rejects(exportConnectorRun(f.out,run.id),rejects(404));
      assert.equal(await db.obligation.count({where:{organizationId:f.a.id,connectorId:connection.id,status:{not:'COMPLETE'}}}),1);
      const task=await db.obligation.findFirstOrThrow({where:{organizationId:f.a.id,connectorId:connection.id}});
      const receipt=(await workTask(f.ed,task.id)).sourceObservations!;
      assert.equal(receipt.items[0].runId,run.id);assert.ok(receipt.items[0].exceptionCount>0);
      assert.equal((await workTask(f.st,task.id)).sourceObservations,null);
      if(provider==='DAILYMED_LABEL'){
       await exportConnectorRun(f.o,run.id,task.id);
       for(const step of steps)await recordTrial(f.o,{action:'CHECKPOINT',id:trial.id,key:randomUUID(),step,kind:'COMPLETED',note:'Automated rehearsal executed this step.'});
       await recordTrial(f.o,{action:'STOP',id:trial.id});
       await recordTrial(f.o,{action:'FINISH',id:trial.id,results:steps.map(step=>({step,runId:run.id,evidenceId:null,outcome:'PASS',notes:'Verified the live label through the source task.',assisted:false,edits:0,unsupported:0}))});
       await recordTrial(f.ad,{action:'REVIEW',id:trial.id,decision:'ACCEPT',notes:'Verified the scoped collection and authenticated export in the fixture.'});
       assert.equal((await trialWorkspace(f.o)).trials.find(t=>t.id===trial.id)?.accepted,true);
      }
    }
  } finally {await f.cleanup();}
});

test('a sealed independent publisher sample distinguishes observed items, missing records and incomplete coverage',async()=>{
 const {coverageSample,measureCoverage}=await import('../lib/horizon/coverage-sample');
 const {recordPublicationSample,publicationSamples}=await import('../lib/server/publication-sample');
 const {PUBLISHERS,validateReport}=await import('../lib/horizon/model');
 const f=await assuranceFixture(),today=new Date(),stamp=today.toISOString(),on=new Date(+today-2*86400000).toISOString().slice(0,10);
 try{
  const url='https://www.gov.uk/guidance/test-sample',sample={title:'External publication sample',publisher:'mhra',method:'Assessor selected the dated records from the original authority list.',entries:[{on,url},{on,url:url+'-missing'}]};
  const report=validateReport({format:'regpilot-horizon-v1',previousAvailable:true,codeCommit:'a'.repeat(40),runId:'1',generatedAt:stamp,windowStart:new Date(+today-30*86400000).toISOString(),limitations:[],feeds:PUBLISHERS.map(p=>({id:p.id,state:'available',checkedAt:stamp,total:1,retrieved:1,reason:null})),items:[{id:'a'.repeat(32),revision:'b'.repeat(32),path:'/guidance/test-sample',url,title:'Fictional publication',summary:'Fictional public metadata',documentType:'guide',kind:'Guidance',publisherIds:['mhra'],updatedAt:on+'T12:00:00Z',firstSeenAt:stamp,observedAt:stamp,discovery:'FIRST_SEEN'}]});
  const id=crypto.randomUUID();await recordPublicationSample(f.o,{action:'SEAL',id,sample});
  const score={action:'SCORE',id,confirmed:true};
  await assert.rejects(recordPublicationSample(f.o,score,async()=>{throw Error('Early read');}),rejects(403));
  await assert.rejects(recordPublicationSample(f.out,score,async()=>report),rejects(404));
  await recordPublicationSample(f.ad,score,async()=>report);await recordPublicationSample(f.ad,score,async()=>{throw Error('Already decided');});
  const recorded=(await publicationSamples(f.o)).samples[0].result!;assert.equal(recorded.found,1);assert.equal(recorded.missing,1);assert.equal(recorded.measurable,2);
  const partial={...report,feeds:report.feeds.map(p=>p.id==='mhra'?{...p,state:'limited' as const}:p)};
  assert.equal(measureCoverage(sample,partial).indeterminate,1);
  const wrong={...report,items:report.items.map(i=>({...i,publisherIds:['dhsc']}))};assert.equal(measureCoverage(sample,wrong).wrongPublisher,1);
  const fda=coverageSample.parse({...sample,publisher:'us-fda',entries:[{on,url:'https://api.fda.gov/drug/enforcement.json?search=recall_number%3A%22D-123-2026%22'}]});
  assert.equal(measureCoverage(fda,report).rows[0].url,'https://api.fda.gov/drug/enforcement.json?search=recall_number:%22D-123-2026%22');
  assert.throws(()=>coverageSample.parse({...sample,entries:[sample.entries[0],sample.entries[0]]}));assert.throws(()=>coverageSample.parse({...sample,entries:[{on,url:'https://other.example/'}]}));
 }finally{await f.cleanup();}
});
