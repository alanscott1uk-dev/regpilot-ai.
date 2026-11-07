import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {sourceCoverage} from "../lib/server/source-coverage";
import {listSourceSnapshots} from "../lib/server/regulatory-watch";
test("source coverage spans old baselines independently of history pagination and isolates organisation status",async()=>{
 const x=await assuranceFixture();
 try{
  const base={organizationId:x.a.id,sourceId:"acas-disciplinary",title:"Fictional publication",url:"https://example.invalid",bodyText:"Fictional text only",contentHash:"a".repeat(64),capturedById:x.owner.id};
  const old=await db.regulatorySnapshot.create({data:{...base,firstCapturedAt:new Date(0),reviewStatus:"REVIEWED"}});
  await db.regulatorySnapshot.createMany({data:Array.from({length:65},(_,i)=>({...base,sourceId:"acas-flexible-working",contentHash:String(i).padStart(64,"0"),firstCapturedAt:new Date(1000+i)}))});
  assert.equal((await listSourceSnapshots(x.o)).length,60);assert.equal((await listSourceSnapshots(x.o,"acas-disciplinary"))[0].id,old.id);
  await db.watchSchedule.create({data:{organizationId:x.a.id,sourceId:base.sourceId,configuredById:x.owner.id,enabled:true,intervalHours:24,nextCheckAt:new Date()}});
  process.env.REGPILOT_MONITORING_ENABLED="false";
  const rows=await sourceCoverage(x.o),row=rows.find(r=>r.sourceId===base.sourceId)!;assert.equal(rows.length,25);assert.equal(row.snapshotId,old.id);assert.equal(row.reviewStatus,"REVIEWED");assert.equal(row.monitoring,"Awaiting activation");
  assert.equal((await sourceCoverage(x.out)).find(r=>r.sourceId===base.sourceId)!.snapshotId,null);
  await assert.rejects(()=>sourceCoverage({...x.out,organizationId:x.a.id}),rejects(403));
  process.env.REGPILOT_MONITORING_ENABLED="true";await db.watchSchedule.updateMany({where:{organizationId:x.a.id},data:{failureCode:"CHECK_OR_ANALYSIS_FAILED"}});assert.equal((await sourceCoverage(x.o)).find(r=>r.sourceId===base.sourceId)!.monitoring,"Collection needs attention");
 }finally{await db.watchSchedule.deleteMany({where:{organizationId:x.a.id}});await x.cleanup();}
});
