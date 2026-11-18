import test from "node:test";
import assert from "node:assert/strict";
import {POST as tick} from "../app/api/internal/monitor/route";
import {POST as semantic} from "../app/api/workspace/intelligence/semantic/route";
import {PUT as configure} from "../app/api/workspace/intelligence/monitoring/route";
import {validMonitorSecret} from "../lib/server/monitoring-service";
import {aiConfigured} from "../lib/server/ai-auth";
import {semanticConfigured} from "../lib/server/semantic-service";
import {POST as retrySource} from '../app/api/workspace/monitoring/retry/route';
import {GET as cron} from '../app/api/internal/cron/route';
const request=(token="")=>new Request("https://example.invalid/api/internal/monitor",{method:"POST",headers:{authorization:token}});
test("worker and semantic routes fail closed without contacting providers or database",async()=>{
  process.env.REGPILOT_WORKSPACE_ENABLED="false";
  assert.equal((await tick(request())).status,503);assert.equal((await semantic(request())).status,503);assert.equal((await configure(request())).status,503);
  process.env.REGPILOT_WORKSPACE_ENABLED="true";process.env.DATABASE_URL="postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.SUPABASE_URL="https://example.invalid";process.env.SUPABASE_PUBLISHABLE_KEY="fixture";process.env.REGPILOT_AI_ALLOWED_EMAILS="test@example.invalid";
  process.env.REGPILOT_MONITORING_ENABLED="true";
  process.env.REGPILOT_MONITOR_SECRET="x".repeat(40);
  const unauthenticated=await tick(request("Bearer wrong"));assert.equal(unauthenticated.status,401);assert.equal(unauthenticated.headers.get("cache-control"),"no-store");
  process.env.REGPILOT_AI_ENABLED="true";process.env.REGPILOT_AI_MODEL="test/fictional";process.env.AI_GATEWAY_API_KEY="not-a-real-key";process.env.REGPILOT_SEMANTIC_ENABLED="true";
  delete process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED;assert.equal(semanticConfigured(),false);assert.equal(aiConfigured(),false,"all paid AI paths require the safeguards attestation");
  assert.equal((await semantic(request())).status,503);
});
test("worker authentication rejects absent, short, malformed and overlong bearer secrets",()=>{
  process.env.REGPILOT_MONITOR_SECRET="short";assert.equal(validMonitorSecret(request("Bearer short")),false);
  const secret="f".repeat(40);process.env.REGPILOT_MONITOR_SECRET=secret;
  for(const value of ["",secret,"bearer "+secret,"Bearer "+secret+"a","Bearer "+"f".repeat(500)])assert.equal(validMonitorSecret(request(value)),false);
  assert.equal(validMonitorSecret(request("Bearer "+secret)),true);
});
test('source recovery API requires a configured workspace and an authenticated administrator',async()=>{
 const saved={...process.env};
 const make=(body:unknown)=>new Request('https://example.invalid/api/workspace/monitoring/retry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const body={organizationId:'00000000-0000-4000-8000-000000000001',sourceId:'uk-data-protection',version:1};
 try{
  process.env.REGPILOT_WORKSPACE_ENABLED='false';
  const disabled=await retrySource(make(body));assert.equal(disabled.status,503);assert.equal(disabled.headers.get('cache-control'),'no-store');
  process.env.REGPILOT_WORKSPACE_ENABLED='true';
  assert.equal((await retrySource(make(body))).status,401,'no bearer token means no database mutation');
  assert.equal((await retrySource(new Request('https://example.invalid/api/workspace/monitoring/retry',{method:'POST',body:'not json'}))).status,415);
  assert.equal((await retrySource(make({...body,organizationId:'foreign'}))).status,400);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('cron requires its strong machine secret and every runtime gate before accessing the database',async()=>{
 const saved={...process.env},secret='c'.repeat(40);
 const make=(token='')=>new Request('https://example.invalid/api/internal/cron',{headers:{authorization:token}});
 try{
  Object.assign(process.env,{CRON_SECRET:secret,REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AUTOMATION_ENABLED:'true',REGPILOT_CRON_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused'});
  assert.equal((await cron(make())).status,401);assert.equal((await cron(make('Bearer wrong'))).status,401);
  for(const gate of ['REGPILOT_WORKSPACE_ENABLED','REGPILOT_AUTOMATION_ENABLED','REGPILOT_CRON_ENABLED']){
   process.env[gate]='false';const r=await cron(make('Bearer '+secret));assert.equal(r.status,503,gate);assert.equal(r.headers.get('cache-control'),'no-store');process.env[gate]='true';
  }
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
