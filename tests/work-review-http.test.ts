import test from 'node:test';
import assert from 'node:assert/strict';
import {GET as queue} from '../app/api/workspace/work/reviews/route';
import {GET as detail} from '../app/api/workspace/work/[id]/review/route';
import {POST as followUp} from '../app/api/workspace/work/[id]/review/follow-up/route';
import {POST as verify} from '../app/api/workspace/work/[id]/review/verify/route';
const id='123e4567-e89b-42d3-a456-426614174000',route={params:Promise.resolve({id})};
const get=(org=id)=>new Request('https://example.invalid?organizationId='+org);
const post=(body:unknown,headers={'content-type':'application/json'})=>new Request('https://example.invalid',{method:'POST',headers,body:JSON.stringify(body)});
test('review lifecycle APIs are gated, non-cacheable, bounded and authenticate before database access',async()=>{
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await queue(get()),await detail(get(),route),await followUp(post({organizationId:id}),route),await verify(post({organizationId:id}),route)]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await queue(get('bad'))).status,400);assert.equal((await detail(get(),{params:Promise.resolve({id:'bad'})})).status,400);
 assert.equal((await queue(get())).status,401);assert.equal((await detail(get(),route)).status,401);
 for(const write of [followUp,verify]){
  assert.equal((await write(post({organizationId:id}),route)).status,401);
  assert.equal((await write(post({organizationId:id},{'content-type':'text/plain'}),route)).status,415);
  assert.equal((await write(post({organizationId:id,notes:'£'.repeat(9000)}),route)).status,413);
  assert.equal((await write(post(null),route)).status,400);
  assert.equal((await write(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{invalid'}),route)).status,400);
 }
});
