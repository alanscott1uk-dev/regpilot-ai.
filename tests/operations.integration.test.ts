import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {prepareProgramme,acceptProgramme,redactProgramme} from "../lib/server/programme-service";
import {configureControl,mapControl,generateDueReviews,runReviewBatch} from "../lib/server/control-service";
import {saveConnector,disconnectConnector,claimConnector,executeConnector,exportConnectorRun,requestConnectorRun} from "../lib/server/connector-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import {createEvidence,reviewEvidence} from "../lib/server/evidence-service";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {ProgrammeResult} from "../lib/programme/import";
import {type GithubObservation,CollectionError} from "../lib/connectors/github";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";

test("programme operations: scoped imports, independent acceptance, recurrence, mappings, connector leases and permission fencing",async()=>{
 const suffix=randomUUID(),users=await Promise.all(["maker","reviewer","uploader","outside"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}}))),orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional operations "+n+suffix}}))),ids=orgs.map(o=>o.id);
 const maker:AuthorizedContext={userId:users[0].id,organizationId:ids[0],role:"OWNER"},reviewer:AuthorizedContext={...maker,userId:users[1].id,role:"ADMIN"},uploader:AuthorizedContext={...maker,userId:users[2].id,role:"EDITOR"},outside:AuthorizedContext={userId:users[3].id,organizationId:ids[1],role:"OWNER"};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_PROGRAMME_ENABLED:"true",REGPILOT_PROGRAMME_AI_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_AUTOMATION_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"ab".repeat(32),REGPILOT_AI_ENABLED:"true",REGPILOT_AI_SAFEGUARDS_VERIFIED:"true",REGPILOT_AI_MODEL:"test/fictional",AI_GATEWAY_API_KEY:"fixture-never-used",REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_DAILY_USER_LIMIT:"10",REGPILOT_AI_DAILY_ORG_LIMIT:"10"});
 const objects=new Map<string,Uint8Array>(),store:EvidenceObjectStore={async put(k,b){objects.set(k,Uint8Array.from(b));},async get(k){const b=objects.get(k);if(!b)throw Error("Fixture missing");return Uint8Array.from(b);},async remove(k){objects.delete(k);}},clean=async()=>({status:"CLEAN" as const,engine:"fixture-only"});
 const quote="Fictional widget staff must retain training records unless a documented exemption applies.",pdf=fixturePdf([[quote]]),notes="Independently checked original fictional records, scope, exceptions, proposed tests and the operational review schedule.",today=new Date().toISOString().slice(0,10);
 const token="github_pat_"+"fixtureNeverUsed".repeat(3);
 const observation=(status:"PASS"|"UNKNOWN"|"FAIL"="PASS"):GithubObservation=>({engine:"github-branch-1.0.0",repository:"example/fixture",branch:"main",sourceUrl:"https://github.com/example/fixture/settings/branches",capturedAt:new Date().toISOString(),checks:[{id:"peer-review",label:"Fictional peer review signal",status,observed:status,nextStep:"Inspect scope and settings."}],limitations:["Fictional collection fixture; no external request."]});
 try{
  await db.membership.createMany({data:[maker,reviewer,uploader,outside]});
  const task=await db.obligation.create({data:{organizationId:ids[0],title:"Fictional programme intake",category:"Programme",ownerName:users[0].email,dueDate:new Date()}}),foreignTask=await db.obligation.create({data:{organizationId:ids[1],title:"Foreign task",category:"Programme",ownerName:users[3].email,dueDate:new Date()}});
  const evidence=await createEvidence(uploader,task.id,"fictional-programme.pdf",pdf,{storage:store,scan:clean});await reviewEvidence(reviewer,evidence.id,{decision:"APPROVED",version:1,notes},store);
  const input={evidenceIds:[evidence.id],method:"SEARCH",consent:true};
  await assert.rejects(()=>prepareProgramme(outside,input,{storage:store}),(e:any)=>e.status===409);
  await assert.rejects(()=>prepareProgramme(maker,{...input,consent:false},{storage:store}),(e:any)=>e.status===400);
  const prepared=await prepareProgramme(maker,input,{storage:store});assert.equal((await prepareProgramme(maker,input,{storage:store})).id,prepared.id);
  const row=await db.programmeImport.findUniqueOrThrow({where:{id:prepared.id}}),result=row.result as unknown as ProgrammeResult;assert.equal(result.controls.length,1);
  const approval={version:row.version,keys:result.controls.map(c=>c.key),ownerId:uploader.userId,intervalDays:30,firstReview:today,notes,scopeConfirmed:true};
  await assert.rejects(()=>acceptProgramme(maker,row.id,approval,{storage:store}),(e:any)=>e.status===403);
  await assert.rejects(()=>acceptProgramme(uploader,row.id,approval,{storage:store}),(e:any)=>e.status===403);
  await assert.rejects(()=>acceptProgramme(outside,row.id,approval,{storage:store}),(e:any)=>e.status===404);
  await assert.rejects(()=>acceptProgramme(reviewer,row.id,{...approval,ownerId:outside.userId},{storage:store}),(e:any)=>e.status===409);
  const original=await db.evidence.findUniqueOrThrow({where:{id:evidence.id}});objects.set(original.storageKey,fixturePdf([["Tampered fictional programme record."]]));await assert.rejects(()=>acceptProgramme(reviewer,row.id,approval,{storage:store}),(e:any)=>e.status===409);objects.set(original.storageKey,pdf);
  const accepted=await acceptProgramme(reviewer,row.id,approval,{storage:store}),controlId=accepted.controlIds[0];assert.equal(accepted.controlIds.length,1);
  await assert.rejects(()=>acceptProgramme(reviewer,row.id,approval,{storage:store}),(e:any)=>e.status===409);
  const pair=await Promise.all([generateDueReviews(reviewer),generateDueReviews(reviewer)]);assert.equal(pair.reduce((n,r)=>n+r.created,0),1);
  let control=await db.managedControl.findUniqueOrThrow({where:{id:controlId}});assert.ok(control.nextReviewAt>new Date());
  let reviewTask=await db.obligation.findFirstOrThrow({where:{controlId,connectorId:null}});assert.equal(reviewTask.assigneeId,uploader.userId);assert.equal(reviewTask.originKey,null);
  await db.managedControl.update({where:{id:controlId},data:{nextReviewAt:new Date("2020-01-01")}});assert.equal((await generateDueReviews(reviewer)).waiting,1);
  await db.obligation.update({where:{id:reviewTask.id},data:{status:"COMPLETE"}});assert.equal((await generateDueReviews(reviewer)).created,1);control=await db.managedControl.findUniqueOrThrow({where:{id:controlId}});assert.ok(control.nextReviewAt>new Date());
  await configureControl(reviewer,controlId,{version:control.version,ownerId:maker.userId,intervalDays:30,nextReview:today,enabled:true});assert.equal((await db.obligation.findFirstOrThrow({where:{controlId,status:{not:"COMPLETE"}}})).assigneeId,maker.userId);
  await assert.rejects(()=>mapControl(reviewer,{controlId,taskId:foreignTask.id,rationale:notes}),(e:any)=>e.status===404);await mapControl(reviewer,{controlId,taskId:task.id,rationale:notes});await mapControl(reviewer,{controlId,taskId:task.id,rationale:notes});assert.equal(await db.controlLink.count({where:{controlId}}),1);
  await assert.rejects(()=>db.controlLink.create({data:{organizationId:ids[1],controlId,obligationId:foreignTask.id,mappedById:outside.userId,rationale:notes}}));
  const config={controlId,repository:"example/fixture",branch:"main",token,version:0,intervalHours:24,enabled:true};
  await assert.rejects(()=>saveConnector(outside,config),(e:any)=>e.status===404);await assert.rejects(()=>saveConnector(uploader,config),(e:any)=>e.status===403);
  const saved=await saveConnector(reviewer,config);let connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});assert.notEqual(connector.encryptedSecret,token);
  const claims=await Promise.all([claimConnector(),claimConnector()]);assert.equal(claims.filter(Boolean).length,1);const job=claims.find(Boolean)!;let calls=0;
  assert.equal(await executeConnector(job,async(t,secret)=>{calls++;assert.equal(secret,token);assert.equal(t.repository,config.repository);return observation("UNKNOWN");}),"INCOMPLETE");assert.equal(calls,1);
  let runs=await db.connectorRun.findMany({where:{connectorId:connector.id}});assert.equal(runs.length,1);assert.equal((await exportConnectorRun(reviewer,runs[0].id)).currentAtExport,true);
  await assert.rejects(()=>exportConnectorRun(outside,runs[0].id),(e:any)=>e.status===404);await assert.rejects(()=>requestConnectorRun(reviewer,connector.id,connector.version),(e:any)=>e.status===429);
  const followup=await db.obligation.findFirstOrThrow({where:{connectorId:connector.id}});assert.equal(followup.assigneeId,maker.userId);assert.equal(followup.status,"OPEN");
  // Replayed and superseded leases cannot collect or append results.
  assert.equal(await executeConnector(job,async()=>{throw Error("must not run");}),"SUPERSEDED");
  await db.evidenceConnector.update({where:{id:connector.id},data:{nextRunAt:new Date(0)}});const repeat=(await claimConnector())!;assert.equal(await executeConnector(repeat,async()=>observation("FAIL")),"FOLLOW_UP");assert.equal(await db.obligation.count({where:{connectorId:connector.id,status:{not:"COMPLETE"}}}),1);
  await db.evidenceConnector.update({where:{id:connector.id},data:{nextRunAt:new Date(0)}});const successful=(await claimConnector())!;await executeConnector(successful,async()=>observation());assert.equal((await db.obligation.findUniqueOrThrow({where:{id:followup.id}})).status,"OPEN","successful observations do not silently close work");
  const workspace=await operationsWorkspace(reviewer);assert.equal(workspace.connectors.length,1);assert.ok(workspace.connectors[0].changedSincePrevious);assert.ok(workspace.connectors[0].runs[0].current);assert.doesNotMatch(JSON.stringify(workspace),/github_pat_|encryptedSecret|leaseToken/);assert.equal((await operationsWorkspace(outside)).controls.length,0);
  // Failure preserves last good observation but makes it stale; retries pause after three attempts.
  for(let attempt=0;attempt<3;attempt++){await db.evidenceConnector.update({where:{id:connector.id},data:{nextRunAt:new Date(0)}});const failJob=(await claimConnector())!;assert.equal(await executeConnector(failJob,async()=>{throw new CollectionError("ACCESS_OR_RATE_LIMIT");}),attempt===2?"ATTENTION":"RETRY_SCHEDULED");}
  connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:connector.id}});assert.equal(connector.enabled,false);assert.ok(connector.lastSuccessAt);runs=await db.connectorRun.findMany({where:{connectorId:connector.id},orderBy:{capturedAt:"desc"}});assert.equal((await exportConnectorRun(reviewer,runs[0].id)).currentAtExport,false);
  await saveConnector(reviewer,{...config,id:connector.id,version:connector.version});const rotating=(await claimConnector())!;const count=await db.connectorRun.count({where:{connectorId:connector.id}});
  assert.equal(await executeConnector(rotating,async()=>{await saveConnector(reviewer,{...config,id:connector.id,version:rotating.version,token:token+"rotated"});return observation();}),"SUPERSEDED");assert.equal(await db.connectorRun.count({where:{connectorId:connector.id}}),count);
  const revoking=(await claimConnector())!;assert.equal(await executeConnector(revoking,async()=>{await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:reviewer.userId}},data:{role:"VIEWER"}});return observation();}),"ATTENTION");assert.equal(await db.connectorRun.count({where:{connectorId:connector.id}}),count);
  await assert.rejects(()=>operationsWorkspace({...outside,organizationId:ids[0]}),(e:any)=>e.status===403);
  // Revoked scheduler is paused, then a different administrator can adopt its schedule.
  await db.obligation.updateMany({where:{controlId,connectorId:null},data:{status:"COMPLETE"}});await db.managedControl.update({where:{id:controlId},data:{nextReviewAt:new Date(0)}});assert.equal((await runReviewBatch()).attention,1);control=await db.managedControl.findUniqueOrThrow({where:{id:controlId}});assert.equal(control.enabled,false);
  await configureControl(maker,controlId,{version:control.version,ownerId:maker.userId,intervalDays:30,nextReview:today,enabled:true});assert.equal((await runReviewBatch()).processed,1);
  await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:reviewer.userId}},data:{role:"ADMIN"}});
  connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:connector.id}});await disconnectConnector(reviewer,connector.id,connector.version);connector=await db.evidenceConnector.findUniqueOrThrow({where:{id:connector.id}});assert.equal(connector.encryptedSecret,null);await assert.rejects(()=>saveConnector(reviewer,{...config,id:connector.id,version:connector.version,token:undefined}),(e:any)=>e.status===400);await saveConnector(reviewer,{...config,id:connector.id,version:connector.version});
  // AI is mocked, deduplicated before paid work and cannot restore redacted output.
  let modelCalls=0;const generate=async()=>{modelCalls++;return {controls:[{title:"Fictional record retention control",description:quote,testProcedure:"Inspect the fictional dated training record and stated exemption.",theme:"records",citations:[{evidenceId:evidence.id,page:1,quote}]}]};};
  const aiPair=await Promise.all([prepareProgramme(maker,{...input,method:"AI"},{storage:store,generate}),prepareProgramme(maker,{...input,method:"AI"},{storage:store,generate})]);assert.equal(aiPair[0].id,aiPair[1].id);assert.equal(modelCalls,1);
  const extra=await createEvidence(uploader,task.id,"fictional-second.pdf",fixturePdf([["Fictional widget managers must review training records every month."]]),{storage:store,scan:clean});await reviewEvidence(reviewer,extra.id,{decision:"APPROVED",version:1,notes},store);
  await assert.rejects(()=>prepareProgramme(maker,{...input,evidenceIds:[evidence.id,extra.id],method:"AI"},{storage:store,generate:async()=>{const running=await db.programmeImport.findFirstOrThrow({where:{organizationId:ids[0],status:"PROCESSING",method:"AI"}});await redactProgramme(reviewer,running.id,running.version);return generate();}}),(e:any)=>e.status===409);
  const retryInput={...input,evidenceIds:[extra.id],method:"AI"};
  await assert.rejects(()=>prepareProgramme(maker,retryInput,{storage:store,generate:async()=>{throw Error("Fictional provider failure");}}));
  const failed=await db.programmeImport.findFirstOrThrow({where:{organizationId:ids[0],status:"FAILED"}});
  assert.equal((await prepareProgramme(maker,retryInput,{storage:store,generate})).id,failed.id,"retry is explicit");
  await assert.rejects(()=>prepareProgramme(maker,{...retryInput,retry:true},{storage:store,generate:async()=>{await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:maker.userId}},data:{role:"VIEWER"}});return {controls:[]};}}),(e:any)=>e.status===403);
  assert.equal((await db.programmeImport.findUniqueOrThrow({where:{id:failed.id}})).status,"FAILED");
  await db.membership.update({where:{organizationId_userId:{organizationId:ids[0],userId:maker.userId}},data:{role:"OWNER"}});
  const retried=await prepareProgramme(maker,{...retryInput,retry:true},{storage:store,generate:async()=>({controls:[]})});assert.equal(retried.id,failed.id);assert.equal((await db.programmeImport.findUniqueOrThrow({where:{id:failed.id}})).attempts,3);
  await assert.rejects(()=>prepareProgramme(maker,{...retryInput,retry:true},{storage:store,generate}),(e:any)=>e.status===409);
  const removed=await db.programmeImport.findFirstOrThrow({where:{organizationId:ids[0],status:"REDACTED"}});assert.equal(removed.result,null);
  await redactProgramme(reviewer,row.id,2);control=await db.managedControl.findUniqueOrThrow({where:{id:controlId}});assert.equal(control.enabled,false);assert.equal(control.description,"Retained content removed");assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:connector.id}})).encryptedSecret,null);
  const events=await db.auditEvent.findMany({where:{organizationId:ids[0]}});assert.doesNotMatch(JSON.stringify(events),/github_pat_|fictional-programme.pdf|Fictional widget staff must/);
 }finally{
  for(const name of ["controlLink","connectorRun","auditEvent","aiDailyUsage","evidence","obligation","evidenceConnector","managedControl","programmeImport","membership"] as const)await (db[name] as any).deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
 }
});
