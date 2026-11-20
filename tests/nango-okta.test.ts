import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {collectOkta,oktaConnectSession,oktaConnections,findOktaGroups} from "../lib/connectors/nango-okta";
import {signalChanges} from "../lib/connectors/observation";
import {groupUrl,member,mockOkta,oktaConfig,target} from "./helpers/okta-fixture";
import {GET,POST} from "../app/api/workspace/connectors/okta/route";
const org=randomUUID(),actor=randomUUID();
const errorCode=(code:string)=>(e:{code?:string})=>e.code===code;

test("hosted Okta authorisation sends only server-bound identifiers and accepts an expiring Nango link",async()=>{
  const expiresAt=new Date(Date.now()+29*60000).toISOString(),link="https://connect.nango.dev/?session_token=fictional";
  const session=await oktaConnectSession(org,actor,oktaConfig,async(input,init)=>{
    assert.equal(input,"https://api.nango.dev/connect/sessions");assert.equal(init?.method,"POST");
    assert.deepEqual(JSON.parse(String(init?.body)),{allowed_integrations:["okta-pilot"],tags:{organization_id:org,end_user_id:actor}});
    return Response.json({data:{connect_link:link,expires_at:expiresAt,token:"never-return-this-field"}});
  });
  assert.deepEqual(session,{link,expiresAt});
  for(const [url,expires] of [["https://example.invalid/?token=x",expiresAt],[link,"2020-01-01T00:00:00Z"]])
    await assert.rejects(()=>oktaConnectSession(org,actor,oktaConfig,async()=>Response.json({data:{connect_link:url,expires_at:expires}})));
});
test("connection selection checks exact integration, workspace tag, provider and credential health before any proxy reads",async()=>{
  const wrongOrg=randomUUID();
  for (const change of [{provider:"other"},{provider_config_key:"other"},{tags:{organization_id:wrongOrg}},{errors:[{type:"auth"}]},{connection_id:"another"}]) {
    let calls=0;
    const fetcher:typeof fetch=async input=>{
      const url=new URL(String(input));assert.equal(url.pathname,"/connections");calls++;
      assert.equal(url.searchParams.get("connectionId"),target.connectionId);assert.equal(url.searchParams.get("tags[organization_id]"),org);
      return Response.json({connections:[{connection_id:target.connectionId,provider:"okta",provider_config_key:"okta-pilot",errors:[],tags:{organization_id:org},...change}]});
    };
    await assert.rejects(()=>collectOkta(target,org,oktaConfig,fetcher),errorCode("TARGET_MISMATCH"));assert.equal(calls,1);
  }
  assert.deepEqual(await oktaConnections(wrongOrg,oktaConfig,mockOkta(org,[[]])),[]);
  await assert.rejects(()=>collectOkta({...target,groupId:"../other"},org,oktaConfig,async()=>assert.fail()));
});
test("paginated collection detects inactive grants, access removal and same-count membership changes without retaining profiles",async()=>{
  const removed={...member(9,"DEPROVISIONED"),id:target.removedUserId!};
  const read=(pages:ReturnType<typeof member>[][])=>collectOkta(target,org,oktaConfig,mockOkta(org,pages));
  const bad=await read([[member(1)],[removed]]);
  assert.deepEqual(bad.checks.map(c=>c.status),["PASS","FAIL","FAIL"]);
  const good=await read([[member(2)],[member(1)]]);
  assert.deepEqual(good.checks.map(c=>c.status),["PASS","PASS","PASS"]);
  assert.deepEqual(signalChanges(good,bad).map(c=>c.id),["group-coverage","inactive-grants","revoked-grant"]);
  assert.deepEqual(signalChanges(good,await read([[member(1),member(2)]])),[]);
  assert.deepEqual(signalChanges(good,await read([[member(1),member(3)]] )).map(c=>c.id),["group-coverage"]);
  assert.doesNotMatch(JSON.stringify([bad,good]),/private@example|PRIVATE GROUP|PRIVATE DIRECTORY|Directory-With-Case|fictional-nango-environment-key/);
  assert.ok(!JSON.stringify(bad).includes(removed.id));
  const unknown=await read([[member(1,"NEW_UPSTREAM_STATUS")]]);assert.equal(unknown.checks[1].status,"UNKNOWN");
});
test("partial and bounded inventories cannot confirm absence and positive findings survive incomplete coverage",async()=>{
  const partial=await collectOkta(target,org,oktaConfig,mockOkta(org,[[]],u=>u.pathname.endsWith("/users")?Response.json([{id:target.removedUserId,status:"SUSPENDED"}]):undefined));
  assert.deepEqual(partial.checks.map(c=>c.status),["UNKNOWN","FAIL","FAIL"]);
  const bounded=await collectOkta(target,org,oktaConfig,mockOkta(org,Array.from({length:9},(_,i)=>[member(i)])));
  assert.deepEqual(bounded.checks.map(c=>c.status),["UNKNOWN","UNKNOWN","UNKNOWN"]);
  const empty=await collectOkta(target,org,oktaConfig,mockOkta(org,[[]]));
  assert.deepEqual(empty.checks.map(c=>c.status),["PASS","PASS","PASS"]);
});
test("malformed page chains, mismatched identity and provider errors cannot create a successful receipt",async()=>{
  const malformed=[['<https://untrusted.invalid/api/v1/groups/'+target.groupId+'/users?after=next>; rel="next"',"TARGET_MISMATCH"],
    ['<'+groupUrl+'/members?after=next>; rel="next"',"TARGET_MISMATCH"],['<'+groupUrl+'/users?after=abc&after=other>; rel="next"',"INVALID_RESPONSE"],
    ['<'+groupUrl+'/users?after=same>; rel="next"',"INVALID_RESPONSE"]];
  for(const [link,code] of malformed) await assert.rejects(()=>collectOkta(target,org,oktaConfig,
    mockOkta(org,[[]],u=>u.pathname.endsWith("/users")?Response.json([],{headers:{link}}):undefined)),errorCode(code));
  for(const resource of ["/groups/"+target.groupId,"/users/"+target.removedUserId])
    await assert.rejects(()=>collectOkta(target,org,oktaConfig,mockOkta(org,[[]],u=>u.pathname.endsWith(resource)?Response.json({id:"other"}):undefined)),errorCode("TARGET_MISMATCH"));
  await assert.rejects(()=>collectOkta(target,org,oktaConfig,mockOkta(org,[[member(1)],[member(1)]])),errorCode("INVALID_RESPONSE"));
  for(const [status,code] of [[401,"CREDENTIAL_REJECTED"],[403,"ACCESS_OR_RATE_LIMIT"],[429,"RATE_LIMITED"]] as const)
    await assert.rejects(()=>collectOkta(target,org,oktaConfig,mockOkta(org,[[]],u=>u.pathname.endsWith("/users")?new Response(null,{status,headers:status===429?{"retry-after":"120"}:{}}):undefined)),errorCode(code));
});
test("Okta directory and hosted-session routes fail closed before calling Nango in a disabled workspace",async()=>{
  process.env.REGPILOT_WORKSPACE_ENABLED="false";
  const route="http://localhost/api/workspace/connectors/okta";
  assert.equal((await GET(new Request(route+"?organizationId="+org))).status,503);
  assert.equal((await POST(new Request(route,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:org})}))).status,503);
});

test("group search passes a bounded literal query to the authorised directory and returns only IDs and display names",async()=>{
  const query="Team & Finance",name="Team & Finance Managers";
  const fetcher=mockOkta(org,[],u=>{
    if (u.pathname!=="/proxy/api/v1/groups") return;
    assert.equal(u.searchParams.get("q"),query);assert.equal(u.searchParams.get("limit"),"20");
    return Response.json([{id:target.groupId,profile:{name,description:"PRIVATE DETAILS"},_embedded:{users:["PRIVATE USER"]}}]);
  });
  assert.deepEqual(await findOktaGroups(org,target.connectionId,query,oktaConfig,fetcher),[{id:target.groupId,name}]);
  await assert.rejects(()=>findOktaGroups(randomUUID(),target.connectionId,query,oktaConfig,fetcher),errorCode("TARGET_MISMATCH"));
  await assert.rejects(()=>findOktaGroups(org,target.connectionId,"x",oktaConfig,async()=>assert.fail()));
});
