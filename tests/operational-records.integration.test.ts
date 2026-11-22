import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";
import {saveConnector,verifyConnectorNow,exportConnectorRun} from "../lib/server/connector-service";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {records,token} from "./helpers/operational-record-fixtures";

test("five operational sources can be configured, collected and exported within one workspace", async () => {
  const f = await assuranceFixture(), original = globalThis.fetch;
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"dc".repeat(32),SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"});
  try {
    const programme = await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:"SEARCH",status:"ACCEPTED",evidenceManifest:[]}});
    const control = await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:"evidence",title:"Operational evidence",description:"Review the source records",testProcedure:"Compare against the expected record",theme:"quality",ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
    for (const row of records) {
      const flag = "REGPILOT_"+row.provider+"_ENABLED";
      const input = {provider:row.provider,...row.target,controlId:control.id,version:0,consent:true,enabled:true,intervalHours:24,token};
      process.env[flag]="false";
      await assert.rejects(saveConnector(f.o,input),rejects(503));
      process.env[flag]="true";
      await assert.rejects(saveConnector(f.out,input),rejects(404));
      const saved = await saveConnector(f.o,input);
      globalThis.fetch=async url => {assert.equal(String(url),row.url);return Response.json(row.changed);};
      const observed = await verifyConnectorNow(f.o,saved.id,saved.version);
      assert.equal(observed.outcome,"FOLLOW_UP",row.provider);
      const run = await db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id}});
      const exported = await exportConnectorRun(f.o,run.id);
      assert.equal(exported.currentAtExport,true);
      await assert.rejects(exportConnectorRun(f.out,run.id),rejects(404));
      assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:"COMPLETE"}}}),1);
    }
  } finally {globalThis.fetch=original;await f.cleanup();}
});
