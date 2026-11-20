import {connectorRecovery} from "../lib/connectors/recovery";
import test from "node:test";
import assert from "node:assert/strict";
import {collectGithub,connectorOutcome,githubTarget} from "../lib/connectors/github";
import {encryptConnectorSecret,decryptConnectorSecret} from "../lib/server/connector-secret";
const target={repository:"example/fixture.",branch:"release/one"},token="fixture-not-a-real-token";
const rules=[{type:"pull_request",parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true}},{type:"required_status_checks",parameters:{required_status_checks:[{context:"ci"}]}},{type:"non_fast_forward"},{type:"deletion"},{type:"required_signatures"}];
function fetcher(protection:unknown,status=200){const requests:{url:string;options:RequestInit}[]=[];return {requests,fetch:(async(url:any,options:any)=>{const path=String(url);requests.push({url:path,options});if(path.endsWith("/fixture."))return Response.json({full_name:target.repository,private:true,owner:{email:"must-not-be-retained@example.invalid"}});if(path.endsWith("/branches/release%2Fone"))return Response.json({name:target.branch});if(path.includes("/rules/"))return Response.json(rules,{status});if(path.endsWith("/actions/permissions/workflow"))return Response.json({default_workflow_permissions:"read",can_approve_pull_request_reviews:false},{status});return Response.json(protection,{status});}) as typeof fetch};}
test("GitHub adapter makes only scoped read requests and retains selected settings",async()=>{const f=fetcher({required_pull_request_reviews:{required_approving_review_count:2},enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},sensitive:{anything:"must-not-be-retained"}});const r=await collectGithub(target,token,f.fetch);assert.equal(connectorOutcome(r),"OBSERVED");assert.equal(f.requests.length,5);assert.equal(f.requests[2].url,"https://api.github.com/repos/example/fixture./branches/release%2Fone/protection");for(const req of f.requests){assert.equal(req.options.method,"GET");assert.equal(req.options.redirect,"error");assert.equal(req.options.cache,"no-store");assert.equal((req.options.headers as any).Authorization,"Bearer "+token);}assert.doesNotMatch(JSON.stringify(r),/must-not-be-retained|fixture-not-a-real-token/);assert.match(r.limitations.join(" "),/not evaluated/);});
test("missing protection is unknown rather than an invented failure or pass",async()=>{const f=fetcher({},404),r=await collectGithub(target,token,f.fetch);assert.equal(connectorOutcome(r),"INCOMPLETE");assert.ok(r.checks.every(c=>c.status==="UNKNOWN"));assert.match(r.limitations.join(" "),/cannot distinguish/);});
test("explicit risky settings produce follow-up, not a compliance verdict",async()=>{const f=fetcher({required_pull_request_reviews:null,enforce_admins:{enabled:false},allow_force_pushes:{enabled:true}}),r=await collectGithub(target,token,f.fetch);assert.equal(connectorOutcome(r),"FOLLOW_UP");assert.ok(r.checks.slice(0,3).every(c=>c.status==="FAIL"));});
for(const status of [401,403,429,500])test("provider "+status+" fails without storing response text",async()=>{await assert.rejects(()=>collectGithub(target,token,(async()=>new Response("private-provider-error",{status})) as typeof fetch),(e:any)=>!e.message.includes("private-provider-error")&&!!e.code);});
test("provider JSON, size and target mismatch are checked",async()=>{for(const response of [new Response("not-json"),new Response("x".repeat(65537)),Response.json({full_name:"other/repository"})])await assert.rejects(()=>collectGithub(target,token,(async()=>response) as typeof fetch));});
test("connector targets cannot select arbitrary hosts or traversal paths",()=>{for(const repository of ["https://evil.invalid/x","../repo","owner/..","owner/repo?x=y","owner/repo/extra"])assert.equal(githubTarget.safeParse({...target,repository}).success,false);for(const branch of ["../main","x?token=y","x#y"])assert.equal(githubTarget.safeParse({...target,branch}).success,false);});
test("encrypted credentials are authenticated, randomised and bound to organisation and row",()=>{process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY="ab".repeat(32);const a=encryptConnectorSecret(token,"org-a","connector-a"),b=encryptConnectorSecret(token,"org-a","connector-a");assert.notEqual(a,b);assert.doesNotMatch(a,/fixture-not-a-real-token/);assert.equal(decryptConnectorSecret(a,"org-a","connector-a"),token);assert.throws(()=>decryptConnectorSecret(a,"org-b","connector-a"));assert.throws(()=>decryptConnectorSecret(a,"org-a","connector-b"));const parts=a.split(".");parts[3]=Buffer.from("tampered").toString("base64");assert.throws(()=>decryptConnectorSecret(parts.join("."),"org-a","connector-a"));process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY="invalid";assert.throws(()=>encryptConnectorSecret(token,"org-a","connector-a"));});

test("connector recovery separates temporary failures from credential, permission and unknown failures",()=>{
 for(const code of ["PROVIDER_TIMEOUT","PROVIDER_UNAVAILABLE","COLLECTION_FAILED","INTERRUPTED_REPEATEDLY"])
  assert.equal(connectorRecovery(code).retryable,true);
 for(const code of [null,"CREDENTIAL_REJECTED","PERMISSION_REVOKED","RATE_LIMITED","TARGET_MISMATCH","ACCESS_OR_RATE_LIMIT","UNRECOGNISED_CODE"])
  assert.equal(connectorRecovery(code).retryable,false);
 assert.match(connectorRecovery("CREDENTIAL_REJECTED").message,/credential/);
 assert.match(connectorRecovery("RATE_LIMITED").message,/scheduled retry/);
});

import {reconcileObservation,signalChanges,observationCurrent,observationOutcome,type Observation} from '../lib/connectors/observation';
const observation:Observation={engine:'fixture-v1',sourceUrl:'https://example.invalid/settings',capturedAt:'2026-11-15T00:00:00Z',checks:[{id:'access',label:'Access',status:'PASS',observed:'Restricted',nextStep:'Review scope'},{id:'review',label:'Review',status:'PASS',observed:'Required',nextStep:'Review scope'}],limitations:['Point-in-time configuration only']};
test('disappearing signals stay unknown across repeated partial reads and recover only when returned',()=>{
 const partial={...observation,checks:observation.checks.slice(0,1)};
 const reconciled=reconcileObservation(partial,observation);
 assert.equal(observationOutcome(reconciled),'INCOMPLETE');
 assert.equal(reconciled.checks[1].status,'UNKNOWN');assert.match(reconciled.checks[1].observed,/Not returned/);
 assert.deepEqual(reconcileObservation(partial,reconciled),reconciled);
 assert.equal(signalChanges(reconciled,observation)[0].id,'review');
 assert.equal(signalChanges(partial,observation)[0].after,'UNKNOWN');
 assert.equal(observationOutcome(reconcileObservation(observation,reconciled)),'OBSERVED');
 assert.equal(signalChanges(observation,reconciled)[0].after,'PASS');
});
test('new signals and engine changes require review without comparing incompatible engines',()=>{
 assert.equal(signalChanges(observation,{...observation,checks:observation.checks.slice(0,1)})[0].before,'NOT_OBSERVED');
 const upgraded={...observation,engine:'fixture-v2',checks:observation.checks.slice(0,1)};
 assert.equal(signalChanges(upgraded,observation)[0].id,'collector-engine');
 assert.equal(reconcileObservation(upgraded,observation).checks.length,1);
 assert.deepEqual(signalChanges(observation,null),[]);
});
test('malformed or ambiguous collector observations cannot become evidence',()=>{
 for(const bad of [{...observation,checks:[observation.checks[0],observation.checks[0]]},{...observation,checks:[{...observation.checks[0],status:'MAYBE'}]},{...observation,sourceUrl:'http://example.invalid'}, {...observation,checks:Array.from({length:201},(_,i)=>({...observation.checks[0],id:String(i)}))}])assert.throws(()=>reconcileObservation(bad as Observation,null));
});
test('connected evidence expires at the exact interval and rejects future or invalid captures',()=>{
 const now=Date.parse('2026-11-15T12:00:00Z'),connector={version:1,enabled:true,failureCode:null,intervalHours:24};
 for(const age of [-1,86400000,86400001,NaN])assert.equal(observationCurrent({configVersion:1,capturedAt:new Date(now-age)},connector,true,now),false);
 assert.equal(observationCurrent({configVersion:1,capturedAt:new Date(now-86399999)},connector,true,now),true);
 assert.equal(observationCurrent({configVersion:1,capturedAt:new Date(now)}, {...connector,intervalHours:168},true,now),true);
});

import {verifiedObservation} from '../lib/server/connector-observation';
import {hashValue} from '../lib/regulatory/intelligence';
test('stored evidence requires a valid shape, unique checks and matching outcome and signal hash',()=>{
 const run={result:observation,resultHash:hashValue(observation),signalHash:hashValue({engine:observation.engine,checks:observation.checks}),outcome:'OBSERVED'};
 assert.deepEqual(verifiedObservation(run),observation);
 for(const patch of [{outcome:'FOLLOW_UP'},{signalHash:'0'.repeat(64)},{resultHash:'0'.repeat(64)}])assert.equal(verifiedObservation({...run,...patch}),null);
 const duplicate={...observation,checks:[observation.checks[0],observation.checks[0]]};
 assert.equal(verifiedObservation({...run,result:duplicate,resultHash:hashValue(duplicate),signalHash:hashValue({engine:duplicate.engine,checks:duplicate.checks})}),null);
});

test('compiled OPA control decisions require distinct providers, expose failures and withhold incomplete evidence',async()=>{
 const {evaluateControlPolicy}=await import('../lib/server/control-policy');
 const {readFile}=await import('node:fs/promises'),{createHash,randomUUID}=await import('node:crypto');
 const manifest=JSON.parse(await readFile('lib/policies/connected-control.json','utf8'));
 assert.equal(createHash('sha256').update(await readFile('lib/policies/connected-control.rego')).digest('hex'),manifest.sourceSha256);
 const first={connectorId:randomUUID(),provider:'GITHUB',status:'OBSERVED' as const},second={...first,connectorId:randomUUID()};
 const request={observations:[first,second],minimumProviders:2,limited:false};
 assert.equal((await evaluateControlPolicy(request)).state,'BELOW_TARGET');
 assert.equal((await evaluateControlPolicy({...request,observations:[first,{...second,provider:'MICROSOFT365'}]})).state,'MEETS_TARGET');
 assert.equal((await evaluateControlPolicy({...request,observations:[]})).state,'INSUFFICIENT_EVIDENCE');
 assert.equal((await evaluateControlPolicy({...request,limited:true})).state,'INSUFFICIENT_EVIDENCE');
 assert.deepEqual((await evaluateControlPolicy({...request,observations:[{...first,status:'UNKNOWN'}]})).unverifiedConnections,[first.connectorId]);
 const failure=await evaluateControlPolicy({...request,limited:true,observations:[{...first,status:'FAILED'}]});
 assert.equal(failure.state,'FINDINGS');assert.deepEqual(failure.failingConnections,[first.connectorId]);
});
