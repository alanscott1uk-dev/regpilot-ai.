import test from "node:test";
import assert from "node:assert/strict";
import {POST as tick} from "../app/api/internal/monitor/route";
import {POST as semantic} from "../app/api/workspace/intelligence/semantic/route";
import {PUT as configure} from "../app/api/workspace/intelligence/monitoring/route";
import {validMonitorSecret} from "../lib/server/monitoring-service";
import {semanticConfigured} from "../lib/server/semantic-service";
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
  delete process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED;assert.equal(semanticConfigured(),false);
  assert.equal((await semantic(request())).status,503);
});
test("worker authentication rejects absent, short, malformed and overlong bearer secrets",()=>{
  process.env.REGPILOT_MONITOR_SECRET="short";assert.equal(validMonitorSecret(request("Bearer short")),false);
  const secret="f".repeat(40);process.env.REGPILOT_MONITOR_SECRET=secret;
  for(const value of ["",secret,"bearer "+secret,"Bearer "+secret+"a","Bearer "+"f".repeat(500)])assert.equal(validMonitorSecret(request(value)),false);
  assert.equal(validMonitorSecret(request("Bearer "+secret)),true);
});
