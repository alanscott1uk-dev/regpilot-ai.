import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workspace/work/[id]/completion/route';
const id='123e4567-e89b-42d3-a456-426614174000',route={params:Promise.resolve({id})};
const post=(body:unknown,headers={'content-type':'application/json'})=>new Request('https://example.invalid/api/workspace/work/'+id+'/completion',{method:'POST',headers,body:JSON.stringify(body)});

test('completion endpoints fail closed, bound JSON bytes and require verified identity before database access',async()=>{
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(new Request('https://example.invalid?organizationId='+id),route),await POST(post({organizationId:id}),route)]){
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(new Request('https://example.invalid?organizationId=bad'),route)).status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId='+id),{params:Promise.resolve({id:'bad'})})).status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId='+id),route)).status,401);
 assert.equal((await POST(post({organizationId:id,confirm:true}),route)).status,401);
 assert.equal((await POST(post({organizationId:id},{'content-type':'text/plain'}),route)).status,415);
 assert.equal((await POST(post({organizationId:id,notes:'£'.repeat(9000)}),route)).status,413,'bound actual UTF-8 bytes, not string characters');
 assert.equal((await POST(post(null),route)).status,400);
 assert.equal((await POST(post({organizationId:'bad'}),route)).status,400);
 assert.equal((await POST(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'}),route)).status,400);
});
