import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {connectorsEnabled,saveConnector,claimConnector,executeConnector,disconnectConnector,retryConnector,verifyConnectorNow} from "../lib/server/connector-service";
import {operationsWorkspace} from "../lib/server/operations-service";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {POST as configure} from "../app/api/workspace/connectors/route";

test("the setup API, fair worker and manual verification share the same public and tenant-bound collectors",async()=>{
  const f=await assuranceFixture(),original=globalThis.fetch;
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional",
    REGPILOT_CONNECTOR_ENCRYPTION_KEY:"cd".repeat(32),REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_INTUNE_ENABLED:"true",REGPILOT_SCORECARD_ENABLED:"true"});
  const tenantId=randomUUID(),clientId=randomUUID(),secret="fictional-intune-client-secret",sha="3".repeat(40);
  try{
    assert.ok(connectorsEnabled());
    const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:randomUUID(),method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
    const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:"fleet",title:"Managed devices and suppliers",description:"Review endpoint and supplier indicators",testProcedure:"Collect independent reports",theme:"security",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    const common={controlId:control.id,version:0,enabled:true,intervalHours:24,consent:true};
    const record={provider:"OPENSSF_SCORECARD",repository:"Example/Supplier",deployedCommit:sha,...common};
    const authBase=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
    let deviceEncrypted=true;
    globalThis.fetch=async (input,init)=>{
      const url=String(input);
      if(url===authBase+"/auth/v1/user")return Response.json({id:f.owner.externalId,email:f.owner.email,email_confirmed_at:new Date().toISOString(),aud:"authenticated"});
      if(url.startsWith("https://api.scorecard.dev/")){
        assert.equal(new Headers(init?.headers).get("authorization"),null);assert.ok(["https://api.scorecard.dev/projects/github.com/example/supplier","https://api.scorecard.dev/projects/github.com/example/supplier?commit="+sha].includes(url));
        return Response.json({repo:{name:"github.com/example/supplier",commit:sha},date:new Date().toISOString(),scorecard:{version:"v5.7.0"},
          checks:["Code-Review","Security-Policy","Signed-Releases","Pinned-Dependencies"].map(name=>({name,score:10}))});
      }
      if(url.startsWith("https://login.microsoftonline.com/")){assert.equal(new URLSearchParams(String(init?.body)).get("client_secret"),secret);return Response.json({token_type:"bearer",access_token:"fictional-graph-token"});}
      assert.equal(new Headers(init?.headers).get("authorization"),"Bearer fictional-graph-token");
      if(url.includes("/organization?"))return Response.json({value:[{id:tenantId}]});
      assert.equal(new URL(url).pathname,"/v1.0/deviceManagement/managedDevices");
      return Response.json({value:[{id:"not-for-storage",isEncrypted:deviceEncrypted,complianceState:"compliant",lastSyncDateTime:new Date().toISOString()}]});
    };
    const http=await configure(new Request("https://pilot.invalid/api/workspace/connectors",{method:"POST",headers:{
      "Content-Type":"application/json",authorization:"Bearer fictional-supabase-identity-for-test"},body:JSON.stringify({...record,organizationId:f.a.id})}));
    assert.equal(http.status,200);const report=await http.json();
    assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:report.id}})).encryptedSecret,null);
    await assert.rejects(()=>saveConnector(f.o,{...record,token:secret}),rejects(400));
    const job=await claimConnector();assert.equal(job?.id,report.id);assert.equal(await executeConnector(job!),"OBSERVED");
    await disconnectConnector(f.o,report.id,report.version);await assert.rejects(()=>retryConnector(f.o,report.id,report.version+1),rejects(409));assert.equal(await claimConnector(),null);
    const config={...common,provider:"INTUNE",clientId,tenantId,clientSecret:secret};
    await assert.rejects(()=>saveConnector(f.out,config),rejects(404));
    const intune=await saveConnector(f.o,config);
    const stored=await db.evidenceConnector.findUniqueOrThrow({where:{id:intune.id}});
    assert.ok(stored.encryptedSecret&&!stored.encryptedSecret.includes(secret));
    await assert.rejects(()=>saveConnector(f.o,{...config,...intune,tenantId:randomUUID(),clientSecret:undefined}),rejects(400));
    assert.equal((await verifyConnectorNow(f.o,intune.id,intune.version)).outcome,"OBSERVED");
    deviceEncrypted=false;
    await db.evidenceConnector.update({where:{id:intune.id},data:{nextRunAt:new Date(0)}});
    const scheduled=await claimConnector();assert.equal(scheduled?.id,intune.id);assert.equal(await executeConnector(scheduled!),"FOLLOW_UP");
    const ops=await operationsWorkspace(f.o),observed=ops.connectors.find(c=>c.id===intune.id)!;
    assert.equal(ops.features.intune,true);assert.equal(ops.features.scorecard,true);
    assert.ok(observed.changedSincePrevious&&observed.changes.some(c=>c.id==="intune-encryption"&&c.after==="FAIL"));
    assert.doesNotMatch(JSON.stringify(observed),/not-for-storage|fictional-intune-client-secret/);
  }finally{globalThis.fetch=original;await f.cleanup();}
});
