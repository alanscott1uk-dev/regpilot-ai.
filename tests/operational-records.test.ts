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
 const process=entry.reviewRecord.reviewProcesses[0];
 const reviewWith=(p:object)=>({reviewRecord:{...entry.reviewRecord,reviewProcesses:[p]}});
 assert.equal((await read(reviewWith({...process,type:'SELF_REVIEW'}))).checks.find(c=>c.id==='lab-authority')?.status,'FAIL');
 const ambiguous={...process,stages:[{actionLabel:'APPROVE',reviewers:[{id:'usr_qa',status:'FINISHED'},{id:'usr_other',status:'FINISHED'}]}]};
 assert.equal((await read(reviewWith(ambiguous))).checks.find(c=>c.id==='lab-authority')?.status,'UNKNOWN');
 assert.equal(observationOutcome(await read({reviewRecord:{status:'IN_PROGRESS'}})),'FOLLOW_UP');
 await assert.rejects(read({},{entryId:'etr_other'}),{code:'TARGET_MISMATCH'});
});
test('managed sync samples respect tenant, provider and connection boundaries, limits, removals and cursor progression',async()=>{
 const {readSync,parseDirectory,workspaceIntegrationId}=await import('../lib/connectors/marketplace');
 const {randomUUID}=await import('node:crypto');const org=randomUUID(),other=randomUUID();
 const source={integration:'regpilot-crm',provider:'example',name:'CRM',models:[],aiModels:[]},connection='grant-1';
 const row={provider:'example',provider_config_key:source.integration,connection_id:connection,errors:[],tags:{organization_id:org,regpilot_integration:source.integration}};
 const at=new Date().toISOString();
 function simulate(foreign=false,loop=false,stale=false,wrongSync=false):typeof fetch{return async(input,init)=>{
  const u=new URL(String(input));assert.equal(u.hostname,'api.nango.dev');
  if(u.pathname==='/connections')return Response.json({connections:[foreign?{...row,tags:{...row.tags,organization_id:other}}:row]});
  if(u.pathname==='/sync/status'){assert.equal(u.searchParams.get('connection_id'),connection);return Response.json({syncs:[{connection_id:wrongSync?'other':connection,status:'SUCCESS',finishedAt:stale?'2020-01-01T00:00:00Z':at,recordCount:{Contact:2}}]});}
  assert.equal(u.pathname,'/records');assert.equal(new Headers(init?.headers).get('Connection-Id'),connection);const next=u.searchParams.has('cursor');
  return Response.json({records:[{id:next?'b':'a',private:'secret-text',_nango_metadata:{last_action:next?'DELETED':'UPDATED',last_modified_at:at}}],next_cursor:next&&!loop?null:'next'});
 };}
 const result=await readSync(org,source,connection,'Contact',token,simulate());assert.equal(result.syncState,'FRESH');assert.equal(result.count,2);assert.equal(result.deleted,1);assert.equal(result.limited,false);assert.doesNotMatch(JSON.stringify(result),/secret-text/);
 await assert.rejects(readSync(org,source,connection,'Contact',token,simulate(true)),{code:'TARGET_MISMATCH'});
 await assert.rejects(readSync(org,source,connection,'Contact',token,simulate(false,true)),{code:'INVALID_RESPONSE'});
 await assert.rejects(readSync(org,source,connection,'Private',token,simulate()),{code:'INVALID_TARGET'});
 assert.equal((await readSync(org,source,connection,'Contact',token,simulate(false,false,true))).syncState,'STALE');
 await assert.rejects(readSync(org,source,connection,'Contact',token,simulate(false,false,false,true)),{code:'TARGET_MISMATCH'});
 const id=workspaceIntegrationId(org,'example');assert.notEqual(workspaceIntegrationId(other,'example'),id);
 const target={scope:id+'/a-long-connected-tenant',record:'Contact',reference:'example'},stored=recordKeys('NANGO_SYNC',target);
 assert.deepEqual(readRecordKeys('NANGO_SYNC',stored.repository,stored.branch),target);
 const documented=parseDirectory('| `anthropic` | Anthropic | API_KEY | [docs](https://nango.dev/docs/integrations/all/anthropic.md) | | | productivity |');
 assert.equal(documented[0].docs,'https://nango.dev/docs/integrations/all/anthropic');
 assert.equal(parseDirectory('| `example` | Example | API_KEY | [docs](https://foreign.example/provider.md) | | | sales |')[0].docs,undefined);
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

test('private ChatGPT Action exposes the three scoped lookup operations and resolves all schema references',async()=>{
 const {GET}=await import('../app/api/v1/chatgpt/route');
 const doc=await GET(new Request('https://authorised-workspace.example/api/v1/chatgpt')).json();
 assert.deepEqual(doc.servers,[{url:'https://authorised-workspace.example/api/v1'}]);
 assert.deepEqual(Object.keys(doc.paths).sort(),['/controls','/regulatory-sources','/tasks']);
 for(const path of Object.values(doc.paths) as {get:{security:unknown}}[]){
  assert.deepEqual(Object.keys(path),['get']);
  assert.deepEqual(path.get.security,[{customerCredential:[]}]);
 }
 for(const ref of JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g))assert.ok(Object.hasOwn(doc.components.schemas,ref[1]));
});

test('resource controls require distinct mapped fields, typed values and independent current decisions',async()=>{
 const {evaluateResource,resourcePolicy,profileFields,profiles}=await import('../lib/connectors/resource-control');
 assert.equal(Object.values(profiles).reduce((total,profile)=>total+profile.rules.length,0),20);
 const mapping=Object.fromEntries(profileFields('laboratory').map(k=>[k,'decision.'+k]));
 const policy=resourcePolicy.parse({profile:'laboratory',mapping});
 assert.equal(resourcePolicy.safeParse({profile:'laboratory',mapping:{...mapping,reviewerId:mapping.authorId}}).success,false);
 assert.equal(resourcePolicy.safeParse({profile:'laboratory',mapping:{...mapping,reviewerId:'constructor.field'}}).success,false);
 const now=Date.parse('2026-01-15T12:00:00Z'),decision={approved:true,authorisedReviewer:true,authorId:'a',reviewerId:'b',modifiedAt:'2026-01-10T00:00:00Z',decidedAt:'2026-01-12T00:00:00Z'};
 assert.deepEqual(evaluateResource({decision},policy,now),['PASS','PASS','PASS','PASS']);
 assert.deepEqual(evaluateResource({decision:{...decision,authorisedReviewer:'yes',reviewerId:'a',modifiedAt:'2026-01-13T00:00:00Z'}},policy,now),['PASS','UNKNOWN','FAIL','FAIL']);
 assert.deepEqual(evaluateResource({},policy,now),Array(4).fill('UNKNOWN'));
});

test('workflow receipts bind repository, attempt, branch and revision before accepting a job',async()=>{
 const {collectWorkflow}=await import('../lib/connectors/workflow-evidence');
 const target={scope:'owner/repo',record:'ci.yml',reference:'main'},sha='a'.repeat(40);
 const simulate=(options:{foreign?:boolean;jobAttempt?:number;moved?:boolean;skipped?:boolean}={}):typeof fetch=>{
  let branches=0;
  return async input=>{
   const route=new URL(String(input)).pathname,repo={full_name:'owner/repo',id:10};
   if(route.endsWith('/repos/owner/repo'))return Response.json(repo);
   if(route.endsWith('ci.yml'))return Response.json({id:20,path:'.github/workflows/ci.yml',state:'active'});
   if(route.endsWith('branches/main'))return Response.json({name:'main',commit:{sha:++branches===2&&options.moved?'b'.repeat(40):sha}});
   if(route.endsWith('/runs'))return Response.json({total_count:1,workflow_runs:[{id:30,workflow_id:20,head_sha:sha,head_branch:'main',run_attempt:2,repository:repo,head_repository:{id:options.foreign?90:10},status:'completed',conclusion:'success',updated_at:'2026-11-01T08:00:00Z'}]});
   return Response.json({total_count:1,jobs:[{id:40,run_id:30,run_attempt:options.jobAttempt??2,head_sha:sha,status:'completed',conclusion:options.skipped?'skipped':'success'}]});
  };
 };
 const read=(options:Parameters<typeof simulate>[0])=>collectWorkflow(target,token,simulate(options));
 assert.equal((await read({})).checks.find(c=>c.id==='run-1-jobs')?.status,'PASS');
 for(const options of [{skipped:true},{foreign:true}])assert.equal((await read(options)).checks.find(c=>c.id==='run-1-jobs')?.status,'UNKNOWN');
 await assert.rejects(read({jobAttempt:1}),{code:'TARGET_MISMATCH'});
 await assert.rejects(read({moved:true}),{code:'TARGET_MISMATCH'});
});

test('Benchling exchanges a tenant application credential for a new grant on each read and detects a changed assay revision',async()=>{
 const {benchlingCredential}=await import('../lib/connectors/benchling-auth');
 const target={scope:'testlab',record:'ar_sample',reference:'etr_sample/usr_qa'};
 const credential=benchlingCredential('cli_lab',token),date='2026-01-01T08:00:00Z';
 let grants=0,reads=0,move=false;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'testlab.benchling.com');
  if(url.pathname==='/oauth/token'){
   const params=new URLSearchParams(String(init?.body));assert.equal(params.get('client_id'),'cli_lab');assert.equal(params.get('client_secret'),token);
   assert.equal(params.get('grant_type'),'client_credentials');reads=0;grants++;
   return Response.json({token_type:'Bearer',access_token:'temporary-benchling-key-'+grants,expires_in:60});
  }
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer temporary-benchling-key-'+grants);
  if(url.pathname.includes('assay-results'))return Response.json({id:target.record,entryId:'etr_sample',creator:{id:'usr_scientist'},archiveRecord:null,isReviewed:true,modifiedAt:++reads===2&&move?'2026-01-03T08:00:00Z':date});
  return Response.json({id:'etr_sample',archiveRecord:null,authors:[{id:'usr_scientist'}],assignedReviewers:[{id:'usr_qa'}],reviewRecord:{status:'ACCEPTED',reviewChanges:[{id:'review',action:'ACCEPT',createdAt:'2026-01-02T08:00:00Z'}],reviewProcesses:[{id:'process',completionStatus:'APPROVED',stages:[{actionLabel:'APPROVE',reviewers:[{id:'usr_qa',status:'FINISHED'}]}]}]}});
 };
 for(let n=0;n<2;n++){const result=await collectOperationalRecord('BENCHLING',target,credential,fetcher);assert.equal(observationOutcome(result),'OBSERVED');assert.match(result.checks.find(c=>c.id==='lab-decision')!.observed,/e-signature unreported/);assert.doesNotMatch(JSON.stringify(result),/temporary-benchling-key|fictional-connector-token/);}
 assert.equal(grants,2);move=true;await assert.rejects(collectOperationalRecord('BENCHLING',target,credential,fetcher));
});

test('direct OpenAI access pins the project and exact model and discards other returned fields',async()=>{
 const {collectModelAccess}=await import('../lib/connectors/direct-model');
 const target={scope:'proj_staging',record:'requested-model'};
 const result=await collectModelAccess('OPENAI_PROJECT_MODEL',target,token,async(url,init)=>{
  assert.equal(String(url),'https://api.openai.com/v1/models/requested-model');assert.equal(new Headers(init?.headers).get('OpenAI-Project'),target.scope);
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);return Response.json({id:target.record,object:'model',owner:'confidential-identifier'});
 });
 assert.doesNotMatch(JSON.stringify(result),/fictional-connector-token|confidential-identifier/);
 await assert.rejects(collectModelAccess('OPENAI_PROJECT_MODEL',target,token,async()=>Response.json({id:'other-model',object:'model'})),{code:'TARGET_MISMATCH'});
});

test('public pharmaceutical registers bind the exact records and flag material drift and incomplete data',async()=>{
 const {collectPublicRegister,referenceRegisters}=await import('../lib/connectors/pharma-registers');
 const [mapping,trial,recall]=referenceRegisters;
 const id=mapping.target.record,pkgId='2aab7706-8c93-42f6-9f49-39a53cfdaa1c';
 const item={id,name:'BNF_SNOMED_MAPPING_DATA_202609',state:'active',format:'CSV',package_id:pkgId};
 const pkg={id:pkgId,name:mapping.target.scope,state:'active',num_resources:2,resources:[item,{...item,id:'other',name:'BNF_SNOMED_MAPPING_DATA_202610'}]};
 const readMapping=(packageBody:object,resource:object)=>collectPublicRegister(mapping.provider,mapping.target,async(url,init)=>{
  assert.equal(new URL(String(url)).hostname,'opendata.nhsbsa.net');assert.equal(new Headers(init?.headers).has('Authorization'),false);
  return Response.json({success:true,result:String(url).includes('package_show')?packageBody:resource});});
 const signal=(r:{checks:{id:string;status:string}[]},id:string)=>r.checks.find(c=>c.id===id)?.status;
 assert.equal(signal(await readMapping(pkg,item),'mapping-release'),'FAIL');
 assert.equal(signal(await readMapping({...pkg,num_resources:9},item),'mapping-release'),'UNKNOWN');
 for(const other of [{...item,id:'new-release',name:'December mapping revised'},{...item,id:'duplicate-period'},{...item,id:'unknown-state',state:null}]){
  assert.equal(signal(await readMapping({...pkg,resources:[item,other]},item),'mapping-release'),'UNKNOWN');
 }
 await assert.rejects(readMapping(pkg,{...item,package_id:'other'}),{code:'TARGET_MISMATCH'});
 const readTrial=(id:string,status:object)=>collectPublicRegister(trial.provider,trial.target,async()=>Response.json({protocolSection:{identificationModule:{nctId:id},statusModule:status}}));
 const status={overallStatus:'COMPLETED',lastUpdatePostDateStruct:{type:'ACTUAL',date:'2025-10-10'}};
 assert.equal(signal(await readTrial(trial.target.scope,status),'trial-results'),'FAIL');
 assert.equal(signal(await readTrial(trial.target.scope,{...status,resultsFirstPostDateStruct:{type:'ACTUAL',date:'2025-10-09'}}),'trial-results'),'PASS');
 await assert.rejects(readTrial('NCT12345678',status),{code:'TARGET_MISMATCH'});
 const row={recall_number:recall.target.record,event_id:recall.target.scope,product_type:'Drugs',classification:'Class I',status:'Ongoing',recall_initiation_date:'20250101',report_date:'20250120'};
 const readRecall=(total:number,record:object)=>collectPublicRegister(recall.provider,recall.target,async()=>Response.json({meta:{results:{total}},results:[record]}));
 const current=await readRecall(1,row);assert.equal(signal(current,'recall-class'),'FAIL');assert.equal(signal(current,'recall-closure'),'FAIL');
 assert.equal(signal(await readRecall(1,{...row,status:'Terminated',termination_date:'20250230'}),'recall-closure'),'UNKNOWN');
 await assert.rejects(readRecall(2,row),{code:'TARGET_MISMATCH'});await assert.rejects(readRecall(1,{...row,event_id:'other'}),{code:'TARGET_MISMATCH'});
});

test('the public evidence benchmark counts a product once after independent daily receipts and withdraws stale or failed coverage',async()=>{
 const {registerBenchmark}=await import('../lib/connectors/register-benchmark');
 const {referenceRegisters}=await import('../lib/connectors/pharma-registers');
 const source=referenceRegisters[1],now=Date.parse('2026-11-22T18:00:00Z'),day=86400000;
 const row=(offset:number)=>({batch:'capture-'+offset,provider:source.provider,part:'study',started_at:new Date(now-offset),finished_at:new Date(now-offset+1000),http_status:200,intact:true,fingerprint:'receipt',
  url:'https://clinicaltrials.gov/api/v2/studies/'+source.target.scope+'?fields=NCTId,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate',
  metadata:{protocolSection:{identificationModule:{nctId:source.target.scope},statusModule:{overallStatus:'COMPLETED',lastUpdatePostDateStruct:{date:'2026-10-01'}}}}});
 const current=row(2000),prior=row(day+2000);
 assert.equal((await registerBenchmark([current],now)).qualified,0);
 assert.equal((await registerBenchmark([current,row(day)],now)).qualified,0);
 assert.equal((await registerBenchmark([current,row(3*day)],now)).qualified,0);
 const accepted=await registerBenchmark([current,prior,row(day*2+2000)],now);
 assert.equal(accepted.qualified,1);assert.equal(accepted.target,500);
 assert.equal(accepted.products[1].latest?.observation?.checks.find(c=>c.id==='trial-results')?.status,'FAIL');
 for(const change of [{intact:false},{http_status:403},{finished_at:null},{url:'https://example.invalid'},{metadata:{}}]){
  assert.equal((await registerBenchmark([{...current,...change},prior],now)).qualified,0);
 }
 assert.equal((await registerBenchmark([current,prior],now+day+1800001)).qualified,0);
});
