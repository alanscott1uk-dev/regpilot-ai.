import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workspace/automations/route';
import {executeScheduledTick} from '../lib/cron-tick.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
test('automation health and replay authenticate before database access and never cache responses',async()=>{
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'false'});
 const read=()=>new Request('https://example.invalid?organizationId='+id);
 const write=()=>new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id,id,version:1})});
 for(const response of [await GET(read()),await POST(write())]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(read())).status,401);assert.equal((await POST(write())).status,401);
 assert.equal((await GET(new Request('https://example.invalid?organizationId=invalid'))).status,400);
});
test('automation dead letters degrade worker health while healthy collection results remain intact',async()=>{
 const result=await executeScheduledTick({sources:async()=>({processed:12}),connectors:async()=>({processed:4}),automations:async()=>({processed:3,attention:1})});
 assert.equal(result.ok,false);assert.equal(result.modules.automations?.state,'attention');assert.equal(result.modules.connectors.processed,4);assert.equal(result.modules.sources.processed,12);
});
