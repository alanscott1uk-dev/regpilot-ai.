import test from "node:test";
import assert from "node:assert/strict";
import {readBody} from "../lib/server/intelligence-http";
import {GET,POST} from "../app/api/workspace/intelligence/route";
test("intelligence boundary enforces streamed byte limit and JSON object schema",async()=>{
  const request=(body:string,contentType="application/json")=>new Request("https://example.invalid/api/workspace/intelligence",{method:"POST",headers:{"Content-Type":contentType},body});
  await assert.rejects(()=>readBody(request("{}","text/plain")),(e:any)=>e.status===415);
  await assert.rejects(()=>readBody(request("null")),(e:any)=>e.status===400);
  await assert.rejects(()=>readBody(request("[]")),(e:any)=>e.status===400);
  await assert.rejects(()=>readBody(request(JSON.stringify({content:"x".repeat(4100)}))),(e:any)=>e.status===413);
  assert.deepEqual(await readBody(request('{"version":1}')),{version:1});
});
test("intelligence routes fail closed before accessing a database or model",async()=>{
  process.env.REGPILOT_WORKSPACE_ENABLED="false";
  assert.equal((await GET(new Request("https://example.invalid/api/workspace/intelligence"))).status,503);
  assert.equal((await POST(new Request("https://example.invalid/api/workspace/intelligence",{method:"POST",body:"{}"}))).status,503);
  process.env.REGPILOT_WORKSPACE_ENABLED="true";
  process.env.REGPILOT_AI_ALLOWED_EMAILS="fixture@example.invalid";
  process.env.DATABASE_URL="postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.SUPABASE_URL="https://fixture.invalid";
  process.env.SUPABASE_PUBLISHABLE_KEY="fixture-only";
  const response=await GET(new Request("https://example.invalid/api/workspace/intelligence?organizationId=123e4567-e89b-42d3-a456-426614174000"));
  assert.equal(response.status,401,"an absent session must be rejected before any provider call");
});
