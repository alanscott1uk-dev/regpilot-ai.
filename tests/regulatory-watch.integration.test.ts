import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {checkOfficialSource,listSourceSnapshots,reviewSourceSnapshot} from "../lib/server/regulatory-watch";
import type {AuthorizedContext} from "../lib/server/authorization";
const body="The organisation should maintain documented quality procedures and retain evidence of periodic supplier reviews. Staff must understand the written processes and take care to record investigations where discrepancies arise. An independent reviewer should assess the documented results and record any proposed remedial actions.";
const changed=body.replace("retain evidence of periodic supplier reviews","retain evidence of quarterly reviews of critical suppliers");
const id="home-office-domestic";
test("official body tracking: baseline, metadata-only, text drift, tenant boundaries, review and replay",async()=>{
 const suffix=randomUUID().slice(0,10);
 const users=await Promise.all(["observer","reviewer","outsider"].map(name=>db.user.create({
  data:{externalId:"source-"+name+"-"+suffix,email:name+"-"+suffix+"@example.invalid"}
 })));
 const [observer,reviewer,outsider]=users;
 const orgA=await db.organization.create({data:{name:"Source test A "+suffix}});
 const orgB=await db.organization.create({data:{name:"Source test B "+suffix}});
 const orgs=[orgA.id,orgB.id],userIds=users.map(u=>u.id);
 const ctx=(userId:string,organizationId:string,role:AuthorizedContext["role"]):AuthorizedContext=>({userId,organizationId,role});
 const a=ctx(observer.id,orgA.id,"EDITOR"),b=ctx(reviewer.id,orgA.id,"ADMIN"),other=ctx(outsider.id,orgB.id,"OWNER");
 const source=(text:string,revisionAt="2026-11-06")=>async()=>({
  id,title:"Fictional test publication",url:"https://www.gov.uk/guidance/controlled-drugs-domestic-licences",
  revisionAt,updatedAt:revisionAt,text
 });
 try{
  await db.membership.createMany({data:[
   {organizationId:orgA.id,userId:observer.id,role:"EDITOR"},
   {organizationId:orgA.id,userId:reviewer.id,role:"ADMIN"},
   {organizationId:orgB.id,userId:outsider.id,role:"OWNER"}
  ]});
  const first=await checkOfficialSource(a,id,source(body));
  assert.equal(first.state,"BASELINE");
  assert.equal(first.snapshot.reviewStatus,"NEEDS_REVIEW");
  assert.equal((await listSourceSnapshots(other)).length,0);
  const baselineId=first.snapshot.id;
  const cooldown=await checkOfficialSource(a,id,async()=>{throw new Error("Should not refetch during cooldown")});
  assert.equal(cooldown.state,"COOLDOWN");
  await db.regulatorySnapshot.update({where:{id:baselineId},data:{lastCheckedAt:new Date(Date.now()-1000*60*16)}});
  const unchanged=await checkOfficialSource(a,id,source(body,"2026-11-07"));
  assert.equal(unchanged.state,"UNCHANGED");
  assert.equal((await listSourceSnapshots(a)).length,1,"metadata timestamp alone must not create another body version");
  const old=await reviewSourceSnapshot(b,baselineId,{status:"REVIEWED",version:1,notes:"Reviewed the fictional source text as a baseline, not a legal change."});
  assert.equal(old.reviewStatus,"REVIEWED");assert.equal(old.version,2);
  await assert.rejects(()=>reviewSourceSnapshot(a,baselineId,{status:"REVIEWED",version:2,notes:"Uploader must not review own version."}),(e:any)=>e.status===403);
  await db.regulatorySnapshot.update({where:{id:baselineId},data:{lastCheckedAt:new Date(Date.now()-1000*60*16)}});
  const next=await checkOfficialSource(a,id,source(changed,"2026-11-08"));
  assert.equal(next.state,"CONTENT_CHANGED");
  assert.ok(next.comparison.added.some((x:string)=>x.includes("quarterly reviews")));
  assert.equal((await listSourceSnapshots(a)).length,2);
  await assert.rejects(()=>reviewSourceSnapshot(other,next.snapshot.id,{status:"REVIEWED",version:1,notes:"Wrong org cannot review this fictional publication."}),(e:any)=>e.status===404);
  await assert.rejects(()=>reviewSourceSnapshot(a,next.snapshot.id,{status:"REVIEWED",version:1,notes:"Snapshot capturer is not allowed to self-review."}),(e:any)=>e.status===403);
  const approved=await reviewSourceSnapshot(b,next.snapshot.id,{status:"REVIEWED",version:1,notes:"Reviewed source passages. Any legal impact still requires expert assessment."});
  assert.equal(approved.reviewStatus,"REVIEWED");
  await assert.rejects(()=>reviewSourceSnapshot(b,next.snapshot.id,{status:"NOT_APPLICABLE",version:1,notes:"Stale replay cannot reverse the decision."}),(e:any)=>e.status===409);
  await assert.rejects(()=>checkOfficialSource(a,"https://example.invalid",source(body)),(e:any)=>e.status===400);
  const events=await db.auditEvent.findMany({where:{organizationId:orgA.id,entityType:"RegulatorySnapshot"}});
  assert.ok(events.length>=4);
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:{in:orgs}}});
  await db.regulatorySnapshot.deleteMany({where:{organizationId:{in:orgs}}});
  await db.membership.deleteMany({where:{organizationId:{in:orgs}}});
  await db.organization.deleteMany({where:{id:{in:orgs}}});
  await db.user.deleteMany({where:{id:{in:userIds}}});
 }
});
