import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {assuranceFixture,rejects,future} from "./helpers/assurance-fixture";
import {saveConnector,claimConnector,executeConnector,disconnectConnector,exportConnectorRun} from "../lib/server/connector-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import {createVendor,changeVendor,prepareVendorReview,vendorDetail,exportVendorReview} from "../lib/server/vendor-service";
import {VENDOR_CRITERIA} from "../lib/assurance-workflows";
import {CollectionError} from "../lib/connectors/github";
import type {Observation} from "../lib/connectors/observation";
import {hashValue} from "../lib/regulatory/intelligence";
import {changeMember} from "../lib/server/team-service";
const token="fictional-read-only-secret-12345";
function flags(){Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_GITLAB_ENABLED:"true",REGPILOT_CLOUDFLARE_ENABLED:"true",REGPILOT_COMPANIES_HOUSE_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"ab".repeat(32),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture"});}
async function control(x:Awaited<ReturnType<typeof assuranceFixture>>){
 const p=await db.programmeImport.create({data:{organizationId:x.a.id,createdById:x.o.userId,inputHash:x.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
 return db.managedControl.create({data:{organizationId:x.a.id,importId:p.id,proposalKey:"fictional-connected",title:"Fictional connected control",description:"Review fictional aggregate settings",testProcedure:"Inspect observations and limitations",theme:"security",ownerId:x.ed.userId,scheduledById:x.o.userId,intervalDays:30,nextReviewAt:new Date()}});
}
const observation=(status:"PASS"|"FAIL"="PASS"):Observation=>({engine:"companies-house-profile-1.0.0",sourceUrl:"https://find-and-update.company-information.service.gov.uk/company/SC123456",capturedAt:new Date().toISOString(),checks:[{id:"company-status",label:"Fictional company register status",status,observed:status==="PASS"?"active":"liquidation",nextStep:"Inspect the exact legal entity and independently assess the finding."}],limitations:["Fictional fixture; no provider calls or customer information."]});
test("all three new configurations encrypt credentials, isolate tenants and fence disabled providers and rotation",async()=>{
 const x=await assuranceFixture();flags();
 try{
  const c=await control(x);
  for(const [flag,target,repository,branch] of [
   ["REGPILOT_GITLAB_ENABLED",{provider:"GITLAB",projectPath:"fictional/demo",branch:"Main"},"gitlab:fictional/demo","Main"],
   ["REGPILOT_CLOUDFLARE_ENABLED",{provider:"CLOUDFLARE",zoneId:"ab".repeat(16),accountId:"cd".repeat(16)},"cloudflare:"+"ab".repeat(16),"cd".repeat(16)],
   ["REGPILOT_COMPANIES_HOUSE_ENABLED",{provider:"COMPANIES_HOUSE",companyNumber:"SC123456"},"companieshouse:SC123456","profile"]
  ] as const){
   const config={...target,controlId:c.id,version:0,token,consent:true,enabled:true,intervalHours:24};
   await assert.rejects(()=>saveConnector(x.ed,config),rejects(403));await assert.rejects(()=>saveConnector(x.out,config),rejects(404));await assert.rejects(()=>saveConnector(x.o,{...config,consent:false}),rejects(400));
   process.env[flag]="false";await assert.rejects(()=>saveConnector(x.o,config),rejects(503));process.env[flag]="true";
   const saved=await saveConnector(x.o,config),stored=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});
   assert.equal(stored.repository,repository);assert.equal(stored.branch,branch);assert.doesNotMatch(stored.encryptedSecret!,/fictional-read-only/);
   process.env[flag]="false";assert.equal(await claimConnector(),null);process.env[flag]="true";
   const claims=await Promise.all([claimConnector(),claimConnector()]);assert.equal(claims.filter(Boolean).length,1);
   assert.equal(await executeConnector(claims.find(Boolean)!,async(t,s)=>{assert.equal(t.provider,target.provider);assert.equal(s,token);return observation();}),"OBSERVED");
   const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id}});await assert.rejects(()=>exportConnectorRun(x.out,run.id),rejects(404));
   const claim=async()=>{await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});const job=await claimConnector();assert.ok(job);return job;};
   const rotating=await claim();assert.equal(await executeConnector(rotating,async()=>{await saveConnector(x.o,{...config,id:saved.id,version:rotating.version,token:token+"-rotated"});return observation();}),"SUPERSEDED");
   const disabled=await claim();assert.equal(await executeConnector(disabled,async()=>{process.env[flag]="false";throw new CollectionError("PROVIDER_UNAVAILABLE");}),"SUPERSEDED");
   assert.equal((await exportConnectorRun(x.o,run.id)).currentAtExport,false);
   assert.equal(await db.connectorRun.count({where:{connectorId:saved.id}}),1);
   assert.doesNotMatch(JSON.stringify(await operationsWorkspace(x.o)),/fictional-read-only|encryptedSecret|leaseToken/);
   const latest=await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}});await disconnectConnector(x.o,saved.id,latest.version);assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:saved.id}})).encryptedSecret,null);
   process.env[flag]="true";
  }
  assert.doesNotMatch(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:x.a.id}})),/fictional-read-only/);
 }finally{await x.cleanup();}
});
test("connected supplier reviews freeze signals, require independent review and follow changed or failed observations through ownership handover",async()=>{
 const x=await assuranceFixture();flags();const notes="Verified the exact fictional legal entity and independently considered the register observation.";
 try{
  const c=await control(x),saved=await saveConnector(x.o,{provider:"COMPANIES_HOUSE",companyNumber:"SC123456",controlId:c.id,version:0,token,consent:true,enabled:true,intervalHours:24});
  const input={name:"Fictional supplier",service:"Provides a fictional business application with support.",ownerId:x.editor.id,criticality:"HIGH",dataAccess:"PERSONAL",systemAccess:true,nextReview:future(30)},v=await createVendor(x.o,input);
  await assert.rejects(()=>changeVendor(x.out,v.id,{action:"LINK_SIGNAL",version:1,connectorId:saved.id,notes,confirm:true}),rejects(404));
  const foreign=await createVendor(x.out,{...input,ownerId:x.foreign.id});await assert.rejects(()=>changeVendor(x.out,foreign.id,{action:"LINK_SIGNAL",version:1,connectorId:saved.id,notes,confirm:true}),rejects(404));
  await assert.rejects(()=>db.vendor.update({where:{id:foreign.id},data:{signalConnectorId:saved.id}}),"composite foreign key blocks cross-tenant connection");
  await changeVendor(x.o,v.id,{action:"LINK_SIGNAL",version:1,connectorId:saved.id,notes,confirm:true});
  const file=await x.file(),assessment=VENDOR_CRITERIA.map(c=>({id:c.id,outcome:"SUPPORTED",rationale:"The fictional evidence supports this recorded supplier assessment.",evidenceIds:[file.id]}));
  const review={version:2,evidenceIds:[file.id],assessment,recommendation:"APPROVE",rationale:notes,followUpDue:future(14),validUntil:future(90)};
  await assert.rejects(()=>prepareVendorReview(x.o,v.id,review),rejects(409));
  const collect=async(value:Observation|null)=>{await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});const job=await claimConnector();assert.ok(job);return executeConnector(job,async()=>{if(!value)throw new CollectionError("PROVIDER_UNAVAILABLE");return value;});};
  await collect(observation());let detail=await vendorDetail(x.o,v.id);assert.equal(detail.signal?.current,true);assert.equal(detail.signalTasks.length,1);
  const firstRun=detail.signal!.snapshot!.runId,prepare=async(recommendation="APPROVE",version=2)=>{const current=await vendorDetail(x.o,v.id);return prepareVendorReview(x.o,v.id,{...review,version,recommendation,signalRunId:current.signal!.snapshot!.runId,signalReviewed:true});};
  await assert.rejects(()=>prepareVendorReview(x.o,v.id,{...review,signalRunId:firstRun}),rejects(409));
  const accept=(id:string)=>({action:"ACCEPT",reviewId:id,version:1,notes,confirm:true});
  const draft=await prepare();await assert.rejects(()=>changeVendor(x.o,v.id,accept(draft.id),x.store),rejects(403));await changeVendor(x.ad,v.id,accept(draft.id),x.store);
  detail=await vendorDetail(x.o,v.id);assert.equal(detail.reviewState,"CURRENT");assert.equal(detail.signalTasks[0].status,"COMPLETE");
  await collect(observation());assert.equal((await vendorDetail(x.o,v.id)).reviewState,"CURRENT","unchanged renewed observation preserves reviewed signal identity");
  const race=await prepare();await assert.rejects(()=>changeVendor(x.ad,v.id,accept(race.id),{...x.store,async get(k){const bytes=await x.store.get(k);await collect(observation("FAIL"));return bytes;}}),rejects(409));
  detail=await vendorDetail(x.o,v.id);assert.equal(detail.reviewState,"STALE");assert.equal(detail.signalChanges[0].before,"PASS: active");assert.equal(detail.signalChanges[0].after,"FAIL: liquidation");assert.equal(detail.reviews.find(r=>r.id===draft.id)!.signal!.runId,firstRun,"accepted snapshot stays frozen");
  const open=await db.obligation.findMany({where:{vendorSignalId:v.id,status:"OPEN"}});assert.equal(open.length,1);assert.equal(open[0].assigneeId,x.editor.id);
  await collect(observation("FAIL"));assert.equal(await db.obligation.count({where:{vendorSignalId:v.id,status:"OPEN"}}),1,"same signal and baseline deduplicate follow-up");
  await assert.rejects(()=>prepare(),rejects(409));
  const conditional=await prepare("CONDITIONAL");const accepted=await changeVendor(x.ad,v.id,accept(conditional.id),x.store);assert.equal((await vendorDetail(x.o,v.id)).reviewState,"CURRENT");assert.ok("tasks" in accepted);assert.equal(accepted.tasks.length,1,"conditional register findings retain owned remediation after review acceptance");
  await collect(null);assert.equal((await vendorDetail(x.o,v.id)).reviewState,"STALE");await assert.rejects(()=>prepare("CONDITIONAL"),rejects(409));
  await changeMember(x.o,{action:"REMOVE",userId:x.editor.id,expectedRole:"EDITOR",replacementId:x.replacement.id});
  assert.equal((await db.vendor.findUniqueOrThrow({where:{id:v.id}})).ownerId,x.replacement.id);assert.equal(await db.obligation.count({where:{vendorSignalId:v.id,status:"OPEN",assigneeId:x.replacement.id}}),1);
  await collect(observation("FAIL"));const restored=await prepare("CONDITIONAL",3);await changeVendor(x.ad,v.id,accept(restored.id),x.store);assert.equal((await vendorDetail(x.o,v.id)).reviewState,"CURRENT");
  const run=(await vendorDetail(x.o,v.id)).signal!.snapshot!;await db.$executeRaw`UPDATE "ConnectorRun" SET "capturedAt"="capturedAt"-interval '25 hours' WHERE "connectorId"=${saved.id}::uuid`;assert.equal((await vendorDetail(x.o,v.id)).reviewState,"STALE","overdue observation cannot sustain current review");
  await assert.rejects(()=>changeVendor(x.ed,v.id,{action:"FOLLOW_UP",version:3}),rejects(403));
  await assert.rejects(()=>changeVendor(x.out,v.id,{action:"FOLLOW_UP",version:3}),rejects(404));
  await assert.rejects(()=>changeVendor(x.o,v.id,{action:"FOLLOW_UP",version:2}),rejects(409));
  process.env.REGPILOT_COMPANIES_HOUSE_ENABLED="false";
  const results=await Promise.all([changeVendor(x.o,v.id,{action:"FOLLOW_UP",version:3}),changeVendor(x.ad,v.id,{action:"FOLLOW_UP",version:3})]);
  assert.ok("taskId" in results[0]&&"taskId" in results[1]);assert.equal(results[0].taskId,results[1].taskId);
  const taskId=results[0].taskId!;assert.equal((await db.obligation.findUniqueOrThrow({where:{id:taskId}})).assigneeId,x.replacement.id);
  await db.obligation.update({where:{id:taskId},data:{status:"COMPLETE",completedAt:new Date(),completionException:true,completionRationale:"Fictional premature closure for reopening verification."}});
  await changeVendor(x.o,v.id,{action:"FOLLOW_UP",version:3});assert.equal((await db.obligation.findUniqueOrThrow({where:{id:taskId}})).status,"OPEN");
  assert.equal((await vendorDetail(x.o,v.id)).reviewState,"STALE","task closure/reopening does not replace independent review");
  assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id,entityId:v.id,action:"vendor.follow_up_reopened"}}),1);
  process.env.REGPILOT_COMPANIES_HOUSE_ENABLED="true";
  await collect(observation("FAIL"));const finalReview=await prepare("CONDITIONAL",3);await changeVendor(x.ad,v.id,accept(finalReview.id),x.store);
  assert.equal((await db.obligation.findUniqueOrThrow({where:{id:taskId}})).status,"COMPLETE");
  await assert.rejects(()=>changeVendor(x.o,v.id,{action:"FOLLOW_UP",version:3}),rejects(409));
  await assert.rejects(()=>exportVendorReview(x.out,v.id,x.store),rejects(404));await assert.rejects(()=>exportVendorReview(x.re,v.id,x.store),rejects(403));
  const {integrityHash,...dossier}=await exportVendorReview(x.o,v.id,x.store);assert.equal(hashValue(JSON.parse(JSON.stringify(dossier))),integrityHash);assert.equal(dossier.recommendation,"CONDITIONAL");assert.equal(dossier.followUp.length,1);assert.doesNotMatch(JSON.stringify(dossier.evidence),/uploadedById|reviewerId|storageKey/);
  await assert.rejects(()=>exportVendorReview(x.ad,v.id,{...x.store,async get(k){const bytes=await x.store.get(k);await changeMember(x.o,{action:"ROLE",userId:x.admin.id,expectedRole:"ADMIN",role:"EDITOR"});return bytes;}}),rejects(403));
  await changeMember(x.o,{action:"ROLE",userId:x.admin.id,expectedRole:"EDITOR",role:"ADMIN"});
  await assert.rejects(()=>exportVendorReview(x.o,v.id,{...x.store,async get(k){const bytes=await x.store.get(k);await collect(observation());return bytes;}}),rejects(409),"changed register during file retrieval blocks dossier release");


  process.env.REGPILOT_COMPANIES_HOUSE_ENABLED="false";assert.equal((await vendorDetail(x.o,v.id)).reviewState,"STALE");
 }finally{await x.cleanup();}
});
