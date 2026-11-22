import test from "node:test";
import assert from "node:assert/strict";
import {collectOperationalRecord, readRecordKeys, recordKeys} from "../lib/connectors/operational-records";
import {observationOutcome, observationSchema, signalChanges} from "../lib/connectors/observation";
import {records, token, cloud} from "./helpers/operational-record-fixtures";

for (const row of records) {
  test(row.provider + " binds source identity and compares current observations", async () => {
    const {provider,target} = row;
    const fetchRecord = (body: object): typeof fetch => async (url, options) => {
      assert.equal(String(url), row.url);
      assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error");
      const expected = provider === "AZURE_DEVOPS" ? "Basic " + Buffer.from(":" + token).toString("base64") : "Bearer " + token;
      assert.equal(new Headers(options?.headers).get("Authorization"), expected);
      return Response.json({...body, privateText:"never-retain"});
    };
    const keys = recordKeys(provider,target);
    assert.deepEqual(readRecordKeys(provider,keys.repository,keys.branch), target);
    const pass = await collectOperationalRecord(provider,target,token,fetchRecord(row.good));
    assert.equal(observationOutcome(observationSchema.parse(pass)), "OBSERVED");
    assert.doesNotMatch(JSON.stringify(pass), /never-retain|private-owner|fictional-connector-token/);
    const changed = await collectOperationalRecord(provider,target,token,fetchRecord(row.changed));
    assert.equal(observationOutcome(changed), "FOLLOW_UP");
    assert.ok(signalChanges(changed,pass).some(c => c.id === row.changedCheck && c.after === "FAIL"));
    await assert.rejects(collectOperationalRecord(provider,target,token,fetchRecord(row.wrong)), {code:"TARGET_MISMATCH"});
    await assert.rejects(collectOperationalRecord(provider,{...target,scope:"https://other.invalid/"},token,async()=>{assert.fail("invalid origin reached fetch");}), {code:"INVALID_TARGET"});
    await assert.rejects(collectOperationalRecord(provider,target,token,async()=>new Response(null,{status:401})), {code:"CREDENTIAL_REJECTED"});
  });
}
test("unreadable and incomplete records cannot pass their checks", async () => {
  const incomplete = [
    {key:"QA-13",fields:{project:{key:"QA"},assignee:{},resolution:{}}},
    {result:{sys_id:records[1].target.record,closed_at:"unparseable"}},
    {id:93,project:{id:cloud},status:"inProgress",result:"succeeded"},
    {id:"842",version:{number:-1}},
    {audit_id:"audit_cde",template_id:"template_abc",audit_data:{date_completed:"2099-01-01T00:00:00Z"}}
  ];
  for (const [i,row] of records.entries()) {
    const result = await collectOperationalRecord(row.provider,row.target,token,async()=>Response.json(incomplete[i]));
    assert.ok(result.checks.every(c=>c.status==="UNKNOWN"),row.provider);
  }
});
