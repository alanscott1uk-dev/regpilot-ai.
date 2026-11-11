import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {db} from "../lib/server/db";
import {recognitionWorkspace,createRecognitionAction} from "../lib/server/recognition-service";
import {recognitionPackageWorkspace,previewRecognitionPackage,exportRecognitionPackage} from "../lib/server/recognition-package-service";
import {createEvidence,reviewEvidence} from "../lib/server/evidence-service";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";
import {GET as GET_PACKAGE,POST as POST_PACKAGE} from "../app/api/workspace/recognition/package/route";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";
const status=(expected:number)=>(error:unknown)=>!!error&&typeof error==="object"&&"status" in error&&error.status===expected;

test("external assurance work is tenant isolated, idempotent and cannot award recognition",async()=>{
 const unique=randomUUID();
 const users=await Promise.all(["owner","outside","viewer"].map(name=>db.user.create({data:{externalId:"assurance-"+name+unique,email:name+"-"+unique+"@example.invalid"}})));
 const orgs=await Promise.all(["one","two"].map(name=>db.organization.create({data:{name:"Recognition fixture "+name+unique}})));
 const ctx:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:"OWNER"};
 const outside:AuthorizedContext={organizationId:orgs[1].id,userId:users[1].id,role:"OWNER"};
 const viewer:AuthorizedContext={organizationId:orgs[0].id,userId:users[2].id,role:"VIEWER"};
 const oldAllowed=process.env.REGPILOT_AI_ALLOWED_EMAILS;process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(",");
 const ids=orgs.map(o=>o.id);
 try{
  await db.membership.createMany({data:[ctx,outside,viewer]});
  const initial=await recognitionWorkspace(ctx);
  assert.equal(initial.tracks.length,7);assert.ok(initial.tracks.every(t=>t.publicStatus==="NOT_VERIFIED"&&!t.task));
  assert.equal((await recognitionWorkspace(outside)).tracks.every(t=>!t.task),true);
  await assert.rejects(()=>createRecognitionAction(viewer,"iso-42001"),status(403));
  await assert.rejects(()=>createRecognitionAction(ctx,"fabricated-official-approval"),status(400));
  const outcomes=await Promise.all([createRecognitionAction(ctx,"iso-42001"),createRecognitionAction(ctx,"iso-42001")]);
  assert.equal(outcomes[0].taskId,outcomes[1].taskId);assert.equal(outcomes.filter(o=>o.reused).length,1);
  const after=await recognitionWorkspace(ctx),foreign=await recognitionWorkspace(outside);
  assert.equal(after.tracks.find(t=>t.id==="iso-42001")?.task?.id,outcomes[0].taskId);
  assert.equal(foreign.tracks.find(t=>t.id==="iso-42001")?.task,null);
  assert.ok(after.tracks.every(t=>t.publicStatus==="NOT_VERIFIED"));
  const row=await db.obligation.findUniqueOrThrow({where:{id:outcomes[0].taskId}});
  assert.equal(row.automationKey,"recognition:iso-42001");assert.equal(row.category,"External regulatory assurance");
  const events=await db.auditEvent.findMany({where:{organizationId:ctx.organizationId,action:"recognition.internal_evidence_action_created"}});
  assert.equal(events.length,1);assert.equal((events[0].details as {notAnApproval:boolean}).notAnApproval,true);
  assert.doesNotMatch(JSON.stringify(events),/certificate awarded|MHRA approved/i);
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.obligation.deleteMany({where:{organizationId:{in:ids}}});
  await db.membership.deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});
  await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  if(oldAllowed===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=oldAllowed;
 }
});

function unpackStoredZip(bytes:Uint8Array){
 const archive=Buffer.from(bytes),files=new Map<string,Buffer>();let offset=0;
 while(offset+30<=archive.length&&archive.readUInt32LE(offset)===0x04034b50){
  assert.equal(archive.readUInt16LE(offset+8),0,"fixture reader expects stored ZIP entries");
  const size=archive.readUInt32LE(offset+18),nameLength=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28);
  const name=archive.subarray(offset+30,offset+30+nameLength).toString("utf8"),start=offset+30+nameLength+extra;
  assert.ok(start+size<=archive.length);assert.ok(!files.has(name));files.set(name,archive.subarray(start,start+size));offset=start+size;
 }
 return files;
}
test("assurance pack verifies exact selected bytes, preview context and current authority without awarding certification",async()=>{
 const suffix=randomUUID(),users=await Promise.all(["owner","reviewer","outside","viewer"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}})));
 const orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional pack "+n+suffix}}))),ids=orgs.map(o=>o.id);
 const owner:AuthorizedContext={organizationId:ids[0],userId:users[0].id,role:"OWNER"};
 const reviewer:AuthorizedContext={...owner,userId:users[1].id,role:"ADMIN"};
 const outside:AuthorizedContext={organizationId:ids[1],userId:users[2].id,role:"OWNER"};
 const viewer:AuthorizedContext={...owner,userId:users[3].id,role:"VIEWER"};
 const oldAllowed=process.env.REGPILOT_AI_ALLOWED_EMAILS;process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(",");
 const objects=new Map<string,Uint8Array>();
 const store:EvidenceObjectStore={async put(key,bytes){objects.set(key,Uint8Array.from(bytes));},async get(key){const value=objects.get(key);if(!value)throw Error("Missing fixture");return Uint8Array.from(value);},async remove(key){objects.delete(key);}};
 const clean=async()=>({status:"CLEAN" as const,engine:"fictional-only"});
 const bytes=fixturePdf([["Fictional quality assessment file for an independent assurance preparation test. No regulator or customer data."]]);
 try{
  await db.membership.createMany({data:[owner,reviewer,outside,viewer]});
  const action=await createRecognitionAction(owner,"iso-42001"),otherAction=await createRecognitionAction(outside,"iso-42001");
  const accepted=await createEvidence(owner,action.taskId,"reviewed.pdf",bytes,{storage:store,scan:clean});
  await reviewEvidence(reviewer,accepted.id,{decision:"APPROVED",version:1,notes:"Independently reviewed fictional material for bounded preparation tests only."},store);
  const pending=await createEvidence(owner,action.taskId,"pending.pdf",bytes,{storage:store,scan:clean});
  const foreign=await createEvidence(outside,otherAction.taskId,"private-other-tenant.pdf",bytes,{storage:store,scan:clean});
  const selection={trackId:"iso-42001",evidenceIds:[accepted.id]};
  const catalog=await recognitionPackageWorkspace(owner,"iso-42001");
  assert.equal(catalog.files.find(f=>f.id===accepted.id)?.eligible,true);
  assert.equal(catalog.files.find(f=>f.id===pending.id)?.eligible,false);
  assert.ok(!catalog.files.some(f=>f.id===foreign.id));
  await assert.rejects(()=>recognitionPackageWorkspace(viewer,"iso-42001"),status(403));
  await assert.rejects(()=>previewRecognitionPackage(outside,selection),status(409));
  await assert.rejects(()=>previewRecognitionPackage(owner,{...selection,evidenceIds:[pending.id]}),status(409));
  await assert.rejects(()=>previewRecognitionPackage(owner,{...selection,evidenceIds:[foreign.id]}),status(409));
  await assert.rejects(()=>previewRecognitionPackage(owner,{...selection,evidenceIds:[accepted.id,accepted.id]}));
  const preview=await previewRecognitionPackage(owner,selection);
  assert.equal(preview.filesVerifiedNow,false);assert.ok(preview.plan.requirements.every(r=>r.assessment==="NOT_ASSESSED"));
  await assert.rejects(()=>exportRecognitionPackage(owner,{...selection,previewHash:preview.previewHash,confirm:false},store));
  await db.obligation.update({where:{id:action.taskId},data:{notes:"Context changed after preview"}});
  await assert.rejects(()=>exportRecognitionPackage(owner,{...selection,previewHash:preview.previewHash,confirm:true},store),status(409));
  const current=await previewRecognitionPackage(owner,selection);
  const exported=await exportRecognitionPackage(owner,{...selection,previewHash:current.previewHash,confirm:true},store);
  assert.equal(createHash("sha256").update(exported.bytes).digest("hex"),exported.sha256);
  const archive=unpackStoredZip(exported.bytes),manifest=JSON.parse(archive.get("manifest.json")!.toString());
  assert.equal(archive.size,3);assert.equal(manifest.files.length,1);
  assert.equal(manifest.files[0].id,accepted.id);assert.equal(manifest.files[0].bytesVerified,true);
  assert.deepEqual(archive.get(manifest.files[0].archivePath),Buffer.from(bytes));
  assert.equal(manifest.externallySubmitted,false);assert.equal(manifest.externallyCertified,false);assert.equal(manifest.requirementCoverageAssessed,false);
  assert.doesNotMatch(JSON.stringify(manifest),new RegExp(foreign.id+"|private-other-tenant"));
  const record=await db.evidence.findUniqueOrThrow({where:{id:accepted.id}});
  objects.set(record.storageKey,Uint8Array.from(Buffer.from("tampered")));
  await assert.rejects(()=>exportRecognitionPackage(owner,{...selection,previewHash:current.previewHash,confirm:true},store),status(409));
  objects.set(record.storageKey,Uint8Array.from(bytes));
  const mutateReview:EvidenceObjectStore={...store,async get(key){const value=await store.get(key);await db.evidence.update({where:{id:accepted.id},data:{reviewVersion:{increment:1}}});return value;}};
  await assert.rejects(()=>exportRecognitionPackage(owner,{...selection,previewHash:current.previewHash,confirm:true},mutateReview),status(409));
  const latest=await previewRecognitionPackage(owner,selection);
  const revoke:EvidenceObjectStore={...store,async get(key){const value=await store.get(key);await db.membership.update({where:{organizationId_userId:{organizationId:owner.organizationId,userId:owner.userId}},data:{role:"VIEWER"}});return value;}};
  await assert.rejects(()=>exportRecognitionPackage(owner,{...selection,previewHash:latest.previewHash,confirm:true},revoke),status(403));
  const events=await db.auditEvent.findMany({where:{organizationId:owner.organizationId,action:"recognition.preparation_package_exported"}});
  assert.equal(events.length,1,"blocked exports must not record successful disclosure");
  assert.equal((events[0].details as {archiveSha256:string}).archiveSha256,exported.sha256);
  assert.ok((await recognitionWorkspace(reviewer)).tracks.every(t=>t.publicStatus==="NOT_VERIFIED"));
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.evidence.deleteMany({where:{organizationId:{in:ids}}});
  await db.obligation.deleteMany({where:{organizationId:{in:ids}}});await db.membership.deleteMany({where:{organizationId:{in:ids}}});
  await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  if(oldAllowed===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=oldAllowed;
 }
});
test("preparation-pack endpoints fail closed before private workspace activation",async()=>{
 const old=process.env.REGPILOT_WORKSPACE_ENABLED;process.env.REGPILOT_WORKSPACE_ENABLED="false";
 try{
  const url="https://example.invalid/api/workspace/recognition/package?organizationId="+randomUUID()+"&trackId=iso-42001";
  const get=await GET_PACKAGE(new Request(url));assert.equal(get.status,503);assert.match(get.headers.get("Cache-Control")||"",/no-store/);
  for(const action of ["PREVIEW","EXPORT"]){
   const response=await POST_PACKAGE(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:randomUUID(),trackId:"iso-42001",action,evidenceIds:[randomUUID()],confirm:true})}));
   assert.equal(response.status,503);
  }
 }finally{if(old===undefined)delete process.env.REGPILOT_WORKSPACE_ENABLED;else process.env.REGPILOT_WORKSPACE_ENABLED=old;}
});
