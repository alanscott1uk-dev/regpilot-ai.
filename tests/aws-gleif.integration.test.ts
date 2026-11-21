import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {saveConnector,claimConnector,executeConnector,verifyConnectorNow} from "../lib/server/connector-service";
import {vendorWorkspace,createVendor,changeVendor,vendorDetail,prepareVendorReview} from "../lib/server/vendor-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import {VENDOR_CRITERIA} from "../lib/assurance-workflows";
import {collectAws} from "../lib/connectors/aws";
import {POST as configure} from "../app/api/workspace/connectors/route";
import {GET as lookup} from "../app/api/workspace/connectors/gleif/route";
import {assuranceFixture,future,rejects} from "./helpers/assurance-fixture";
import {awsTransport,accountId,brokerArn} from "./helpers/aws-evidence-fixture";
import {ukRecord,lei,number} from "./helpers/gleif-fixture";

test("GLEIF moves from authorised lookup through the fair worker to an independently reviewed supplier and an owned lapse investigation",async()=>{
  const f=await assuranceFixture(),previous=globalThis.fetch;
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_GLEIF_ENABLED:"true",
    REGPILOT_AWS_ENABLED:"true",REGPILOT_AWS_BROKER_ROLE_ARN:brokerArn,REGPILOT_CONNECTOR_ENCRYPTION_KEY:"dc".repeat(32),SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"});
  try{
    const p=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
    const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:p.id,proposalKey:"suppliers",title:"Supplier and infrastructure assurance",description:"Record verified attributes",testProcedure:"Review current independent evidence",theme:"security",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    const config={controlId:control.id,version:0,consent:true,enabled:true,intervalHours:24};
    const row=ukRecord(),authUrl=(process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.SUPABASE_URL)+"/auth/v1/user";
    globalThis.fetch=async input=>{
      const url=new URL(String(input));
      if(url.href===authUrl)return Response.json({id:f.owner.externalId,email:f.owner.email,email_confirmed_at:new Date().toISOString(),aud:"authenticated"});
      assert.equal(url.origin,"https://api.gleif.org");
      if(url.searchParams.has("filter[entity.registeredAs]"))return Response.json({data:[row],meta:{pagination:{currentPage:1,lastPage:1,total:1}}});
      assert.equal(url.pathname,"/api/v1/lei-records/"+lei);return Response.json({data:row});
    };
    const headers={authorization:"Bearer fictional-supabase-identity-for-test","content-type":"application/json"};
    const lookupUrl="https://pilot.invalid/api/workspace/connectors/gleif?companyNumber="+number+"&organizationId=";
    assert.notEqual((await lookup(new Request(lookupUrl+f.b.id,{headers}))).status,200);
    const found=await lookup(new Request(lookupUrl+f.a.id,{headers}));assert.equal(found.status,200);assert.equal((await found.json()).candidates[0].lei,lei);
    const details={provider:"GLEIF",lei,companyNumber:number,...config};
    const saved=await configure(new Request("https://pilot.invalid/api/workspace/connectors",{method:"POST",headers,body:JSON.stringify({organizationId:f.a.id,...details})}));
    assert.equal(saved.status,200);const id=(await saved.json()).id;
    await assert.rejects(saveConnector(f.o,{...details,token:"unwanted-test-secret"}),rejects(400));
    const input={name:"Fictional bank",service:"Provides a fictional payment service for testing.",ownerId:f.editor.id,criticality:"HIGH",dataAccess:"PERSONAL",systemAccess:true,nextReview:future(30)};
    const vendor=await createVendor(f.o,input),notes="Independently verified the exact legal entity against the approved fictional supplier evidence.";
    await assert.rejects(changeVendor(f.o,vendor.id,{action:"LINK_SIGNAL",version:1,connectorId:id,connectorVersion:2,notes,confirm:true}),rejects(409));
    await changeVendor(f.o,vendor.id,{action:"LINK_SIGNAL",version:1,connectorId:id,connectorVersion:1,notes,confirm:true});
    await assert.rejects(saveConnector(f.o,{...details,id,version:1,companyNumber:"SC045551",lei:"2138005O9XJIJN4JPN90"}),rejects(409));
    const selected=(await vendorWorkspace(f.o)).signalConnections.find(c=>c.id===id);assert.equal(selected?.branch,number);
    const run=async()=>{await db.evidenceConnector.update({where:{id},data:{nextRunAt:new Date(0)}});const job=await claimConnector();assert.equal(job?.id,id);return executeConnector(job!);};
    assert.equal(await run(),"OBSERVED");
    const before=await vendorDetail(f.o,vendor.id),file=await f.file();
    const proposal=await prepareVendorReview(f.o,vendor.id,{version:2,evidenceIds:[file.id],assessment:VENDOR_CRITERIA.map(c=>({id:c.id,outcome:"SUPPORTED",rationale:notes,evidenceIds:[file.id]})),
      recommendation:"APPROVE",rationale:notes,followUpDue:future(14),validUntil:future(90),signalRunId:before.signal!.snapshot!.runId,signalReviewed:true});
    const acceptance={action:"ACCEPT",reviewId:proposal.id,version:1,notes,confirm:true};
    await assert.rejects(changeVendor(f.o,vendor.id,acceptance,f.store),rejects(403));await changeVendor(f.ad,vendor.id,acceptance,f.store);
    assert.equal((await vendorDetail(f.o,vendor.id)).reviewState,"CURRENT");
    row.attributes.registration.status="LAPSED";assert.equal(await run(),"FOLLOW_UP");assert.equal(await run(),"FOLLOW_UP");
    const after=await vendorDetail(f.o,vendor.id);assert.equal(after.reviewState,"STALE");assert.ok(after.signalChanges.some(c=>c.id==="lei-issued"));
    assert.equal(await db.obligation.count({where:{organizationId:f.a.id,vendorSignalId:vendor.id,assigneeId:f.editor.id,status:"OPEN"}}),1);
    row.attributes.entity.registeredAs="00010000";assert.equal(await run(),"RETRY_SCHEDULED");assert.equal((await vendorDetail(f.o,vendor.id)).signal!.current,false);
    const oldCount=await db.connectorRun.count({where:{connectorId:id}});assert.equal(oldCount,3);
    const cloud=await saveConnector(f.o,{...config,provider:"AWS",accountId,region:"eu-west-2"});
    await assert.rejects(saveConnector(f.o,{...config,provider:"AWS",accountId,region:"eu-west-2",roleArn:brokerArn}),rejects(400));
    assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:cloud.id}})).encryptedSecret,null);
    const ops=await operationsWorkspace(f.o);assert.ok(ops.features.aws&&ops.features.gleif);assert.equal(ops.awsBrokerArn,brokerArn);
    assert.equal((await operationsWorkspace(f.ed)).awsBrokerArn,null);
    const monitor=awsTransport(f.a.id);
    const checked=await verifyConnectorNow(f.o,cloud.id,cloud.version,async(target,secret)=>{
      assert.equal(target.organizationId,f.a.id);assert.equal(target.repository,"aws:"+accountId);assert.equal(secret,"");
      return collectAws({accountId:target.repository.slice(4),region:target.branch},target.organizationId!,monitor.runtime);
    });
    assert.equal(checked.outcome,"OBSERVED");assert.equal(await db.connectorRun.count({where:{connectorId:cloud.id}}),1);
    await assert.rejects(verifyConnectorNow(f.out,cloud.id,cloud.version),rejects(404));
    await assert.rejects(changeVendor(f.o,vendor.id,{action:"LINK_SIGNAL",version:2,connectorId:cloud.id,notes,confirm:true}),rejects(404));
    process.env.REGPILOT_GLEIF_ENABLED="false";
    assert.equal((await lookup(new Request(lookupUrl+f.a.id,{headers}))).status,503);
  }finally{globalThis.fetch=previous;await f.cleanup();}
});
