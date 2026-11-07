import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {createEvidence,downloadEvidence,reviewEvidence} from "../lib/server/evidence-service";
import {inspectEvidence} from "../lib/server/document-inspection";
import {prepareProgramme,acceptProgramme} from "../lib/server/programme-service";
import {prepareAssurance,reviewAssurance,exportAssurance} from "../lib/server/assurance-service";
import {saveBusinessProfile,createIntelligenceRun,decideCandidate} from "../lib/server/intelligence-service";
import {sourceTextHash} from "../lib/regulatory/source-fingerprint.mjs";
import type {Analysis} from "../lib/regulatory/intelligence";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";
import type {ProgrammeResult} from "../lib/programme/import";
import type {AssuranceResult} from "../lib/evidence/assurance";
import {DOCX_MIME} from "../lib/evidence/file-guard.mjs";
import {fixtureDocx,paragraph} from "./helpers/docx-fixture.mjs";

test("Word workflow: private storage, tenancy, inspection limits, grounded programme and assessment, independent acceptance, incomplete-content gates",async()=>{
  const suffix=randomUUID(),users=await Promise.all(["maker","reviewer","uploader","outsider"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}}))),orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional documents "+n+suffix}}))),ids=orgs.map(o=>o.id);
  const maker:AuthorizedContext={organizationId:ids[0],userId:users[0].id,role:"OWNER"},reviewer:AuthorizedContext={...maker,userId:users[1].id,role:"ADMIN"},uploader:AuthorizedContext={...maker,userId:users[2].id,role:"EDITOR"},outside:AuthorizedContext={organizationId:ids[1],userId:users[3].id,role:"OWNER"};
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_PROGRAMME_ENABLED:"true",REGPILOT_ASSURANCE_ENABLED:"true",REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_ENABLED:"false"});
  const objects=new Map<string,Uint8Array>(),types=new Map<string,string>(),store:EvidenceObjectStore={async put(k,b,type){objects.set(k,Uint8Array.from(b));types.set(k,type!);},async get(k){return Uint8Array.from(objects.get(k)!);},async remove(k){objects.delete(k);types.delete(k);}},scan=async()=>({status:"CLEAN" as const,engine:"fictional-test"});
  const quote="Fictional widget staff must maintain training records before working alone.",notes="Independently inspected the fictional original, dates, scope, conditions and implementation evidence; recorded limitations.",today=new Date().toISOString().slice(0,10);
  const bytes=fixtureDocx(paragraph(quote)+paragraph("Fictional widget staff training was completed on 4 November 2026."));
  try{
    await db.membership.createMany({data:[maker,reviewer,uploader,outside]});
    await saveBusinessProfile(maker,{activities:["personal-data"],jurisdictions:["Scotland"]},0);
    const snapshot=await db.regulatorySnapshot.create({data:{organizationId:ids[0],sourceId:"uk-data-protection",title:"Fictional source",url:"https://www.gov.uk/data-protection-your-business",bodyText:quote,contentHash:sourceTextHash(quote),capturedById:maker.userId,reviewStatus:"REVIEWED",reviewerId:reviewer.userId,reviewedAt:new Date()}});
    const run=await createIntelligenceRun(maker,snapshot.id),analysis=await db.intelligenceRun.findUniqueOrThrow({where:{id:run.id}}),candidate=(analysis.result as unknown as Analysis).candidates[0];
    const decision=await decideCandidate(reviewer,run.id,{candidateKey:candidate.key,decision:"ACCEPTED",rationale:notes,title:"Fictional training evidence",ownerName:"Fictional owner",dueDate:"2027-01-31"}),taskId=decision.obligationId!;
    const evidence=await createEvidence(uploader,taskId,"existing-policy.docx",bytes,{storage:store,scan});
    assert.equal(evidence.contentType,DOCX_MIME);assert.equal(evidence.filename,"existing-policy.docx");const row=await db.evidence.findUniqueOrThrow({where:{id:evidence.id}});assert.match(row.storageKey,/\.docx$/);assert.equal(types.get(row.storageKey),DOCX_MIME);
    assert.deepEqual(Buffer.from((await downloadEvidence(maker,evidence.id,store)).bytes),bytes);
    await assert.rejects(()=>inspectEvidence(outside,evidence.id,store),(e:any)=>e.status===404);
    const preview=await inspectEvidence(maker,evidence.id,store);assert.equal(preview.blocked,false);assert.equal(preview.coverage.unitKind,"block");assert.equal(preview.units[0].text,quote);assert.equal(await db.aiDailyUsage.count({where:{organizationId:ids[0]}}),0,"inspection and search make no paid AI request");
    await reviewEvidence(reviewer,evidence.id,{decision:"APPROVED",version:1,notes},store);
    const imported=await prepareProgramme(maker,{evidenceIds:[evidence.id],method:"SEARCH",consent:true},{storage:store}),programme=await db.programmeImport.findUniqueOrThrow({where:{id:imported.id}}),result=programme.result as unknown as ProgrammeResult;
    assert.equal(result.controls[0].citations[0].unitKind,"block");assert.match(result.controls[0].citations[0].label!,/paragraph/);
    const approval={version:programme.version,keys:result.controls.map(c=>c.key),ownerId:uploader.userId,intervalDays:30,firstReview:today,notes,scopeConfirmed:true};
    await assert.rejects(()=>acceptProgramme(maker,imported.id,approval,{storage:store}),(e:any)=>e.status===403);
    assert.ok((await acceptProgramme(reviewer,imported.id,approval,{storage:store})).controlIds.length>0);
    const prepared=await prepareAssurance(maker,{taskId,evidenceIds:[evidence.id],method:"CONTENT_SEARCH",consent:true},{storage:store}),assessment=await db.assuranceAssessment.findUniqueOrThrow({where:{id:prepared.id}}),assurance=assessment.result as unknown as AssuranceResult;
    const review={decision:"ACCEPTED",version:1,notes,passageKeys:[assurance.passages[0].key],validUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10),scopeConfirmed:true,originalsChecked:true};
    await reviewAssurance(reviewer,prepared.id,review,{storage:store});const exported=await exportAssurance(reviewer,prepared.id);assert.equal(exported.currentAtExport,true);assert.match(JSON.stringify(exported),/"unitKind":"block"/);
    const incomplete=await createEvidence(uploader,taskId,"unresolved.docx",fixtureDocx(paragraph(quote)+'<w:ins>'+paragraph("Fictional revised text awaiting review.")+'</w:ins>'),{storage:store,scan});await reviewEvidence(reviewer,incomplete.id,{decision:"APPROVED",version:1,notes},store);
    assert.equal((await inspectEvidence(maker,incomplete.id,store)).blocked,true);
    const blocked=await prepareProgramme(maker,{evidenceIds:[incomplete.id],method:"SEARCH",consent:true},{storage:store}),blockedRow=await db.programmeImport.findUniqueOrThrow({where:{id:blocked.id}}),blockedResult=blockedRow.result as unknown as ProgrammeResult;
    await assert.rejects(()=>acceptProgramme(reviewer,blocked.id,{...approval,keys:blockedResult.controls.map(c=>c.key)},{storage:store}),(e:any)=>e.status===409);
    const blockedAssessment=await prepareAssurance(maker,{taskId,evidenceIds:[incomplete.id],method:"CONTENT_SEARCH",consent:true},{storage:store}),blockedAssessmentRow=await db.assuranceAssessment.findUniqueOrThrow({where:{id:blockedAssessment.id}}),blockedAssurance=blockedAssessmentRow.result as unknown as AssuranceResult;
    await assert.rejects(()=>reviewAssurance(reviewer,blockedAssessment.id,{...review,passageKeys:[blockedAssurance.passages[0].key]},{storage:store}),(e:any)=>e.status===409);
    // A forged archive never enters storage, even if the scanner mock returns CLEAN.
    const before=objects.size;await assert.rejects(()=>createEvidence(uploader,taskId,"macro.docx",fixtureDocx(undefined,[["word/vbaProject.bin","fixture"]]),{storage:store,scan}),(e:any)=>e.status===422);assert.equal(objects.size,before);
    // Revocation while bytes are being read prevents disclosure of extracted text.
    await assert.rejects(()=>inspectEvidence(uploader,evidence.id,{...store,async get(k){await db.membership.delete({where:{organizationId_userId:{organizationId:ids[0],userId:uploader.userId}}});return store.get(k);}}),(e:any)=>e.status===403);
    await db.membership.create({data:uploader});
    const events=await db.auditEvent.findMany({where:{organizationId:ids[0],action:"evidence.extraction_requested"}});assert.doesNotMatch(JSON.stringify(events),/existing-policy|Fictional widget staff/);
    await db.auditEvent.createMany({data:Array.from({length:30-events.length},()=>({organizationId:ids[0],actorId:maker.userId,action:"evidence.extraction_requested",entityType:"Evidence",entityId:evidence.id,details:{}}))});
    await assert.rejects(()=>inspectEvidence(maker,evidence.id,store),(e:any)=>e.status===429);
  }finally{
    for(const name of ["assuranceAssessment","intelligenceDecision","intelligenceRun","businessProfile","auditEvent","aiDailyUsage","evidence","obligation","managedControl","programmeImport","membership","regulatorySnapshot"] as const)await (db[name] as any).deleteMany({where:{organizationId:{in:ids}}});
    await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  }
});
