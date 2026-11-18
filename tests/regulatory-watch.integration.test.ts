import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {checkOfficialSource,listSourceSnapshots,reviewSourceSnapshot} from "../lib/server/regulatory-watch";
import type {AuthorizedContext} from "../lib/server/authorization";
import {sourceTextHash} from "../lib/regulatory/source-fingerprint.mjs";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
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

test("a curated source address migration preserves approved history and requires review even when its text and recent check are unchanged",async()=>{
 const marker=randomUUID(),users=await Promise.all(["observer","reviewer"].map(name=>db.user.create({data:{externalId:marker+name,email:marker+name+"@example.invalid"}})));
 const org=await db.organization.create({data:{name:"Fictional source relocation "+marker}}),[observer,reviewer]=users;
 const a:AuthorizedContext={userId:observer.id,organizationId:org.id,role:"EDITOR"},b:AuthorizedContext={...a,userId:reviewer.id,role:"ADMIN"};
 const source=REGULATORY_SOURCES.find(s=>s.id==="sepa-waste-duty")!;
 try{
  await db.membership.createMany({data:[a,b]});
  const old=await db.regulatorySnapshot.create({data:{organizationId:org.id,sourceId:source.id,title:"Fictional previously reviewed publication",url:"https://beta.sepa.scot/regulation/waste/duty-of-care/",bodyText:body,contentHash:sourceTextHash(body),capturedById:observer.id,reviewStatus:"REVIEWED",reviewerId:reviewer.id,reviewedAt:new Date(),version:2,lastCheckedAt:new Date()}});
  let fetches=0,releaseLoads!:()=>void;const loadsReady=new Promise<void>(resolve=>{releaseLoads=resolve;});
  const loader=async()=>{fetches++;if(fetches===2)releaseLoads();await loadsReady;return {id:source.id,title:source.title,url:source.url!,updatedAt:null,revisionAt:null,text:body};};
  const outcomes=await Promise.all([checkOfficialSource(a,source.id,loader),checkOfficialSource(a,source.id,loader)]);
  const relocated=outcomes.find(result=>result.state==="BASELINE")!;
  assert.ok(relocated,"recent check of the old address must not hide the migration");assert.equal(fetches,2);
  assert.equal(relocated.snapshot.reviewStatus,"NEEDS_REVIEW");assert.equal(relocated.snapshot.url,source.url);
  assert.notEqual(relocated.snapshot.id,old.id);assert.equal(relocated.snapshot.contentHash,old.contentHash);
  assert.equal(relocated.comparison.changed,false);assert.deepEqual(relocated.comparison.added,[]);assert.deepEqual(relocated.comparison.removed,[]);
  assert.match(relocated.note,/address changed.*independent review/);
  assert.equal(await db.regulatorySnapshot.count({where:{organizationId:org.id}}),2,"concurrent relocation must create only one new identity record");
  assert.deepEqual(await db.regulatorySnapshot.findUniqueOrThrow({where:{id:old.id}}),old,"old URL, review and checked timestamps remain historical");
  const events=await db.auditEvent.findMany({where:{organizationId:org.id}});
  assert.equal(events.filter(event=>event.action==="regulatory.baseline_created").length,1);
  assert.equal(events.filter(event=>event.action==="regulatory.source_text_changed").length,0,"a new address is not reported as a text change");
  const details=events.find(event=>event.action==="regulatory.baseline_created")!.details as any;
  assert.equal(details.sourceRelocated,true);assert.equal(details.previousSnapshotId,old.id);assert.equal(details.previousUrl,old.url);assert.equal(details.changedText,false);
  await assert.rejects(()=>reviewSourceSnapshot(a,relocated.snapshot.id,{status:"REVIEWED",version:1,notes:"A captured address cannot be independently self-reviewed."}),(e:any)=>e.status===403);
  assert.equal((await reviewSourceSnapshot(b,relocated.snapshot.id,{status:"REVIEWED",version:1,notes:"Independently reviewed the source identity at its new official address."})).reviewStatus,"REVIEWED");
  const cooldown=await checkOfficialSource(a,source.id,async()=>{throw Error("The new verified address is now in cooldown");});
  assert.equal(cooldown.state,"COOLDOWN");assert.equal(cooldown.snapshot.id,relocated.snapshot.id);
 }finally{
  await db.auditEvent.deleteMany({where:{organizationId:org.id}});await db.regulatorySnapshot.deleteMany({where:{organizationId:org.id}});
  await db.membership.deleteMany({where:{organizationId:org.id}});await db.organization.delete({where:{id:org.id}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
 }
});
