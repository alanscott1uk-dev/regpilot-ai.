import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {createEvidence,listEvidence,downloadEvidence,reviewEvidence} from "../lib/server/evidence-service";
import {EvidenceError,MAX_ORG_EVIDENCE_FILES} from "../lib/evidence/file-guard.mjs";
import type {EvidenceObjectStore} from "../lib/server/evidence-storage";

const file=Buffer.from("%PDF-1.7\n1 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF");
const clean=async()=>({status:"CLEAN" as const,engine:"test-clamd"});
test("private scanned evidence: metadata, file bytes, permissions, independent reviews, tamper and quota",async()=>{
 const suffix=randomUUID().slice(0,10);
 const users=await Promise.all(["editor","admin","outside","viewer"].map(name=>db.user.create({
  data:{externalId:"file-"+name+"-"+suffix,email:name+"-"+suffix+"@example.invalid"}
 })));
 const [editor,admin,outside,viewer]=users;
 const orgA=await db.organization.create({data:{name:"Evidence org A "+suffix}});
 const orgB=await db.organization.create({data:{name:"Evidence org B "+suffix}});
 const orgIds=[orgA.id,orgB.id],userIds=users.map(u=>u.id);
 const objects=new Map<string,Uint8Array>();
 const store:EvidenceObjectStore={
  async put(key,bytes){if(objects.has(key))throw new Error("Object exists");objects.set(key,Uint8Array.from(bytes));},
  async get(key){const b=objects.get(key);if(!b)throw new Error("Missing test object");return Uint8Array.from(b);},
  async remove(key){objects.delete(key);}
 };
 const ctx=(userId:string,organizationId:string,role:"OWNER"|"ADMIN"|"EDITOR"|"VIEWER")=>({userId,organizationId,role});
 const editorCtx=ctx(editor.id,orgA.id,"EDITOR"),adminCtx=ctx(admin.id,orgA.id,"ADMIN");
 const viewerCtx=ctx(viewer.id,orgA.id,"VIEWER"),outsideCtx=ctx(outside.id,orgB.id,"OWNER");
 try{
  const task=await db.obligation.create({data:{organizationId:orgA.id,title:"Review sample supplier",category:"Training",
   ownerName:"QA",dueDate:new Date("2026-12-01T00:00:00Z")}});
  await db.membership.createMany({data:[
   {organizationId:orgA.id,userId:editor.id,role:"EDITOR"},{organizationId:orgA.id,userId:admin.id,role:"ADMIN"},
   {organizationId:orgA.id,userId:viewer.id,role:"VIEWER"},{organizationId:orgB.id,userId:outside.id,role:"OWNER"}
  ]});
  await assert.rejects(()=>createEvidence(viewerCtx,task.id,"source.pdf",file,{storage:store,scan:clean}),(e:any)=>e.status===403);
  await assert.rejects(()=>createEvidence(outsideCtx,task.id,"source.pdf",file,{storage:store,scan:clean}),(e:any)=>e.status===404);
  await assert.rejects(()=>createEvidence(editorCtx,task.id,"source.pdf",file,{
   storage:store,scan:async()=>({status:"INFECTED" as any,engine:"mock"})
  }),(e:any)=>e.status===422);
  assert.equal(objects.size,0,"bad files must never reach storage");
  const created=await createEvidence(editorCtx,task.id,"sample.pdf",file,{storage:store,scan:clean});
  assert.equal(created.scanStatus,"CLEAN");assert.equal(created.reviewStatus,"PENDING_REVIEW");
  assert.equal(created.uploadedById,editor.id);assert.equal(objects.size,1);
  assert.equal((await listEvidence(editorCtx,task.id)).length,1);
  await assert.rejects(()=>listEvidence(outsideCtx,task.id),(e:any)=>e.status===404);
  await assert.rejects(()=>downloadEvidence(outsideCtx,created.id,store),(e:any)=>e.status===404);
  const verified=await downloadEvidence(viewerCtx,created.id,store);
  assert.equal(Buffer.from(verified.bytes).equals(file),true);
  await assert.rejects(()=>reviewEvidence(editorCtx,created.id,{decision:"APPROVED",notes:"This should be reviewed by a separate authorised person.",version:1},store),(e:any)=>e.status===403);
  await assert.rejects(()=>reviewEvidence(viewerCtx,created.id,{decision:"APPROVED",notes:"Viewer cannot approve evidence from their organisation.",version:1},store),(e:any)=>e.status===403);
  await assert.rejects(()=>reviewEvidence(outsideCtx,created.id,{decision:"APPROVED",notes:"Wrong organisation cannot approve the record.",version:1},store),(e:any)=>e.status===404);
  await assert.rejects(()=>reviewEvidence(adminCtx,created.id,{decision:"APPROVED",notes:"Too short",version:1},store),(e:any)=>e.status===400);
  const approved=await reviewEvidence(adminCtx,created.id,{decision:"APPROVED",
   notes:"Independently checked the example PDF and recorded the decision.",version:1},store);
  assert.equal(approved.reviewStatus,"APPROVED");assert.equal(approved.reviewVersion,2);
  await assert.rejects(()=>reviewEvidence(adminCtx,created.id,{decision:"REJECTED",notes:"Attempt to replay a stale evidence review record.",version:1},store),(e:any)=>e.status===409);
  const [key]=objects.keys();objects.set(key,Buffer.from("%PDF-1.7\nbadly tampered\n%%EOF"));
  await assert.rejects(()=>downloadEvidence(adminCtx,created.id,store),(e:any)=>e.status===409);
  objects.set(key,Uint8Array.from(file));
  await db.organization.update({where:{id:orgA.id},data:{evidenceCount:MAX_ORG_EVIDENCE_FILES}});
  await assert.rejects(()=>createEvidence(editorCtx,task.id,"second.pdf",file,{storage:store,scan:clean}),(e:any)=>e.status===429);
  assert.equal(objects.size,1,"storage object created during failed quota reservation must be removed");
  const audit=await db.auditEvent.findMany({where:{organizationId:orgA.id,entityType:"Evidence"}});
  assert.equal(audit.length,2);
  assert.ok(!audit.some(x=>JSON.stringify(x.details).includes("sample.pdf")));
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.evidence.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.obligation.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.membership.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.organization.deleteMany({where:{id:{in:orgIds}}});
  await db.user.deleteMany({where:{id:{in:userIds}}});
 }
});
