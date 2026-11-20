import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {accountingIds,type AccountingId} from "../lib/accounting-software";
import {accountingGrants,checkAccountingBusiness,disconnectAccountingGrant,startAccountingConsent} from "../lib/connectors/accounting-oauth";
import {GET,POST} from "../app/api/workspace/accounting-software/route";

const org=randomUUID(),actor=randomUUID(),tenant=randomUUID(),realm="1234567890",grant="fixture-grant";
const config={key:"fictional-accounting-test-key",integration:"uk-accounts"};
const row=(provider:AccountingId)=>({provider,provider_config_key:config.integration,connection_id:grant,errors:[],
  tags:{organization_id:org,regpilot_accounting_provider:provider}});

test("all four hosted consents are confined to the selected workspace, actor and single provider",async()=>{
  for(const provider of accountingIds){
    const result=await startAccountingConsent(org,actor,provider,config,async(input,init)=>{
      assert.equal(input,"https://api.nango.dev/connect/sessions");assert.equal(init?.redirect,"error");
      assert.deepEqual(JSON.parse(String(init?.body)),{allowed_integrations:[config.integration],tags:{regpilot_accounting_provider:provider,organization_id:org,end_user_id:actor}});
      return Response.json({data:{connect_link:"https://connect.nango.dev/?session_token=fixture",expires_at:new Date(Date.now()+60000).toISOString()}});
    });
    assert.equal(new URL(result.link).hostname,"connect.nango.dev");
  }
});
test("accounting verification reads only the named business and returns its name and reference",async()=>{
  const cases:[AccountingId,string,string,unknown][]=[
    ["xero",tenant,"/connections",[{tenantId:randomUUID(),tenantType:"ORGANISATION",tenantName:"Other"},{tenantId:tenant,tenantType:"ORGANISATION",tenantName:"Fixture Ltd"}]],
    ["quickbooks",realm,"/v3/company/"+realm+"/companyinfo/"+realm,{CompanyInfo:{Id:"1",CompanyName:"Fixture Ltd",Email:{Address:"private@example.invalid"}}}],
    ["sage","f00ab1","/v3.1/businesses/f00ab1",{id:"f00ab1",displayed_as:"Fixture Ltd"}],
    ["freeagent","fictional","/v2/company",{company:{subdomain:"fictional",name:"Fixture Ltd",email:"private@example.invalid"}}]
  ];
  for(const [provider,ref,path,body] of cases){
    let calls=0;
    const proof=await checkAccountingBusiness(org,provider,grant,ref,config,async(input,init)=>{
      calls++;const url=new URL(String(input));assert.equal(url.origin,"https://api.nango.dev");
      if(url.pathname==="/connections"){assert.equal(url.searchParams.get("connectionId"),grant);return Response.json({connections:[row(provider)]});}
      assert.equal(url.pathname,"/proxy"+path);assert.equal(init?.method||"GET","GET");
      assert.equal(new Headers(init?.headers).get("Connection-Id"),grant);return Response.json(body);
    });
    assert.deepEqual(proof,{name:"Fixture Ltd",reference:ref});assert.equal(calls,2);
  }
});
test("grant checks, provider reads and disconnects reject foreign, untagged, stale and mismatched identities",async()=>{
  const valid=row("sage"),bad=[
    {...valid,tags:{...valid.tags,organization_id:randomUUID()}},{...valid,tags:{organization_id:org}},
    {...valid,provider:"quickbooks"},{...valid,provider_config_key:"unrelated"},{...valid,connection_id:"unrelated"}
  ];
  for(const invalid of bad){
    const fetcher:typeof fetch=async(input,init)=>{assert.equal(new URL(String(input)).pathname,"/connections");assert.notEqual(init?.method,"DELETE");return Response.json({connections:[invalid]});};
    await assert.rejects(checkAccountingBusiness(org,"sage",grant,"fixture",config,fetcher),{code:"TARGET_MISMATCH"});
    await disconnectAccountingGrant(org,"sage",grant,config,fetcher);
  }
  const badGrant:typeof fetch=async()=>Response.json({connections:[{...valid,errors:[{type:"auth"}]}]});
  assert.deepEqual(await accountingGrants(org,"sage",config,badGrant),[{id:grant,state:"needs_attention"}]);
  await assert.rejects(checkAccountingBusiness(org,"sage",grant,"fixture",config,badGrant),{code:"TARGET_MISMATCH"});
  const wrongBusiness:typeof fetch=async input=>new URL(String(input)).pathname==="/connections"?Response.json({connections:[valid]}):Response.json({id:"other",name:"Other Ltd"});
  await assert.rejects(checkAccountingBusiness(org,"sage",grant,"expected",config,wrongBusiness),{code:"TARGET_MISMATCH"});
  await assert.rejects(checkAccountingBusiness(org,"sage",grant,"../bad",config,async()=>{assert.fail("invalid reference made a request");}));
  let deletes=0;
  await disconnectAccountingGrant(org,"sage",grant,config,async(input,init)=>{
    const u=new URL(String(input));
    if(u.pathname==="/connections")return Response.json({connections:[valid]});
    assert.equal(u.pathname,"/connections/"+grant);assert.equal(u.searchParams.get("provider_config_key"),config.integration);
    assert.equal(init?.method,"DELETE");deletes++;return new Response(null,{status:204});
  });
  assert.equal(deletes,1);
});
test("the accounting endpoints enforce private workspace configuration and bounded JSON requests",async()=>{
  delete process.env.REGPILOT_WORKSPACE_ENABLED;
  assert.equal((await GET(new Request("http://localhost/api/workspace/accounting-software?organizationId="+org))).status,503);
  assert.equal((await POST(new Request("http://localhost/api/workspace/accounting-software",{method:"POST",headers:{"content-type":"application/json"},body:" ".repeat(2049)}))).status,413);
});
