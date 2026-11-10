import "./helpers/paid-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {saveLibraryFacts,draftRequirements,reviewRevision,decideApplicability,revisionContext,libraryWorkspace,redactRevision,importIntelligenceCandidates} from "../lib/server/library-service";
import {prepareCoverage,reviewCoverage,coverageDetail,coverageImpact,redactCoverage} from "../lib/server/coverage-service";
import {registerPublication,resolveWorkspaceSource,workspaceCatalogue} from "../lib/server/publication-catalogue";
import {checkOfficialSource,reviewSourceSnapshot} from "../lib/server/regulatory-watch";
import {configureWatch} from "../lib/server/monitoring-service";
import {createIntelligenceRun,transaction} from "../lib/server/intelligence-service";
import {prepareProgramme,acceptProgramme} from "../lib/server/programme-service";
import {createEvidence,reviewEvidence} from "../lib/server/evidence-service";
import {hashValue} from "../lib/regulatory/intelligence";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {CoverageResult} from "../lib/library/coverage";
import type {ProgrammeResult} from "../lib/programme/import";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";

test("obligation library: source registration, versioning, scope, cross-collection relationships and impact are tenant-scoped and independently reviewed",async()=>{
 const suffix=randomUUID(),users=await Promise.all(["maker","reviewer","uploader","outside"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}}))),orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional library "+n+suffix}}))),orgIds=orgs.map(o=>o.id);
 const maker:AuthorizedContext={userId:users[0].id,organizationId:orgIds[0],role:"OWNER"},reviewer:AuthorizedContext={...maker,userId:users[1].id,role:"ADMIN"},uploader:AuthorizedContext={...maker,userId:users[2].id,role:"EDITOR"},outside:AuthorizedContext={userId:users[3].id,organizationId:orgIds[1],role:"OWNER"};
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_LIBRARY_ENABLED:"true",REGPILOT_LIBRARY_AI_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_PROGRAMME_ENABLED:"true",REGPILOT_AI_ENABLED:"true",REGPILOT_AI_SAFEGUARDS_VERIFIED:"true",REGPILOT_AI_PROCESSOR_REVIEWED:"true",REGPILOT_AI_TRANSFER_REVIEWED:"true",REGPILOT_AI_INTENDED_USE_REVIEWED:"true",REGPILOT_AI_MODEL:"test/fictional",AI_GATEWAY_API_KEY:"fixture-never-used",REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_DAILY_USER_LIMIT:"20",REGPILOT_AI_DAILY_ORG_LIMIT:"20"});
 const objects=new Map<string,Uint8Array>(),storage:EvidenceObjectStore={async put(k,b){objects.set(k,Uint8Array.from(b));},async get(k){const b=objects.get(k);if(!b)throw Error("Fixture missing");return Uint8Array.from(b);},async remove(k){objects.delete(k);}},scan=async()=>({status:"CLEAN" as const,engine:"fixture-only"});
 const quote="Fictional widget staff must retain training records unless a documented exemption applies.",condition="unless a documented exemption applies",text=quote+" This fictional publication is solely an isolated test fixture and carries no legal authority.",notes="Independently checked the fictional original material, territorial scope, conditions, exclusions, proposed control and supporting records.";
 const path="/guidance/fictional-widget-records",fetcher=(async()=>Response.json({base_path:path,title:"Fictional widget guidance",document_type:"guidance"})) as typeof fetch;
 const rule={kind:"all",rules:[{kind:"fact",field:"employeeCount",operator:"gte",value:5},{kind:"fact",field:"jurisdictions",operator:"includes",value:"Scotland"}]};
 const current=(id:string,ctx=reviewer)=>transaction(ctx,tx=>revisionContext(tx,ctx,id));
 try{
  await db.membership.createMany({data:[maker,reviewer,uploader,outside]});
  await assert.rejects(()=>registerPublication(uploader,{path},fetcher),(e:any)=>e.status===403);
  await assert.rejects(()=>registerPublication(maker,{path},async()=>Response.json({base_path:"/elsewhere",title:"Wrong",document_type:"guidance"})),(e:any)=>e.status===409);
  const registered=await registerPublication(maker,{path},fetcher);assert.equal((await registerPublication(maker,{path},fetcher)).reused,true);assert.equal(await resolveWorkspaceSource(db,outside.organizationId,registered.sourceId),null);assert.ok((await workspaceCatalogue(maker)).some(s=>s.id===registered.sourceId));
  await configureWatch(maker,{sourceId:registered.sourceId,enabled:false,intervalHours:24,version:0});await assert.rejects(()=>configureWatch(outside,{sourceId:registered.sourceId,enabled:true,intervalHours:24,version:0}),(e:any)=>e.status===400);
  await saveLibraryFacts(maker,{version:0,facts:{employeeCount:6,foodBusiness:null},jurisdictions:["Scotland"]});await assert.rejects(()=>saveLibraryFacts(maker,{version:0,facts:{employeeCount:6},jurisdictions:["Scotland"]}),(e:any)=>e.status===409);
  const captured=await checkOfficialSource(maker,registered.sourceId,async()=>({id:registered.sourceId,title:"Fictional widget guidance",url:"https://www.gov.uk"+path,updatedAt:null,revisionAt:null,text})),snapshotId=captured.snapshot.id;
  const intake={collection:"Fictional framework A",source:{type:"PUBLICATION",id:snapshotId},clauses:[{reference:"A-1",title:"Training records",quote,kind:"DUTY",conditions:[],exceptions:[condition],rule}],rightsConfirmed:true,consent:true};
  await assert.rejects(()=>draftRequirements(maker,intake),(e:any)=>e.status===409);
  await reviewSourceSnapshot(reviewer,snapshotId,{status:"REVIEWED",notes,version:1});
  await assert.rejects(()=>draftRequirements(outside,intake),(e:any)=>e.status===404);
  await assert.rejects(()=>draftRequirements(maker,{...intake,clauses:[{...intake.clauses[0],quote:quote.replace("must","must not")}]}),(e:any)=>e.status===409);
  const draft=await draftRequirements(maker,intake),rev=draft.revisionIds[0];assert.equal((await draftRequirements(maker,intake)).revisionIds[0],rev);
  await assert.rejects(()=>reviewRevision(maker,rev,{version:1,decision:"ACCEPTED",notes,scopeConfirmed:true}),(e:any)=>e.status===403);
  await reviewRevision(reviewer,rev,{version:1,decision:"ACCEPTED",notes,scopeConfirmed:true});
  const d2=await draftRequirements(maker,{...intake,collection:"Fictional framework B",clauses:[{...intake.clauses[0],reference:"B-1"}]}),rev2=d2.revisionIds[0];await reviewRevision(reviewer,rev2,{version:1,decision:"ACCEPTED",notes,scopeConfirmed:true});
  const decision=async(id:string,ownerId=uploader.userId)=>{const c=await current(id);return decideApplicability(reviewer,id,{contextHash:c.contextHash,version:c.applicability?.version||0,decision:"APPLIES",rationale:notes,ownerId,scopeConfirmed:true});};
  assert.equal((await current(rev)).evaluation.state,"MATCH");await decision(rev);await decision(rev2);
  await assert.rejects(()=>decision(rev,outside.userId),(e:any)=>e.status===409);
  await assert.rejects(async()=>db.libraryRevision.create({data:{organizationId:outside.organizationId,requirementId:(await current(rev)).revision.requirementId,number:99,content:{},contentHash:hashValue({}),provenance:{},provenanceHash:hashValue({}),createdById:outside.userId}}));
  const triage=await createIntelligenceRun(maker,snapshotId),triageRow=await db.intelligenceRun.findUniqueOrThrow({where:{id:triage.id}}),keys=(triageRow.result as any).candidates.map((c:any)=>c.key);
  assert.equal((await importIntelligenceCandidates(maker,{runId:triage.id,keys,collection:"Fictional source imports",consent:true,rightsConfirmed:true})).revisionIds.length,1);
  const task=await db.obligation.create({data:{organizationId:maker.organizationId,title:"Fictional policy intake",category:"Programme",ownerName:users[2].email,dueDate:new Date()}}),pdf=fixturePdf([[quote]]);
  const evidence=await createEvidence(uploader,task.id,"fictional-library-policy.pdf",pdf,{storage,scan});await reviewEvidence(reviewer,evidence.id,{version:1,decision:"APPROVED",notes},storage);
  const pd=await draftRequirements(maker,{...intake,collection:"Fictional PDF clauses",source:{type:"PDF",id:evidence.id},clauses:[{...intake.clauses[0],page:1}]},{storage});await reviewRevision(reviewer,pd.revisionIds[0],{version:1,decision:"ACCEPTED",notes,scopeConfirmed:true},{storage});
  const imported=await prepareProgramme(maker,{evidenceIds:[evidence.id],method:"SEARCH",consent:true},{storage}),programme=await db.programmeImport.findUniqueOrThrow({where:{id:imported.id}}),programmeResult=programme.result as unknown as ProgrammeResult;
  const accepted=await acceptProgramme(reviewer,programme.id,{version:1,keys:programmeResult.controls.map(c=>c.key),ownerId:uploader.userId,intervalDays:30,firstReview:new Date().toISOString().slice(0,10),notes,scopeConfirmed:true},{storage}),controlId=accepted.controlIds[0];
  const input={revisionIds:[rev,rev2],controlIds:[controlId],evidenceIds:[evidence.id],method:"SEARCH",consent:true};
  await assert.rejects(()=>prepareCoverage(outside,input,{storage}),(e:any)=>e.status===404);
  const prepared=await prepareCoverage(maker,input,{storage}),detail=await coverageDetail(reviewer,prepared.id),result=detail.result as unknown as CoverageResult;assert.equal(result.mappings.length,2);assert.equal(detail.current,true);assert.equal((await prepareCoverage(maker,input,{storage})).id,detail.id);
  const review={version:1,key:result.mappings[0].key,decision:"ACCEPTED",rationale:notes,scopeConfirmed:true};
  await assert.rejects(()=>reviewCoverage(maker,detail.id,review,{storage}),(e:any)=>e.status===403);
  const savedEvidence=await db.evidence.findUniqueOrThrow({where:{id:evidence.id}});objects.set(savedEvidence.storageKey,fixturePdf([["Tampered training evidence."]]));await assert.rejects(()=>reviewCoverage(reviewer,detail.id,review,{storage}),(e:any)=>e.status===409);objects.set(savedEvidence.storageKey,pdf);
  for(const m of result.mappings)await reviewCoverage(reviewer,detail.id,{...review,key:m.key},{storage});assert.equal((await coverageImpact(reviewer)).acceptedCurrent,2);
  await assert.rejects(()=>reviewCoverage(reviewer,detail.id,review,{storage}),(e:any)=>e.status===409);await assert.rejects(()=>coverageDetail(outside,detail.id),(e:any)=>e.status===404);
  // Deduplicate provider work, exact grounding and independent review; no network AI call.
  let calls=0;const generate=async()=>{calls++;return {mappings:result.mappings,limitations:["Fictional provider fixture only."]};};
  const ai=await Promise.all([prepareCoverage(maker,{...input,method:"AI"},{storage,generate}),prepareCoverage(maker,{...input,method:"AI"},{storage,generate})]);assert.equal(ai[0].id,ai[1].id);assert.equal(calls,1);
  // Changed facts invalidate accepted relationships and create one owned task per decision.
  await saveLibraryFacts(maker,{version:1,facts:{employeeCount:7},jurisdictions:["Scotland"]});assert.equal((await current(rev)).applicability,null);assert.equal((await coverageDetail(reviewer,detail.id)).current,false);
  const impacts=await Promise.all([coverageImpact(reviewer,true),coverageImpact(reviewer,true)]);assert.equal(impacts.reduce((n,r)=>n+r.created,0),2);assert.equal(impacts[0].needsReview,2);assert.equal(await db.obligation.count({where:{organizationId:maker.organizationId,category:"Requirement review"}}),2);
  const impactTask=await db.obligation.findFirstOrThrow({where:{organizationId:maker.organizationId,category:"Requirement review"}});assert.equal(impactTask.assigneeId,uploader.userId);assert.equal(impactTask.originKey,null);
  await assert.rejects(()=>reviewCoverage(reviewer,ai[0].id,review,{storage}),(e:any)=>e.status===409);
  await decision(rev);await decision(rev2);const fresh=await prepareCoverage(maker,input,{storage});assert.notEqual(fresh.id,detail.id);assert.equal((await coverageDetail(reviewer,fresh.id)).current,true);
  // Revoking an owner blocks reuse, but another administrator can repair the ownership.
  await db.membership.update({where:{organizationId_userId:{organizationId:maker.organizationId,userId:uploader.userId}},data:{role:"VIEWER"}});assert.equal((await coverageDetail(reviewer,fresh.id)).current,false);await decision(rev,maker.userId);await db.membership.update({where:{organizationId_userId:{organizationId:maker.organizationId,userId:uploader.userId}},data:{role:"EDITOR"}});
  const next=await draftRequirements(maker,{...intake,clauses:[{...intake.clauses[0],title:"Updated training scope"}]}),newRev=next.revisionIds[0];await reviewRevision(reviewer,newRev,{version:1,decision:"ACCEPTED",notes,scopeConfirmed:true});assert.equal((await current(rev)).current,false);assert.equal((await current(newRev)).revision.number,2);await decision(newRev);
  const nextInput={...input,revisionIds:[newRev],method:"AI"};
  await assert.rejects(()=>prepareCoverage(maker,nextInput,{storage,generate:async()=>{const running=await db.coverageRun.findFirstOrThrow({where:{organizationId:maker.organizationId,status:"PROCESSING"}});await redactCoverage(reviewer,running.id,running.version);return {mappings:[],limitations:[]};}}),(e:any)=>e.status===409);
  const removed=await db.coverageRun.findFirstOrThrow({where:{organizationId:maker.organizationId,status:"REDACTED"}});assert.equal(removed.result,null);
  // Explicit retries are bounded and permissions are checked again after provider latency.
  const retryInput={...input,revisionIds:[rev2],evidenceIds:[],method:"AI"};await assert.rejects(()=>prepareCoverage(maker,retryInput,{storage,generate:async()=>{throw Error("Provider fixture failed");}}));const failed=await db.coverageRun.findFirstOrThrow({where:{organizationId:maker.organizationId,status:"FAILED"}});assert.equal((await prepareCoverage(maker,retryInput,{storage,generate})).id,failed.id);
  await assert.rejects(()=>prepareCoverage(maker,{...retryInput,retry:true},{storage,generate:async()=>{await db.membership.update({where:{organizationId_userId:{organizationId:maker.organizationId,userId:maker.userId}},data:{role:"VIEWER"}});return {mappings:[],limitations:[]};}}),(e:any)=>e.status===403);
  await db.membership.update({where:{organizationId_userId:{organizationId:maker.organizationId,userId:maker.userId}},data:{role:"OWNER"}});await prepareCoverage(maker,{...retryInput,retry:true},{storage,generate:async()=>({mappings:[],limitations:[]})});assert.equal((await db.coverageRun.findUniqueOrThrow({where:{id:failed.id}})).attempts,3);await assert.rejects(()=>prepareCoverage(maker,{...retryInput,retry:true},{storage,generate}),(e:any)=>e.status===409);
  // A new publication version immediately invalidates the old requirement's source context.
  await db.regulatorySnapshot.update({where:{id:snapshotId},data:{lastCheckedAt:new Date(0)}});assert.equal((await current(newRev)).current,false);
  await checkOfficialSource(maker,registered.sourceId,async()=>({id:registered.sourceId,title:"Changed fictional publication",url:"https://www.gov.uk"+path,updatedAt:null,revisionAt:null,text:text+" Additional fictional source text."}));assert.equal((await current(newRev)).current,false);assert.equal((await current(newRev)).applicability,null);
  const workspace=await libraryWorkspace(reviewer,{cursor:"",search:"Fictional",revisionId:newRev});assert.equal(workspace.selected?.revision.number,2);assert.equal((await libraryWorkspace(outside)).items.length,0);await assert.rejects(()=>libraryWorkspace({...outside,organizationId:maker.organizationId}),(e:any)=>e.status===403);
  // Redaction remains available with activation off, and propagates to related analyses.
  process.env.REGPILOT_LIBRARY_ENABLED="false";await assert.rejects(()=>saveLibraryFacts(maker,{version:2,facts:{},jurisdictions:["Scotland"]}),(e:any)=>e.status===503);
  await redactRevision(reviewer,rev2,2);assert.equal((await db.libraryRevision.findUniqueOrThrow({where:{id:rev2}})).status,"REDACTED");assert.equal((await coverageDetail(reviewer,detail.id)).result,null);assert.equal((await db.coverageRun.findUniqueOrThrow({where:{id:detail.id}})).status,"REDACTED");
  const audit=await db.auditEvent.findMany({where:{organizationId:maker.organizationId}});assert.doesNotMatch(JSON.stringify(audit),/Fictional widget staff must|fictional-library-policy.pdf/);
 }finally{
  for(const name of ["coverageDecision","coverageRun","libraryApplicability","libraryRevision","libraryRequirement","registeredSource","watchSchedule","intelligenceDecision","intelligenceRun","regulatorySnapshot","businessProfile","auditEvent","aiDailyUsage","evidence","obligation","managedControl","programmeImport","membership"] as const)await (db[name] as any).deleteMany({where:{organizationId:{in:orgIds}}});await db.organization.deleteMany({where:{id:{in:orgIds}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
 }
});
