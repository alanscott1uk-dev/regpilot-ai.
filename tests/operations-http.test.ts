import test from "node:test";
import assert from "node:assert/strict";
import {POST as INSPECT} from "../app/api/workspace/evidence/[id]/inspect/route";
import {GET,POST} from "../app/api/workspace/operations/route";
import {GET as CRON} from "../app/api/internal/cron/route";
import {GET as BRIEF} from "../app/api/workspace/briefing/route";
import {GET as CONNECTOR_HEALTH} from "../app/api/workspace/connectors/health/route";
import {POST as VERIFY} from "../app/api/workspace/connectors/[id]/verify/route";
import {POST as PORTFOLIO} from "../app/api/workspace/monitoring/portfolio/route";
import {POST as IMPORT} from "../app/api/workspace/programme/route";
import {POST as CONNECT} from "../app/api/workspace/connectors/route";
import {PATCH as REVIEW} from "../app/api/workspace/programme/[id]/route";
import {POST as AUTOMATE} from "../app/api/internal/automation/route";
const id="123e4567-e89b-42d3-a456-426614174000",body=()=>new Request("https://example.invalid/api/workspace/operations",{method:"POST",body:JSON.stringify({organizationId:id}),headers:{"content-type":"application/json"}});
test("operations endpoints are gated, non-cacheable and authenticate before data access",async()=>{process.env.REGPILOT_WORKSPACE_ENABLED="false";for(const r of [await GET(new Request("https://example.invalid?organizationId="+id)),await POST(body()),await IMPORT(body()),await CONNECT(body()),await REVIEW(body(),{params:Promise.resolve({id})}),await INSPECT(body(),{params:Promise.resolve({id})})]){assert.equal(r.status,503);assert.equal(r.headers.get("cache-control"),"no-store");}Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"fixture@example.invalid"});assert.equal((await GET(new Request("https://example.invalid?organizationId="+id))).status,401);assert.equal((await GET(new Request("https://example.invalid?organizationId=invalid"))).status,400);assert.equal((await CONNECT(body())).status,401);assert.equal((await INSPECT(body(),{params:Promise.resolve({id})})).status,401);const oversized=new Request("https://example.invalid",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:id,value:"a".repeat(5000)})});assert.equal((await POST(oversized)).status,413);});
test("internal automation requires its secret even when inactive",async()=>{process.env.REGPILOT_AUTOMATION_ENABLED="false";delete process.env.REGPILOT_MONITOR_SECRET;assert.equal((await AUTOMATE(new Request("https://example.invalid"))).status,401);process.env.REGPILOT_MONITOR_SECRET="a".repeat(48);assert.equal((await AUTOMATE(new Request("https://example.invalid",{headers:{authorization:"Bearer "+"a".repeat(48)}}))).status,503);});

test("workspace kill switch prevents background work even with automation flags and secret configured",async()=>{Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"false",REGPILOT_AUTOMATION_ENABLED:"true",REGPILOT_CONNECTORS_ENABLED:"true",REGPILOT_CONNECTOR_ENCRYPTION_KEY:"ab".repeat(32),REGPILOT_MONITOR_SECRET:"b".repeat(48)});assert.equal((await AUTOMATE(new Request("https://example.invalid",{headers:{authorization:"Bearer "+"b".repeat(48)}}))).status,503);});

test("production cron and manual verification fail closed before any live provider call",async()=>{
 const secret="r".repeat(48);
 Object.assign(process.env,{CRON_SECRET:secret,REGPILOT_CRON_ENABLED:"false",REGPILOT_AUTOMATION_ENABLED:"false",REGPILOT_WORKSPACE_ENABLED:"false"});
 const request=(auth="")=>new Request("https://example.invalid/api/internal/cron",{headers:auth?{authorization:auth}:{}});
 assert.equal((await BRIEF(new Request("https://example.invalid/api/workspace/briefing?organizationId="+id))).status,503);
 assert.equal((await CONNECTOR_HEALTH(new Request("https://example.invalid/api/workspace/connectors/health?organizationId="+id))).status,503);
 assert.equal((await CRON(request())).status,401);
 assert.equal((await CRON(request("Bearer invalid"))).status,401);
 assert.equal((await CRON(request("Bearer "+secret))).status,503);
 const body=()=>new Request("https://example.invalid/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:id,version:1})});
 assert.equal((await VERIFY(body(),{params:Promise.resolve({id})})).status,503);
 assert.equal((await PORTFOLIO(new Request("https://example.invalid/monitoring/portfolio",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:id,sourceIds:["uk-data-protection"],intervalHours:24,enabled:true})}))).status,503);
});
