import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {saveConnector,claimConnector,executeConnector,exportConnectorRun,disconnectConnector} from "../lib/server/connector-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {MicrosoftObservation} from "../lib/connectors/microsoft365";
import {CollectionError} from "../lib/connectors/github";

test("Microsoft identity monitoring: tenant isolation, consent, encrypted secrets, scheduled changes, failure tasks and permission fencing",async()=>{
 const suffix=randomUUID(),users=await Promise.all(["admin","owner","outside"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}}))),orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional identity "+n+suffix}}))),ids=orgs.map(o=>o.id);
 const admin:AuthorizedContext={userId:users[0].id,organizationId:ids[0],role:"OWNER"},owner:AuthorizedContext={...admin,userId:users[1].id,role:"EDITOR"},outside:AuthorizedContext={userId:users[2].id,organizationId:ids[1],role:"OWNER"};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_MICROSOFT365_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"cd".repeat(32),REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture"});
 const tenantId=randomUUID(),clientId=randomUUID(),secret="fixture-secret-never-sent-to-microsoft";
 const observation=(status:"PASS"|"UNKNOWN"|"FAIL"="PASS",value="3 of 3 registered"):MicrosoftObservation=>({engine:"microsoft365-identity-1.0.0",tenantId,sourceUrl:"https://entra.microsoft.com/",capturedAt:new Date().toISOString(),checks:[{id:"member-mfa-registration",label:"Fictional member registration",status,observed:value,nextStep:"Review Microsoft Entra settings."}],coverage:{records:3,members:3,guests:0,unknownType:0,pages:1,complete:true,reportAvailable:true,staleRecords:0,missingDates:0},limitations:["Fictional aggregate; no external request."]});
 try{
  await db.membership.createMany({data:[admin,owner,outside]});
  // Accepted-programme fixture isolates connector behaviour; real acceptance is covered by operations.integration.
  const programme=await db.programmeImport.create({data:{organizationId:ids[0],createdById:admin.userId,inputHash:suffix,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
  const control=await db.managedControl.create({data:{organizationId:ids[0],importId:programme.id,proposalKey:"fictional-identity",title:"Fictional identity control",description:"Review member MFA registration",testProcedure:"Inspect dated report and confirm policy enforcement separately",theme:"security",ownerId:owner.userId,scheduledById:admin.userId,intervalDays:30,nextReviewAt:new Date()}});
  const config={provider:"MICROSOFT365",tenantId,clientId,clientSecret:secret,consent:true,controlId:control.id,version:0,enabled:true,intervalHours:24};
  await assert.rejects(()=>saveConnector(admin,{...config,consent:false}),(e:any)=>e.status===400);
  await assert.rejects(()=>saveConnector(owner,config),(e:any)=>e.status===403);
  await assert.rejects(()=>saveConnector(outside,config),(e:any)=>e.status===404);
  process.env.REGPILOT_MICROSOFT365_ENABLED="false";await assert.rejects(()=>saveConnector(admin,config),(e:any)=>e.status===503);process.env.REGPILOT_MICROSOFT365_ENABLED="true";
  const saved=await saveConnector(admin,config);let connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});
  assert.equal(connector.provider,"MICROSOFT365");assert.equal(connector.repository,"microsoft365:"+tenantId);assert.notEqual(connector.encryptedSecret,secret);
  await assert.rejects(()=>saveConnector(admin,config),(e:any)=>e.status===409);
  await assert.rejects(()=>saveConnector(admin,{...config,id:saved.id,version:connector.version,tenantId:randomUUID(),clientSecret:undefined}),(e:any)=>e.status===400);
  await assert.rejects(()=>saveConnector(admin,{provider:"GITHUB",repository:"example/fixture",branch:"main",token:"github_pat_"+"fixture".repeat(8),controlId:control.id,id:saved.id,version:connector.version,enabled:true,intervalHours:24}),(e:any)=>e.status===409);
  process.env.REGPILOT_MICROSOFT365_ENABLED="false";assert.equal(await claimConnector(),null);process.env.REGPILOT_MICROSOFT365_ENABLED="true";
  const claims=await Promise.all([claimConnector(),claimConnector()]);assert.equal(claims.filter(Boolean).length,1);const job=claims.find(Boolean)!;
  assert.equal(await executeConnector(job,async(target,key)=>{assert.equal(target.provider,"MICROSOFT365");assert.equal(target.branch,clientId);assert.equal(key,secret);return observation();}),"OBSERVED");
  assert.equal(await db.obligation.count({where:{connectorId:saved.id}}),0);
  let runs=await db.connectorRun.findMany({where:{connectorId:saved.id},orderBy:{capturedAt:"desc"}});assert.equal((await exportConnectorRun(admin,runs[0].id)).currentAtExport,true);
  await assert.rejects(()=>exportConnectorRun(outside,runs[0].id),(e:any)=>e.status===404);
  const claim=async()=>{await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});const next=await claimConnector();assert.ok(next);return next;};
  // A changed value is actionable even when every check remains observed.
  assert.equal(await executeConnector(await claim(),async()=>observation("PASS","4 of 4 registered")),"OBSERVED");
  let task=await db.obligation.findFirstOrThrow({where:{connectorId:saved.id,status:"OPEN"}});assert.equal(task.assigneeId,owner.userId);assert.equal(task.controlId,control.id);
  let workspace=await operationsWorkspace(admin);let c=workspace.connectors[0];assert.equal(c.provider,"MICROSOFT365");assert.equal(c.changes[0].observedBefore,"3 of 3 registered");assert.equal(c.changes[0].observedAfter,"4 of 4 registered");assert.ok(c.runs[0].current);
  assert.doesNotMatch(JSON.stringify(workspace),/fixture-secret|encryptedSecret|leaseToken/);assert.equal((await operationsWorkspace(outside)).connectors.length,0);
  await executeConnector(await claim(),async()=>observation("FAIL","2 not registered"));await executeConnector(await claim(),async()=>observation("UNKNOWN","Report unavailable"));assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:"COMPLETE"}}}),1);
  await executeConnector(await claim(),async()=>observation());assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,"OPEN");
  await db.obligation.update({where:{id:task.id},data:{status:"COMPLETE"}});
  assert.equal(await executeConnector(await claim(),async()=>{throw new CollectionError("CREDENTIAL_REJECTED");}),"ATTENTION");
  connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});assert.equal(connector.enabled,false);assert.equal(connector.failureCode,"CREDENTIAL_REJECTED");assert.ok(connector.lastSuccessAt);
  task=await db.obligation.findFirstOrThrow({where:{connectorId:saved.id,status:"OPEN"}});assert.equal(task.assigneeId,owner.userId);workspace=await operationsWorkspace(admin);assert.ok(workspace.connectors[0].stale);assert.equal(workspace.connectors[0].runs[0].current,false);
  await saveConnector(admin,{...config,id:saved.id,version:connector.version});
  const count=await db.connectorRun.count({where:{connectorId:saved.id}}),rotating=await claim();
  assert.equal(await executeConnector(rotating,async()=>{await saveConnector(admin,{...config,id:saved.id,version:rotating.version,clientSecret:secret+"-rotated"});return observation();}),"SUPERSEDED");assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),count);
  const gated=await claim();assert.equal(await executeConnector(gated,async()=>{process.env.REGPILOT_MICROSOFT365_ENABLED="false";return observation();}),"SUPERSEDED");assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),count);process.env.REGPILOT_MICROSOFT365_ENABLED="true";
  // Expire the superseded fixture lease before the next collection.
  await db.evidenceConnector.update({where:{id:saved.id},data:{leaseUntil:new Date(0)}});
  const revoked=await claim();assert.equal(await executeConnector(revoked,async()=>{await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:admin.userId}},data:{role:"VIEWER"}});return observation();}),"ATTENTION");assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),count);
  await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:admin.userId}},data:{role:"OWNER"}});
  connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});await saveConnector(admin,{...config,id:saved.id,version:connector.version});await executeConnector(await claim(),async()=>observation());
  runs=await db.connectorRun.findMany({where:{connectorId:saved.id},orderBy:{capturedAt:"desc"}});await db.connectorRun.update({where:{id:runs[0].id},data:{capturedAt:new Date(Date.now()-25*3600000)}});
  assert.equal((await exportConnectorRun(admin,runs[0].id)).currentAtExport,false);assert.ok((await operationsWorkspace(admin)).connectors[0].stale);
  connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});await disconnectConnector(admin,saved.id,connector.version);connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});assert.equal(connector.encryptedSecret,null);
  await assert.rejects(()=>saveConnector(admin,{...config,id:saved.id,version:connector.version,clientSecret:undefined}),(e:any)=>e.status===400);
  assert.doesNotMatch(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:ids[0]}})),/fixture-secret|fictional-access-token/);
 }finally{
  for(const name of ["connectorRun","auditEvent","obligation","evidenceConnector","managedControl","programmeImport","membership"] as const)await (db[name] as any).deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
 }
});
