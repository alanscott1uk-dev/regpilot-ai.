import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {lossScenarios,saveLossScenario} from "../lib/server/risk-loss-service";
import {assuranceFixture,future,rejects} from "./helpers/assurance-fixture";
import {createRisk} from "../lib/server/risk-service";

test("financial scenarios bind the model and optional evidence to an exact tenant risk revision",async()=>{
  const f=await assuranceFixture();
  try {
    const risk=await createRisk(f.ed,{requestKey:randomUUID(),title:"Fictional delayed service",description:"Clients may experience a delay in this fictional service.",category:"OPERATIONAL",
      ownerId:f.ed.userId,likelihood:2,impact:3,ratingRationale:"Fictional reference data illustrates the assessment.",strategy:"MITIGATE",reviewDueAt:future(),controlIds:[]});
    const file=await f.file(),before={eventsPerYear:1,low:1000,likely:2000,high:3000};
    const input={riskVersion:risk.version,requestKey:randomUUID(),title:"Service delay before and after treatment",
      assumptions:"Fictional losses use an internal exercise and exclude the cost of the treatment.",evidenceId:file.id,inputs:{before,after:{...before,eventsPerYear:0.25}}};
    await assert.rejects(()=>saveLossScenario(f.out,risk.id,input,f.store),rejects(404));
    await assert.rejects(()=>saveLossScenario(f.st,risk.id,input,f.store),rejects(403));
    await assert.rejects(()=>saveLossScenario(f.re,risk.id,input,f.store),rejects(403));
    await assert.rejects(()=>saveLossScenario(f.ed,risk.id,{...input,evidenceId:randomUUID()},f.store),rejects(409));
    const records=await Promise.all([saveLossScenario(f.ed,risk.id,input,f.store),saveLossScenario(f.ed,risk.id,input,f.store)]);
    assert.equal(records[0].id,records[1].id);
    await assert.rejects(()=>saveLossScenario(f.ed,risk.id,{...input,title:"Different assumptions"},f.store),rejects(409));
    const saved=(await lossScenarios(f.st,risk.id)).scenarios[0];
    assert.equal(saved.result.before.expected,2000);assert.equal(saved.result.expectedReduction,1500);
    assert.equal(saved.currentRevision,true);assert.equal(saved.evidenceStatus,"Reviewed evidence current");
    await saveLossScenario(f.ed,risk.id,{...input,requestKey:randomUUID(),evidenceId:null},f.store);
    assert.equal((await lossScenarios(f.st,risk.id)).scenarios[0].evidenceStatus,"Assumptions only");
    await db.evidence.update({where:{id:file.id},data:{scanStatus:"QUARANTINED"}});
    await db.riskRecord.update({where:{id:risk.id},data:{version:{increment:1}}});
    const updated=(await lossScenarios(f.o,risk.id)).scenarios.find(s=>s.id===saved.id)!;
    assert.equal(updated.currentRevision,false);assert.equal(updated.evidenceStatus,"Evidence changed");assert.deepEqual(updated.result,saved.result);
    await assert.rejects(()=>saveLossScenario(f.ed,risk.id,{...input,requestKey:randomUUID()},f.store),rejects(409));
    assert.equal((await db.riskRecord.findUniqueOrThrow({where:{id:risk.id}})).status,"OPEN");
    assert.equal(await db.auditEvent.count({where:{organizationId:f.a.id,entityId:risk.id,action:"risk.loss-scenario-saved"}}),2);
  } finally {
    await db.riskLossScenario.deleteMany({where:{organizationId:f.a.id}});
    await db.riskRecord.deleteMany({where:{organizationId:f.a.id}});
    await f.cleanup();
  }
});
