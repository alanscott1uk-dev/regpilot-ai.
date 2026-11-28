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

test('reconciled bills respect workspace, risk revision, period changes, replays and accounting withdrawal',async()=>{
 const {checkRiskBill}=await import('../lib/server/risk-bills');
 const {groupRiskReport}=await import('../lib/server/group-risk-report');
 const f=await assuranceFixture(),business='777',connectionId='checked-connection',externalId='123';
 const env={REGPILOT_ACCOUNTING_ENABLED:'true',REGPILOT_NANGO_API_KEY:'fictional-bill-broker-key',REGPILOT_NANGO_QUICKBOOKS_INTEGRATION:'bill-fixture'};
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{
  const risk=await createRisk(f.ed,{requestKey:randomUUID(),title:'Example treatment expenditure',description:'A fictional risk for allocating a sample treatment bill.',category:'OPERATIONAL',ownerId:f.ed.userId,likelihood:2,impact:3,ratingRationale:'Example assumptions for this risk.',strategy:'MITIGATE',reviewDueAt:future(),controlIds:[]});
  await db.organization.update({where:{id:f.a.id},data:{accountShortcuts:['quickbooks']}});
  const binding={organizationId:f.a.id,actorId:f.o.userId,entityType:'AccountingConnection',entityId:'quickbooks:'+connectionId};
  await db.auditEvent.create({data:{...binding,action:'workspace.accounting_business_checked',details:{reference:business}}});
  const check={riskId:risk.id,riskVersion:risk.version,requestKey:randomUUID(),provider:'quickbooks',connectionId,business,externalId};
  const selection={month:'2026-01',entities:[{id:f.a.id,annualTreatmentCostGbp:0}],scopeComplete:true,missingSites:[]};
  let issuedOn='2025-12-31',reads=0,unavailable=false;
  const fetcher:typeof fetch=async url=>{
   reads++;if(unavailable)throw Error('provider unavailable');
   const path=new URL(String(url)).pathname;
   if(path==='/connections')return Response.json({connections:[{provider:'quickbooks',provider_config_key:'bill-fixture',connection_id:connectionId,errors:[],tags:{organization_id:f.a.id,regpilot_accounting_provider:'quickbooks'}}]});
   if(path.includes('/companyinfo/'))return Response.json({CompanyInfo:{Id:'1',CompanyName:'Example'}});
   return Response.json({Bill:{Id:path.split('/').pop(),TxnDate:issuedOn,TotalAmt:36.95,CurrencyRef:{value:'GBP'}}});
  };
  await assert.rejects(checkRiskBill(f.ed,check,fetcher),rejects(403));
  await assert.rejects(checkRiskBill(f.out,check,fetcher));assert.equal(reads,0);
  const first=await checkRiskBill(f.o,check,fetcher);
  const calls=reads;assert.deepEqual(await checkRiskBill(f.o,check,fetcher),first);assert.equal(reads,calls);
  const report=()=>groupRiskReport(f.o,{selection});
  const a=await report();assert.equal(a.rows[0].billSample!.priorPence,3695);assert.equal(a.rows[0].billSample!.currentPence,null);
  issuedOn='2026-01-01';
  await checkRiskBill(f.o,{...check,requestKey:randomUUID(),externalId:'124'},fetcher);
  const both=await report();assert.equal(both.rows[0].billSample!.changePence,0);
  await checkRiskBill(f.o,{...check,requestKey:randomUUID()},fetcher);
  const b=await report();assert.equal(b.rows[0].billSample!.priorPence,null);assert.equal(b.rows[0].billSample!.currentPence,7390);assert.equal(b.rows[0].billSample!.lines.length,2);
  await assert.rejects(groupRiskReport(f.o,{selection,approveHash:a.digest}),rejects(409));
  unavailable=true;await checkRiskBill(f.o,{...check,requestKey:randomUUID()},fetcher);
  const c=await report();assert.equal(c.rows[0].billSample!.currentPence,3695);assert.equal(c.rows[0].billSample!.exceptions.length,1);
  await db.riskRecord.update({where:{id:risk.id},data:{version:{increment:1}}});
  assert.equal((await report()).rows[0].billSample!.lines.length,0);
  await db.auditEvent.create({data:{...binding,action:'workspace.accounting_disconnected',details:{}}});
  assert.ok((await report()).rows[0].billSample!.exceptions.every(e=>e.reason.includes('accounting connection')));
 }finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await db.riskRecord.deleteMany({where:{organizationId:f.a.id}});await f.cleanup();}
});
