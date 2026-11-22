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

test('UbiBot checks the exact physical serial, current reading and independent certificate without retaining the channel key',async()=>{
 const provider='UBIBOT',from='2025-01-01',due='2030-01-01',cert='b1d49814-7d05-4bc0-9a76-dde67d9862de',hash='e'.repeat(64);
 const target={scope:'145',record:'WS1-778',reference:[cert,2,from,due,2,8,15].join('/')};
 const at=Math.floor(Date.now()/1000)-60;
 const read=(value:number,stamp:number,serial=target.record,certificate:string|undefined=hash)=>collectOperationalRecord(provider,target,token,async(url,init)=>{
  const source=new URL(String(url));assert.equal(source.hostname,'webapi.ubibot.com');assert.equal(source.searchParams.get('api_key'),token);assert.equal(new Headers(init?.headers).has('authorization'),false);
  return Response.json({result:'success',channels:[{serial,channel_id:145,write_key:'sensitive-return-field',last_values:JSON.stringify({field1:{value,created_at:stamp}})}]});
 },certificate);
 const good=await read(5,at);assert.equal(observationOutcome(good),'OBSERVED');assert.doesNotMatch(JSON.stringify(good),/sensitive-return-field|fictional-connector-token/);
 assert.equal(observationOutcome(await read(9,at)),'FOLLOW_UP');
 assert.equal(observationOutcome(await read(5,at-3600)),'FOLLOW_UP');
 assert.equal(observationOutcome(await read(5,at,target.record,'')),'INCOMPLETE');
 await assert.rejects(read(5,at,'other'),{code:'TARGET_MISMATCH'});
});
test('Benchling links a result to its exact entry and independent named review stage',async()=>{
 const target={scope:'fictional',record:'ar_123',reference:'etr_book/usr_qa'},entry={id:'etr_book',archiveRecord:null,authors:[{id:'usr_writer'}],assignedReviewers:[{id:'usr_qa'}],reviewRecord:{status:'ACCEPTED',reviewChanges:[{id:'change_1',action:'ACCEPT',createdAt:'2025-07-02T09:00:00Z'}],reviewProcesses:[{id:'proc_1',completionStatus:'APPROVED',stages:[{actionLabel:'APPROVE',reviewers:[{id:'usr_qa',status:'FINISHED'}]}]}]}};
 const read=(entryChange:object={},resultChange:object={})=>collectOperationalRecord('BENCHLING',target,token,async url=>{
  const path=new URL(String(url)).pathname;assert.equal(new URL(String(url)).hostname,'fictional.benchling.com');
  return path.includes('/assay-results/')?Response.json({id:'ar_123',entryId:'etr_book',modifiedAt:'2025-07-02T08:00:00Z',isReviewed:true,creator:{id:'usr_writer'},fields:{confidential:'discard-me'},...resultChange}):Response.json({entry:{...entry,...entryChange}});
 });
 const good=await read();assert.equal(observationOutcome(good),'OBSERVED');assert.doesNotMatch(JSON.stringify(good),/discard-me/);
 assert.equal(observationOutcome(await read({},{modifiedAt:'2025-07-02T10:00:00Z'})),'FOLLOW_UP');
 assert.equal(observationOutcome(await read({authors:[{id:'usr_qa'}]})),'FOLLOW_UP');
 assert.equal(observationOutcome(await read({reviewRecord:{status:'IN_PROGRESS'}})),'FOLLOW_UP');
 await assert.rejects(read({},{entryId:'etr_other'}),{code:'TARGET_MISMATCH'});
});
test('managed sync samples respect tenant, provider and connection boundaries, limits, removals and cursor progression',async()=>{
 const {readSync,parseDirectory,workspaceIntegrationId}=await import('../lib/connectors/marketplace');
 const {randomUUID}=await import('node:crypto');const org=randomUUID(),other=randomUUID();
 const source={integration:'regpilot-crm',provider:'example',name:'CRM',models:['Contact'],aiModels:[]},connection='grant-1';
 const row={provider:'example',provider_config_key:source.integration,connection_id:connection,errors:[],tags:{organization_id:org,regpilot_integration:source.integration}};
 const at=new Date().toISOString();
 function simulate(foreign=false,loop=false):typeof fetch{return async(input,init)=>{
  const u=new URL(String(input));assert.equal(u.hostname,'api.nango.dev');
  if(u.pathname==='/connections')return Response.json({connections:[foreign?{...row,tags:{...row.tags,organization_id:other}}:row]});
  assert.equal(u.pathname,'/records');assert.equal(new Headers(init?.headers).get('Connection-Id'),connection);const next=u.searchParams.has('cursor');
  return Response.json({records:[{id:next?'b':'a',private:'secret-text',_nango_metadata:{last_action:next?'DELETED':'UPDATED',last_modified_at:at}}],next_cursor:next&&!loop?null:'next'});
 };}
 const result=await readSync(org,source,connection,'Contact',token,simulate());assert.equal(result.count,2);assert.equal(result.deleted,1);assert.equal(result.limited,false);assert.doesNotMatch(JSON.stringify(result),/secret-text/);
 await assert.rejects(readSync(org,source,connection,'Contact',token,simulate(true)),{code:'TARGET_MISMATCH'});
 await assert.rejects(readSync(org,source,connection,'Contact',token,simulate(false,true)),{code:'INVALID_RESPONSE'});
 await assert.rejects(readSync(org,source,connection,'Private',token,simulate()),{code:'INVALID_TARGET'});
 const id=workspaceIntegrationId(org,'example');assert.notEqual(workspaceIntegrationId(other,'example'),id);
 const target={scope:id+'/a-long-connected-tenant',record:'Contact',reference:'example'},stored=recordKeys('NANGO_SYNC',target);
 assert.deepEqual(readRecordKeys('NANGO_SYNC',stored.repository,stored.branch),target);
 assert.deepEqual(parseDirectory('| `example` | Example | API_KEY | docs | connect | | sales |')[0],{slug:'example',name:'Example',auth:'API_KEY',category:'sales'});
});
test('customer model routes pin the broker and provider, disable provider storage where available, and reject partial output',async()=>{
 const {generateCustomerDraft}=await import('../lib/connectors/customer-model');
 for(const provider of ['openai','anthropic'] as const){
  const account={provider,integration:'regpilot-'+provider,connectionId:'grant-1',key:token,model:'fixture-model'};
  const call=(partial:boolean)=>generateCustomerDraft(account,'instructions','example text',{type:'object'},async(input,init)=>{
   assert.equal(String(input),'https://api.nango.dev/proxy/v1/'+(provider==='openai'?'chat/completions':'messages'));assert.equal(init?.redirect,'error');
   const headers=new Headers(init?.headers),body=JSON.parse(String(init?.body));assert.equal(headers.get('Connection-Id'),'grant-1');assert.equal(body.model,'fixture-model');
   if(provider==='openai'){assert.equal(body.store,false);return Response.json({choices:[{finish_reason:partial?'length':'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:4,completion_tokens:2}});}
   assert.equal(headers.get('Nango-Proxy-anthropic-version'),'2023-06-01');return Response.json({stop_reason:partial?'max_tokens':'end_turn',content:[{type:'text',text:'{"ok":true}'}],usage:{input_tokens:4,output_tokens:2}});
  });
  assert.deepEqual(await call(false),{output:{ok:true},usage:{inputTokens:4,outputTokens:2}});await assert.rejects(call(true),/Incomplete/);
 }
});
