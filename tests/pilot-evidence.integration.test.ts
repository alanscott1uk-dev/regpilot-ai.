import {createHmac} from "node:crypto";
import {configureConnectorWebhook,receiveConnectorWebhook} from "../lib/server/connector-webhooks";
import assert from "node:assert/strict";
import test from "node:test";
import {db} from "../lib/server/db";
import {saveConnector,claimConnector,executeConnector} from "../lib/server/connector-service";
import {getConnectorHealth} from "../lib/server/connector-health-service";
import {changeObligationStatus} from "../lib/server/obligation-service";
import {testConnectedControl} from "../lib/server/control-policy";
import {researchWorkspaceQuestion} from "../lib/server/company-knowledge-service";
import {createVendor,changeVendor,prepareVendorReview,vendorDetail,exportVendorReview} from "../lib/server/vendor-service";
import {VENDOR_CRITERIA} from "../lib/assurance-workflows";
import {assuranceFixture,rejects,future} from "./helpers/assurance-fixture";
import {leaver,credentials,workforceTransport} from "./helpers/workforce-fixture";
import {number,lei,ukRecord} from "./helpers/gleif-fixture";

function enable(){
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_WORKFORCE_ENABLED:"true",REGPILOT_WEBHOOKS_ENABLED:"true",REGPILOT_GLEIF_ENABLED:"true",REGPILOT_COMPANIES_HOUSE_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"ac".repeat(32),
    REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_ASSURANCE_ENABLED:"true",SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"test-only",SUPABASE_SECRET_KEY:"test-only",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture"});
}
async function newControl(f:Awaited<ReturnType<typeof assuranceFixture>>,title:string){
  const p=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.owner.id,inputHash:f.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
  return db.managedControl.create({data:{organizationId:f.a.id,importId:p.id,proposalKey:"pilot",title,description:"Pilot source evidence",testProcedure:"Check current evidence",theme:"security",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
}
async function scheduled(id:string){
  await db.evidenceConnector.update({where:{id},data:{nextRunAt:new Date(0)}});
  const row=await claimConnector();assert.equal(row?.id,id);return executeConnector(row!);
}
const official=async()=>({status:"no_match" as const,catalogueSize:0,nations:[],checked:[],unavailable:0,citations:[],answer:{points:[],model:null}});
const rationale="Checked the actual scope, source evidence and history for this fictional pilot case.";

test("two scheduled collections, revoked access, recovery and replay preserve one verified leaver follow-up within its organisation",async()=>{
  const f=await assuranceFixture(),transport=workforceTransport(),original=globalThis.fetch;
  try{
    enable();globalThis.fetch=transport.fetcher;
    const control=await newControl(f,"Staff offboarding"),params={controlId:control.id,minimumProviders:1};
    const config={provider:"WORKFORCE_LEAVER",...leaver,controlId:control.id,credentials,consent:true,enabled:true,version:0,intervalHours:24};
    const {id,version}=await saveConnector(f.o,config);
    assert.equal(await scheduled(id),"FOLLOW_UP");assert.equal(await scheduled(id),"FOLLOW_UP");
    const tasks=await db.obligation.findMany({where:{connectorId:id}});assert.equal(tasks.length,1);assert.equal(tasks[0].assigneeId,f.editor.id);
    await assert.rejects(changeObligationStatus(f.o,tasks[0].id,"COMPLETE",{completionRationale:rationale}),rejects(409));
    assert.equal((await testConnectedControl(f.o,params)).decision.state,"FINDINGS");
    const answer=await researchWorkspaceQuestion(f.o,{question:"Is the leaver still active in Jira and Microsoft?"},official);
    assert.equal(answer.connections[0].runId,(await getConnectorHealth(f.o)).items[0].runId);
    assert.deepEqual([...new Set(answer.connections[0].findings.map(c=>new URL(c.sourceUrl!).host))].sort(),["graph.microsoft.com","sample-employer.bamboohr.com","sample-it.atlassian.net"]);
    assert.equal(answer.connections[0].openTasks[0].id,tasks[0].id);assert.equal(answer.connections[0].owner,f.editor.email);
    assert.deepEqual((await researchWorkspaceQuestion(f.out,{question:"Staff offboarding"},official)).connections,[]);
    transport.state.revoked=true;assert.equal(await scheduled(id),"ATTENTION");
    assert.equal((await getConnectorHealth(f.o)).items[0].status,"revoked");assert.equal((await testConnectedControl(f.o,params)).decision.state,"INSUFFICIENT_EVIDENCE");
    transport.state.revoked=false;
    await saveConnector(f.o,{...config,id,version});
    transport.state.partial=true;assert.equal(await scheduled(id),"INCOMPLETE");assert.equal((await getConnectorHealth(f.o)).items[0].status,"incomplete");
    transport.state.partial=false;transport.state.enabled=false;assert.equal(await scheduled(id),"OBSERVED");assert.equal(await scheduled(id),"OBSERVED");
    assert.equal((await testConnectedControl(f.o,params)).decision.state,"MEETS_TARGET");
    assert.equal((await db.obligation.findUniqueOrThrow({where:{id:tasks[0].id}})).status,"COMPLETE");
    const audits=await db.auditEvent.findMany({where:{organizationId:f.a.id,entityId:tasks[0].id,action:"connector.leaver_verified"}});assert.equal(audits.length,1);
    const health=(await getConnectorHealth(f.o)).items[0];assert.equal(health.status,"observed");assert.ok(health.history.some(e=>e.code==="CREDENTIAL_REJECTED"));assert.ok(health.expiresAt);
    await assert.rejects(saveConnector(f.o,{...config,id,version:2,employeeId:"43"}),rejects(409));
    transport.state.enabled=true;assert.equal(await scheduled(id),"FOLLOW_UP");assert.equal(await db.obligation.count({where:{connectorId:id,status:"OPEN"}}),1);
  }finally{globalThis.fetch=original;await f.cleanup();}
});

test("signed BambooHR events schedule one recheck for the configured company and employee",async()=>{
  const f=await assuranceFixture(),transport=workforceTransport(),original=globalThis.fetch;
  try{
    enable();globalThis.fetch=transport.fetcher;
    const control=await newControl(f,"Leaver event verification");
    const settings={provider:"WORKFORCE_LEAVER",...leaver,controlId:control.id,credentials,consent:true,enabled:true,version:0,intervalHours:24};
    const {id}=await saveConnector(f.o,{...settings,bambooCompanyId:undefined});
    await saveConnector(f.o,{...settings,id,version:1});
    const secret="fictional-bamboo-webhook-signing-key";
    const configured=await configureConnectorWebhook(f.o,id,{version:2,enabled:true,secret});
    assert.equal(configured.secret,null);assert.ok(configured.callbackPath.endsWith("/bamboohr/"+id));
    await scheduled(id);
    const send=(companyId="17",employeeId="42",key=secret,epoch=Math.floor(Date.now()/1000))=>{
      const body=JSON.stringify({type:"employee.updated",data:{companyId,employeeId}}),stamp=String(epoch);
      const signature=createHmac("sha256",key).update(body).update(stamp).digest("hex");
      const request=new Request("https://pilot.invalid"+configured.callbackPath,{method:"POST",body,headers:{"content-type":"application/json","x-bamboohr-timestamp":stamp,"x-bamboohr-signature":signature}});
      return receiveConnectorWebhook(request,"WORKFORCE_LEAVER",id);
    };
    await assert.rejects(send("18"),rejects(403));await assert.rejects(send("17","42","wrong-signing-key"),rejects(401));
    await assert.rejects(send("17","42",secret,1_000_000_000),rejects(401));
    assert.ok((await send("17","43")).ignored);
    assert.equal((await send()).duplicate,false);assert.equal((await send()).duplicate,true);
    const pending=await db.evidenceConnector.findUniqueOrThrow({where:{id}});
    assert.equal(pending.eventRevision,1);assert.equal(pending.collectedEventRevision,0);
    assert.equal(await db.webhookReceipt.count({where:{connectorId:id}}),1);
    assert.ok((await getConnectorHealth(f.o)).items[0].status!=="observed");
    transport.state.enabled=false;assert.equal(await scheduled(id),"OBSERVED");
    assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id}})).collectedEventRevision,1);
    assert.equal(await db.obligation.count({where:{connectorId:id,status:"OPEN"}}),0);
    await assert.rejects(configureConnectorWebhook(f.out,id,{version:3,enabled:false}),rejects(409));
  }finally{globalThis.fetch=original;await f.cleanup();}
});

test("an independent quality reviewer can accept the exact UK premises against both registers; site changes and missing evidence invalidate the decision",async()=>{
  const f=await assuranceFixture(),original=globalThis.fetch;
  try{
    enable();let inactive=false;const control=await newControl(f,"UK supplier site checks"),config={controlId:control.id,version:0,consent:true,enabled:true,intervalHours:24};
    globalThis.fetch=async input=>{
      const url=new URL(String(input));
      if(url.host==="api.gleif.org")return Response.json({data:ukRecord()});
      assert.equal(url.host,"api.company-information.service.gov.uk");return Response.json({company_number:number,company_name:"Fixture Bank",company_status:inactive?"dissolved":"active",has_insolvency_history:false,accounts:{next_accounts:{overdue:false}},confirmation_statement:{overdue:false}});
    };
    const main=await saveConnector(f.o,{...config,provider:"GLEIF",lei,companyNumber:number});assert.equal(await scheduled(main.id),"OBSERVED");
    const ch=await saveConnector(f.o,{...config,provider:"COMPANIES_HOUSE",companyNumber:number,token:"fictional-companies-key"});assert.equal(await scheduled(ch.id),"OBSERVED");
    const v=await createVendor(f.o,{name:"Fixture Bank",service:"Provides secure fictional supplies for this trial.",ownerId:f.editor.id,criticality:"LOW",dataAccess:"NONE",systemAccess:false,nextReview:future(60)});
    await changeVendor(f.o,v.id,{action:"LINK_SIGNAL",version:1,connectorId:main.id,notes:rationale,confirm:true});
    const scope={number:"12345",companyNumber:number,activity:"Holding",requiredAnnexEntries:["3.3"],premises:"Unit 2, High Street, Glasgow G1 1XX",reviewerId:f.admin.id};
    await changeVendor(f.o,v.id,{action:"SET_LICENCE_SCOPE",version:2,scope});
    const file=await f.file(),record={state:"LISTED",source:"https://cms.mhra.gov.uk/mhra/wda/uk-wdah-12345",number:"12345",holder:"Fixture Bank",premises:scope.premises,activities:["Holding"],annexEntries:["3.3"],conditions:"Fictional site annex reviewed.",checkedOn:future(0),reviewBy:future(25),evidenceId:file.id};
    const imp=(version:number,value:unknown)=>changeVendor(f.o,v.id,{action:"IMPORT_LICENCE",version,record:value});
    const review=(version:number,runId:string)=>prepareVendorReview(f.o,v.id,{version,evidenceIds:[file.id],assessment:VENDOR_CRITERIA.map(c=>({id:c.id,outcome:"SUPPORTED",rationale,evidenceIds:[file.id]})),recommendation:"APPROVE",rationale,followUpDue:future(7),validUntil:future(20),signalRunId:runId,signalReviewed:true});
    await imp(3,{...record,annexEntries:[],premises:"Unit 3, High Street, Glasgow G1 1XX"});
    const wrong=await vendorDetail(f.o,v.id);assert.ok(wrong.licence?.reasons.some(r=>r.includes("premises")));assert.equal(wrong.signalTasks.filter(t=>t.status==="OPEN").length,1);
    assert.ok(wrong.licence?.reasons.some(r=>r.includes("Cold chain")));
    assert.equal(wrong.signalTasks[0].ownerName,f.editor.email);
    await assert.rejects(review(4,wrong.signal!.snapshot!.runId),rejects(409));
    await imp(4,record);
    const exact=await vendorDetail(f.o,v.id);assert.deepEqual(exact.licence?.reasons,[]);assert.equal(exact.licence?.identities.length,2);
    await changeVendor(f.o,v.id,{action:"SET_LICENCE_SCOPE",version:5,scope});assert.equal((await vendorDetail(f.o,v.id)).vendor.version,5);
    const draft=await review(5,exact.signal!.snapshot!.runId),sign={action:"ACCEPT",reviewId:draft.id,version:1,notes:rationale,confirm:true};
    await assert.rejects(changeVendor(f.o,v.id,sign,f.store),rejects(403));await changeVendor(f.ad,v.id,sign,f.store);
    assert.equal((await vendorDetail(f.ad,v.id)).reviewState,"CURRENT");assert.equal((await exportVendorReview(f.ad,v.id,f.store)).reviewId,draft.id);
    await assert.rejects(vendorDetail(f.out,v.id),rejects(404));
    const q={question:"MHRA WDA 12345 supplier",asset:"Unit 2"};
    assert.equal((await researchWorkspaceQuestion(f.ad,q,official)).suppliers[0].reviewState,"CURRENT");assert.deepEqual((await researchWorkspaceQuestion(f.out,q,official)).suppliers,[]);
    const cold=await researchWorkspaceQuestion(f.ad,{question:"Cold chain",asset:"Unit 2"},official);
    assert.deepEqual(cold.suppliers[0].requiredEntries,[{code:"3.3",label:"Cold chain products"}]);
    assert.deepEqual((await researchWorkspaceQuestion(f.ad,{...q,asset:"Unit 20"},official)).suppliers,[]);
    inactive=true;await scheduled(ch.id);await scheduled(ch.id);
    const changed=await vendorDetail(f.o,v.id);
    assert.equal(changed.signalTasks.filter(t=>t.status==="OPEN").length,1);assert.equal(changed.signalTasks[0].ownerName,f.editor.email);
    assert.equal((await vendorDetail(f.o,v.id)).reviewState,"STALE");
    await imp(5,{state:"UNAVAILABLE",source:"https://cms.mhra.gov.uk/mhra",checkedOn:future(0),reason:"The official source was unavailable for this site."});
    const after=await vendorDetail(f.ad,v.id);assert.ok(after.licence?.reasons.some(r=>r.includes("retrieve")));assert.equal(after.signalTasks.filter(t=>t.status==="OPEN").length,1);assert.equal(after.licenceHistory.length,4);
    assert.ok(after.reviews.some(r=>r.id===draft.id&&!r.contextCurrent));await assert.rejects(exportVendorReview(f.ad,v.id,f.store),rejects(409));
  }finally{globalThis.fetch=original;await f.cleanup();}
});
