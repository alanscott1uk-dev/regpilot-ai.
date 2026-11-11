import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {recognitionWorkspace,createRecognitionAction} from "../lib/server/recognition-service";
import type {AuthorizedContext} from "../lib/server/authorization";

test("external assurance work is tenant isolated, idempotent and cannot award recognition",async()=>{
 const unique=randomUUID();
 const users=await Promise.all(["owner","outside","viewer"].map(name=>db.user.create({
  data:{externalId:"assurance-"+name+unique,email:name+"-"+unique+"@example.invalid"}
 })));
 const orgs=await Promise.all(["one","two"].map(name=>db.organization.create({data:{name:"Recognition fixture "+name+unique}})));
 const ctx:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:"OWNER"};
 const outside:AuthorizedContext={organizationId:orgs[1].id,userId:users[1].id,role:"OWNER"};
 const viewer:AuthorizedContext={organizationId:orgs[0].id,userId:users[2].id,role:"VIEWER"};
 const oldAllowed=process.env.REGPILOT_AI_ALLOWED_EMAILS;
 process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(",");
 const ids=orgs.map(o=>o.id);
 try{
  await db.membership.createMany({data:[
   {organizationId:orgs[0].id,userId:users[0].id,role:"OWNER"},
   {organizationId:orgs[0].id,userId:users[2].id,role:"VIEWER"},
   {organizationId:orgs[1].id,userId:users[1].id,role:"OWNER"}
  ]});
  const initial=await recognitionWorkspace(ctx);
  assert.equal(initial.tracks.length,7);
  assert.ok(initial.tracks.every(t=>t.publicStatus==="NOT_VERIFIED"&&!t.task));
  assert.equal((await recognitionWorkspace(outside)).tracks.every(t=>!t.task),true);
  await assert.rejects(()=>createRecognitionAction(viewer,"iso-42001"),(e:any)=>e?.status===403);
  await assert.rejects(()=>createRecognitionAction(ctx,"fabricated-official-approval"),(e:any)=>e?.status===400);
  const outcomes=await Promise.all([createRecognitionAction(ctx,"iso-42001"),createRecognitionAction(ctx,"iso-42001")]);
  assert.equal(outcomes[0].taskId,outcomes[1].taskId);
  assert.equal(outcomes.filter(o=>o.reused).length,1);
  const after=await recognitionWorkspace(ctx),foreign=await recognitionWorkspace(outside);
  assert.equal(after.tracks.find(t=>t.id==="iso-42001")?.task?.id,outcomes[0].taskId);
  assert.equal(foreign.tracks.find(t=>t.id==="iso-42001")?.task,null);
  assert.ok(after.tracks.every(t=>t.publicStatus==="NOT_VERIFIED"));
  const t=await db.obligation.findUniqueOrThrow({where:{id:outcomes[0].taskId}});
  assert.equal(t.automationKey,"recognition:iso-42001");
  assert.equal(t.category,"External regulatory assurance");
  const events=await db.auditEvent.findMany({where:{organizationId:ctx.organizationId,action:"recognition.internal_evidence_action_created"}});
  assert.equal(events.length,1);assert.equal((events[0].details as any).notAnApproval,true);
  assert.doesNotMatch(JSON.stringify(events),/certificate awarded|MHRA approved/i);
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});
  await db.obligation.deleteMany({where:{organizationId:{in:ids}}});
  await db.membership.deleteMany({where:{organizationId:{in:ids}}});
  await db.organization.deleteMany({where:{id:{in:ids}}});
  await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  if(oldAllowed===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;
  else process.env.REGPILOT_AI_ALLOWED_EMAILS=oldAllowed;
 }
});
