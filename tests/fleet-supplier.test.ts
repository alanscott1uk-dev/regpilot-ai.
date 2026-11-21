import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {collectIntune} from "../lib/connectors/intune";
import {collectScorecard,scorecardTarget} from "../lib/connectors/scorecard";
import {observationOutcome} from "../lib/connectors/observation";
import {CollectionError} from "../lib/connectors/github";

const now=Date.parse("2026-11-20T12:00:00Z"),target={tenantId:randomUUID(),clientId:randomUUID()};
const token="fictional-graph-access",secret="fictional-graph-secret",graph="https://graph.microsoft.com",path="/v1.0/deviceManagement/managedDevices";
const graphPage=graph+path+"?$skiptoken=bound",json=(value:unknown,status=200)=>Response.json(value,{status});
const failure=(code:string)=>(error:unknown)=>error instanceof CollectionError&&error.code===code;
const device=(patch:Record<string,unknown>={})=>({id:randomUUID(),lastSyncDateTime:"2026-11-20T01:00:00Z",isEncrypted:true,complianceState:"compliant",...patch});
function devices(pages:Response[],tenant=target.tenantId){
  let calls=0;
  const http:typeof fetch=async(url,init)=>{
    calls++;assert.equal(init?.redirect,"error");
    if(calls===1){
      assert.equal(String(url),"https://login.microsoftonline.com/"+target.tenantId+"/oauth2/v2.0/token");
      assert.equal(init?.method,"POST");assert.equal(new URLSearchParams(String(init?.body)).get("client_secret"),secret);
      return json({token_type:"bearer",access_token:token});
    }
    assert.equal(init?.method,"GET");assert.equal(new Headers(init.headers).get("Authorization"),"Bearer "+token);
    if(calls===2){assert.equal(String(url),graph+"/v1.0/organization?$select=id");return json({value:[{id:tenant}]});}
    const requested=new URL(String(url));assert.equal(requested.origin+requested.pathname,graph+path);
    if(calls===3)assert.equal(requested.searchParams.get("$select"),"id,isEncrypted,complianceState,lastSyncDateTime");
    const page=pages.shift();assert.ok(page,"unexpected provider request");return page;
  };
  return {http,calls:()=>calls};
}
const status=(obs:{checks:Array<{id:string;status:string}>},id:string)=>obs.checks.find(c=>c.id===id)?.status;
test("Intune checks bound tenants, follows Graph pages and retains only fleet counts",async()=>{
  const hidden=device({deviceName:"sensitive-device",userPrincipalName:"private@example.invalid"});
  const p=devices([json({value:[hidden],"@odata.nextLink":graphPage}),json({value:[device()]})]);
  const o=await collectIntune(target,secret,p.http,now);
  assert.equal(p.calls(),4);assert.equal(observationOutcome(o),"OBSERVED");assert.match(o.checks[0].observed,/2 confirmed/);
  for(const x of [hidden.id,"sensitive-device","private@example.invalid",secret,token])assert.ok(!JSON.stringify(o).includes(x));
  const foreign=devices([],randomUUID());await assert.rejects(()=>collectIntune(target,secret,foreign.http,now),failure("TARGET_MISMATCH"));assert.equal(foreign.calls(),2);
});
test("stale, missing and future readings cannot establish device encryption or compliance; known exceptions survive partial coverage",async()=>{
  const p=devices([json({value:[device({isEncrypted:false,complianceState:"noncompliant",lastSyncDateTime:"2026-10-01T00:00:00Z"}),
    device({isEncrypted:undefined,complianceState:"inGracePeriod"}),device({lastSyncDateTime:"2027-01-01T00:00:00Z"})]})]);
  const o=await collectIntune(target,secret,p.http,now);
  assert.deepEqual(o.checks.map(c=>c.status),["UNKNOWN","UNKNOWN","FAIL","PASS"]);
  const partial=devices([json({value:Array.from({length:1000},(_,i)=>device(i?{}:{isEncrypted:false})),"@odata.nextLink":graphPage}),
    json({value:Array.from({length:1000},()=>device()),"@odata.nextLink":graphPage+"2"})]);
  const limited=await collectIntune(target,secret,partial.http,now);assert.equal(status(limited,"intune-encryption"),"FAIL");
  assert.equal(status(limited,"intune-compliance"),"UNKNOWN");assert.equal(status(limited,"intune-inventory"),"UNKNOWN");
  assert.ok((await collectIntune(target,secret,devices([json({value:[]})]).http,now)).checks.every(c=>c.status==="UNKNOWN"));
});
test("Intune rejects pagination target changes, ambiguous duplicate devices and missing consent",async()=>{
  for(const url of ["https://other.invalid"+path,graph+"/v1.0/users",graph+path+"?$expand=users",graph+path+"?$select=userPrincipalName"]){
    await assert.rejects(()=>collectIntune(target,secret,devices([json({value:[],"@odata.nextLink":url})]).http,now),failure("UNSAFE_PAGINATION"));
  }
  const d=device();await assert.rejects(()=>collectIntune(target,secret,devices([json({value:[d,d]})]).http,now),failure("INVALID_RESPONSE"));
  await assert.rejects(()=>collectIntune(target,secret,devices([json({},403)]).http,now),failure("ACCESS_OR_RATE_LIMIT"));
});
const repo="supplier/library",base="https://api.scorecard.dev/projects/github.com/"+repo,sha="a".repeat(40),upstream="b".repeat(40);
const scores=(commit=sha,date="2026-11-19")=>({repo:{name:"github.com/"+repo,commit},date,scorecard:{version:"v5.7.0"},
  checks:[{name:"Security-Policy",score:10,details:["supplier private working note"]},{name:"Code-Review",score:6},{name:"Signed-Releases",score:-1}]});
test("Scorecard binds public evidence to the deployed commit and accepts both real provider date formats",async()=>{
  const urls:string[]=[];const http:typeof fetch=async(url,init)=>{
    urls.push(String(url));assert.ok(!new Headers(init?.headers).has("authorization"));assert.equal(init?.redirect,"error");
    return json(String(url)===base?scores(upstream,"2026-11-20T00:00:00Z"):scores(sha));
  };
  const o=await collectScorecard({repository:repo.toUpperCase(),deployedCommit:sha},http,now);
  assert.deepEqual(urls,[base,base+"?commit="+sha]);assert.equal(o.sourceUrl,urls[1]);assert.match(o.checks[0].observed,new RegExp(upstream));
  assert.deepEqual(o.checks.map(c=>c.status),["PASS","PASS","PASS","FAIL","UNKNOWN","UNKNOWN"]);assert.doesNotMatch(JSON.stringify(o),/private working/);
});
test("an unscored deployed version cannot inherit upstream results; stale and missing upstream reports stay unknown",async()=>{
  const o=await collectScorecard({repository:repo,deployedCommit:sha},async url=>String(url)===base?json(scores(upstream)):json({},404),now);
  assert.ok(o.checks.every(c=>c.status==="UNKNOWN"));assert.equal(o.sourceUrl,base+"?commit="+sha);
  for(const response of [json({},404),json(scores(sha,"2025-01-01")),json(scores(sha,"2027-01-01"))]){
    const missing=await collectScorecard({repository:repo},async()=>response,now);assert.ok(missing.checks.every(c=>c.status==="UNKNOWN"));
  }
});
test("Scorecard rejects mismatched repositories and revisions, duplicate scores and URL-like inputs",async()=>{
  for(const invalid of ["https://github.com/org/repo","org/..","org/repo?x=1","org/repo/sub","org/%2e"]){
    assert.equal(scorecardTarget.safeParse({repository:invalid}).success,false);
  }
  await assert.rejects(()=>collectScorecard({repository:repo},async()=>json({...scores(),repo:{name:"github.com/other/repo",commit:sha}}),now),failure("TARGET_MISMATCH"));
  await assert.rejects(()=>collectScorecard({repository:repo,deployedCommit:sha},async()=>json(scores(upstream)),now),failure("TARGET_MISMATCH"));
  await assert.rejects(()=>collectScorecard({repository:repo},async()=>json({...scores(),checks:[...scores().checks,scores().checks[0]]}),now),failure("INVALID_RESPONSE"));
});
