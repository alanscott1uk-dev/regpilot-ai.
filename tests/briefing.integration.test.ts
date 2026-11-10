import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {fetchOperationalBrief} from "../lib/server/briefing-service";
import type {AuthorizedContext} from "../lib/server/authorization";

test("seven-day regulatory briefing isolates tenants and distinguishes text changes from baselines",async()=>{
 const mark=randomUUID();
 const users=await Promise.all(["one","two"].map(n=>db.user.create({data:{externalId:"brief-"+n+mark,email:"brief-"+n+mark+"@example.invalid"}})));
 const orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional briefing "+n+mark}})));
 const oldAllowed=process.env.REGPILOT_AI_ALLOWED_EMAILS;
 process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(",");
 const a:AuthorizedContext={userId:users[0].id,organizationId:orgs[0].id,role:"OWNER"};
 const b:AuthorizedContext={userId:users[1].id,organizationId:orgs[1].id,role:"OWNER"};
 try{
  await db.membership.createMany({data:[{organizationId:a.organizationId,userId:a.userId,role:"OWNER"},{organizationId:b.organizationId,userId:b.userId,role:"OWNER"}]});
  const body="A fictional business requirement used only for testing source changes, independent reviews, authentic audit events and tenant-scoped reporting.";
  const snap=await db.regulatorySnapshot.create({data:{organizationId:a.organizationId,sourceId:"uk-data-protection",title:"Fictional A publication",url:"https://www.gov.uk/data-protection-your-business",
   bodyText:body,contentHash:"a".repeat(64),capturedById:a.userId,reviewStatus:"NEEDS_REVIEW"}});
  await db.auditEvent.create({data:{organizationId:a.organizationId,actorId:a.userId,action:"regulatory.source_text_changed",
   entityType:"RegulatorySnapshot",entityId:snap.id,details:{sourceId:snap.sourceId}}});
  await db.watchSchedule.create({data:{organizationId:a.organizationId,sourceId:snap.sourceId,configuredById:a.userId,
   enabled:true,intervalHours:24,failureCode:"HTTP_UNAVAILABLE",nextCheckAt:new Date(Date.now()-7200000)}});
  await db.obligation.create({data:{organizationId:a.organizationId,title:"Review fictional official source",
   category:"Regulatory intelligence",ownerName:users[0].email,dueDate:new Date(Date.now()+2*86400000)}});
  await db.obligation.create({data:{organizationId:b.organizationId,title:"PRIVATE OTHER ORG TASK",
   category:"Private",ownerName:users[1].email,dueDate:new Date(Date.now()+2*86400000)}});
  const ra=await fetchOperationalBrief(a),rb=await fetchOperationalBrief(b);
  assert.equal(ra.summary.changedPublications,1);assert.equal(ra.changes[0].title,"Fictional A publication");
  assert.equal(ra.summary.awaitingReview,1);assert.equal(ra.summary.sourceCheckIssues,1);
  assert.equal(ra.summary.dueWork,1);assert.equal(rb.summary.changedPublications,0);
  assert.equal(rb.summary.sourceCheckIssues,0);assert.equal(rb.summary.dueWork,1);
  assert.ok(rb.tasks.some(x=>x.title==="PRIVATE OTHER ORG TASK"));
  assert.doesNotMatch(JSON.stringify(rb),/Fictional A publication|Review fictional official source/);
  assert.doesNotMatch(JSON.stringify(ra),/PRIVATE OTHER ORG TASK/);
  await assert.rejects(()=>fetchOperationalBrief({...b,organizationId:a.organizationId}),e=>!!e);
 }finally{
  const ids=orgs.map(o=>o.id);
  await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});
  await db.watchSchedule.deleteMany({where:{organizationId:{in:ids}}});
  await db.obligation.deleteMany({where:{organizationId:{in:ids}}});
  await db.regulatorySnapshot.deleteMany({where:{organizationId:{in:ids}}});
  await db.membership.deleteMany({where:{organizationId:{in:ids}}});
  await db.organization.deleteMany({where:{id:{in:ids}}});
  await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  if(oldAllowed===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=oldAllowed;
 }
});
