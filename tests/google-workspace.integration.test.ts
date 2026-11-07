import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {saveConnector,claimConnector,executeConnector,disconnectConnector,exportConnectorRun} from "../lib/server/connector-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import type {Observation} from "../lib/connectors/observation";
test("Google Workspace configuration encrypts both credentials, respects tenant and flag boundaries, and fences rotation",async()=>{
 const x=await assuranceFixture(),{o,ed,out}=x,customerId="CAbCdE123",clientId="fictional-client-123.apps.googleusercontent.com",clientSecret="fictional-google-client-secret",refreshToken="fictional-google-refresh-token";
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_GOOGLE_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"ab".repeat(32),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture"});
 try{
  const programme=await db.programmeImport.create({data:{organizationId:x.a.id,createdById:o.userId,inputHash:x.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:x.a.id,importId:programme.id,proposalKey:"fictional-google",title:"Fictional identity control",description:"Review aggregate 2SV settings",testProcedure:"Inspect Directory settings independently of actual sign-in enforcement",theme:"security",ownerId:ed.userId,scheduledById:o.userId,intervalDays:30,nextReviewAt:new Date()}});
  const config={provider:"GOOGLE_WORKSPACE",customerId,clientId,clientSecret,refreshToken,consent:true,controlId:control.id,version:0,enabled:true,intervalHours:24};
  await assert.rejects(()=>saveConnector(ed,config),rejects(403));await assert.rejects(()=>saveConnector(out,config),rejects(404));await assert.rejects(()=>saveConnector(o,{...config,consent:false}),rejects(400));
  process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED="false";await assert.rejects(()=>saveConnector(o,config),rejects(503));process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED="true";
  const saved=await saveConnector(o,config),initial=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});
  assert.equal(initial.repository,"googleworkspace:"+customerId);assert.doesNotMatch(initial.encryptedSecret!,/fictional-google/);
  await assert.rejects(()=>saveConnector(o,{...config,id:saved.id,version:initial.version,customerId:"COther123",clientSecret:undefined,refreshToken:undefined}),rejects(400));
  const observation=(value="4 enforced"):Observation=>({engine:"google-workspace-identity-1.0.0",sourceUrl:"https://admin.google.com/",capturedAt:new Date().toISOString(),checks:[{id:"active-2sv-enforcement",label:"Fictional 2SV setting",status:"PASS",observed:value,nextStep:"Review with your administrator."}],limitations:["Fictional fixture; no provider calls."]});
  process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED="false";assert.equal(await claimConnector(),null);process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED="true";
  const claims=await Promise.all([claimConnector(),claimConnector()]);assert.equal(claims.filter(Boolean).length,1);
  assert.equal(await executeConnector(claims.find(Boolean)!,async(target,secret)=>{assert.equal(target.provider,"GOOGLE_WORKSPACE");assert.equal(target.repository,"googleworkspace:"+customerId);assert.deepEqual(JSON.parse(secret),{clientSecret,refreshToken});return observation();}),"OBSERVED");
  const claim=async()=>{await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});const job=await claimConnector();assert.ok(job);return job;};
  assert.equal(await executeConnector(await claim(),async()=>observation("5 enforced")),"OBSERVED");assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:"OPEN",assigneeId:ed.userId}}),1);
  const runs=await db.connectorRun.findMany({where:{connectorId:saved.id}});await assert.rejects(()=>exportConnectorRun(out,runs[0].id),rejects(404));
  const rotating=await claim();assert.equal(await executeConnector(rotating,async()=>{await saveConnector(o,{...config,id:saved.id,version:rotating.version,refreshToken:refreshToken+"-rotated"});return observation();}),"SUPERSEDED");
  const gated=await claim();assert.equal(await executeConnector(gated,async()=>{process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED="false";return observation();}),"ATTENTION");assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),runs.length);
  assert.doesNotMatch(JSON.stringify(await operationsWorkspace(o)),/fictional-google-(client-secret|refresh-token)|encryptedSecret|leaseToken/);
  assert.equal((await operationsWorkspace(out)).connectors.length,0);assert.doesNotMatch(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:x.a.id}})),/fictional-google-(client-secret|refresh-token)/);
  const c=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});await disconnectConnector(o,c.id,c.version);assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}})).encryptedSecret,null);
 }finally{
  await db.connectorRun.deleteMany({where:{organizationId:x.a.id}});await db.obligation.deleteMany({where:{organizationId:x.a.id,connectorId:{not:null}}});await db.evidenceConnector.deleteMany({where:{organizationId:x.a.id}});await x.cleanup();
 }
});
