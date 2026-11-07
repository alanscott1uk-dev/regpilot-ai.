import test from "node:test";
import assert from "node:assert/strict";
import {collectMicrosoft365} from "../lib/connectors/microsoft365";
import {signalChanges,observationOutcome} from "../lib/connectors/observation";
const target={tenantId:"123e4567-e89b-42d3-a456-426614174000",clientId:"123e4567-e89b-42d3-a456-426614174001"},secret="fictional-application-secret";
const endpoint="https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails";
const record=(id:string,overrides:Record<string,unknown>={})=>({id,userType:"member",isAdmin:true,isMfaRegistered:true,isMfaCapable:true,lastUpdatedDateTime:new Date().toISOString(),userDisplayName:"NEVER SAVE ME",userPrincipalName:"never-save@example.invalid",...overrides});
function fixture(options:{tenant?:string;defaults?:unknown;pages?:unknown[];reportStatus?:number;defaultsStatus?:number;authStatus?:number}={}){
 const calls:Array<{url:string;options:RequestInit}>=[];let page=0;
 const fetcher=(async(url:any,init:any)=>{calls.push({url:String(url),options:init});if(String(url).startsWith("https://login.microsoftonline.com/"))return Response.json({access_token:"fictional-access-token",token_type:"Bearer"},{status:options.authStatus||200});if(String(url).includes("/organization?"))return Response.json({value:[{id:options.tenant||target.tenantId}]});if(String(url).includes("/policies/"))return Response.json(options.defaults||{isEnabled:true},{status:options.defaultsStatus||200});return Response.json(options.pages?.[page++]||{value:[record("one")]},{status:options.reportStatus||200});}) as typeof fetch;
 return {calls,fetcher};
}
test("Microsoft connector binds tenant, makes only scoped reads after authentication and retains no personal identifiers or credentials",async()=>{
 const f=fixture(),r=await collectMicrosoft365(target,secret,f.fetcher);assert.equal(observationOutcome(r),"OBSERVED");assert.equal(f.calls.length,4);assert.equal(f.calls[0].options.method,"POST");const form=new URLSearchParams(String(f.calls[0].options.body));assert.equal(form.get("client_id"),target.clientId);assert.equal(form.get("scope"),"https://graph.microsoft.com/.default");for(const call of f.calls.slice(1)){assert.equal(call.options.method,"GET");assert.equal(call.options.redirect,"error");assert.equal(call.options.cache,"no-store");assert.equal(new URL(call.url).origin,"https://graph.microsoft.com");}assert.equal(r.coverage.members,1);assert.doesNotMatch(JSON.stringify(r),/NEVER SAVE ME|never-save|fictional-access-token|fictional-application-secret|"one"/);assert.match(r.limitations.join(" "),/not a compliance verdict/);
});
test("tenant mismatch or rejected credentials abort before report access",async()=>{
 const mismatch=fixture({tenant:target.clientId});await assert.rejects(()=>collectMicrosoft365(target,secret,mismatch.fetcher),(e:any)=>e.code==="TARGET_MISMATCH");assert.equal(mismatch.calls.length,2);
 const bad=fixture({authStatus:400});await assert.rejects(()=>collectMicrosoft365(target,secret,bad.fetcher),(e:any)=>e.code==="CREDENTIAL_REJECTED");assert.equal(bad.calls.length,1);
});
test("missing permissions/licence and disabled defaults are unknown, not fabricated account failures",async()=>{
 const f=fixture({defaults:{isEnabled:false},reportStatus:403}),r=await collectMicrosoft365(target,secret,f.fetcher);assert.ok(r.checks.every(c=>c.status==="UNKNOWN"));assert.equal(r.coverage.complete,false);assert.match(r.checks[0].nextStep,/conditional-access/);assert.equal(observationOutcome(r),"INCOMPLETE");
});
test("pagination is complete before all-account passes; returned gaps create scoped follow-up",async()=>{
 const f=fixture({pages:[{value:[record("one")],"@odata.nextLink":endpoint+"?$skiptoken=next"},{value:[record("two",{isMfaCapable:false,isMfaRegistered:false}),record("guest",{userType:"guest"})]}]}),r=await collectMicrosoft365(target,secret,f.fetcher);assert.equal(r.coverage.records,3);assert.equal(r.coverage.members,2);assert.equal(r.coverage.guests,1);assert.equal(r.coverage.pages,2);assert.equal(observationOutcome(r),"FOLLOW_UP");assert.equal(r.checks.find(c=>c.id==="member-mfa-capability")?.status,"FAIL");
});
for(const link of ["https://evil.invalid/steal","https://graph.microsoft.com@evil.invalid/steal","http://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails","https://graph.microsoft.com/v1.0/users","https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails#x"])
 test("pagination refuses unsafe target "+link,async()=>{const f=fixture({pages:[{value:[record("one")],"@odata.nextLink":link}]});await assert.rejects(()=>collectMicrosoft365(target,secret,f.fetcher),(e:any)=>e.code==="UNSAFE_PAGINATION");assert.equal(f.calls.length,4);});
test("looped, malformed, duplicate or oversized provider results cannot produce observations",async()=>{
 for(const pages of [[{value:[record("one")],"@odata.nextLink":endpoint}],[{value:[record("one"),record("one")]}],[{value:"bad"}],[{value:[record("")]}],[{value:[record("one")],"@odata.nextLink":""}],[{value:[record("one")],"@odata.nextLink":123}],[{value:[record("one")],extra:"x".repeat(1_000_001)}]]){
  const f=fixture({pages});await assert.rejects(()=>collectMicrosoft365(target,secret,f.fetcher));
 }
});
test("stale dates, future dates, unknown fields and empty reports cannot create all-account passes",async()=>{
 for(const rows of [[record("one",{lastUpdatedDateTime:"2020-01-01T00:00:00Z"})],[record("one",{lastUpdatedDateTime:"2099-01-01T00:00:00Z"})],[record("one",{lastUpdatedDateTime:null})],[record("one",{isMfaRegistered:null})],[record("one",{userType:"unknownFutureValue"})],[]]){
  const f=fixture({pages:[{value:rows}]}),r=await collectMicrosoft365(target,secret,f.fetcher);assert.notEqual(observationOutcome(r),"OBSERVED");assert.equal(r.checks.find(c=>c.id==="registration-coverage")?.status,"UNKNOWN");
 }
});
test("bounded pagination returns explicit incomplete coverage without reading arbitrary additional pages",async()=>{
 const pages=Array.from({length:11},(_,i)=>({value:[record("user"+i)],"@odata.nextLink":endpoint+"?$skiptoken="+(i+1)})),f=fixture({pages}),r=await collectMicrosoft365(target,secret,f.fetcher);assert.equal(r.coverage.pages,10);assert.equal(r.coverage.complete,false);assert.equal(r.checks.find(c=>c.id==="member-mfa-registration")?.status,"UNKNOWN");assert.equal(f.calls.length,13);
});
test("change comparison excludes capture timestamps and distinguishes status/value changes",async()=>{
 const f=fixture(),r=await collectMicrosoft365(target,secret,f.fetcher),later={...r,capturedAt:"2099-01-01",checks:r.checks.map(c=>({...c}))};assert.deepEqual(signalChanges(later,r),[]);later.checks[1].status="FAIL";later.checks[1].observed="One returned member needs enrolment";assert.equal(signalChanges(later,r).length,1);assert.equal(signalChanges(later,r)[0].before,"PASS");assert.deepEqual(signalChanges({...later,engine:"another-version"},r),[]);assert.deepEqual(signalChanges(later,null),[]);
});

test("aggregate-byte and record limits prevent unbounded collection or complete-coverage claims",async()=>{
 const pages=Array.from({length:3},(_,i)=>({value:[record("user"+i)],padding:"x".repeat(700_000),"@odata.nextLink":endpoint+"?$skiptoken="+(i+1)}));
 await assert.rejects(()=>collectMicrosoft365(target,secret,fixture({pages}).fetcher),(e:any)=>e.code==="RESPONSE_TOO_LARGE");
 const f=fixture({pages:[{value:Array.from({length:2000},(_,i)=>record("user"+i)),"@odata.nextLink":endpoint+"?$skiptoken=more"}]}),r=await collectMicrosoft365(target,secret,f.fetcher);
 assert.equal(r.coverage.records,2000);assert.equal(r.coverage.complete,false);assert.equal(f.calls.length,4);assert.equal(r.checks.find(c=>c.id==="registration-coverage")?.status,"UNKNOWN");
});
