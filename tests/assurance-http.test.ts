import test from "node:test";
import assert from "node:assert/strict";
import {GET,POST} from "../app/api/workspace/assurance/route";
import {PATCH} from "../app/api/workspace/assurance/[id]/route";
test("evidence assessment endpoints are inactive without verified storage and explicit activation",async()=>{
  process.env.REGPILOT_ASSURANCE_ENABLED="false";
  const request=new Request("https://example.invalid/api/workspace/assurance");
  for(const response of [await GET(request),await POST(request),await PATCH(request,{params:Promise.resolve({id:"123e4567-e89b-42d3-a456-426614174000"})})]){assert.equal(response.status,503);assert.equal(response.headers.get("cache-control"),"no-store");}
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_ASSURANCE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"fixture@example.invalid"});
  assert.equal((await GET(request)).status,401,"no auth must be rejected before DB or storage reads");
});
