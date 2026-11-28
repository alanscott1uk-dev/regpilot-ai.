import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workspace/work/route';
const id='123e4567-e89b-42d3-a456-426614174000';
const post=(body:unknown,headers={'content-type':'application/json'})=>new Request('https://example.invalid/api/workspace/work',{method:'POST',headers,body:JSON.stringify(body)});
test('work hub is gated, non-cacheable and requires verified identity before database access',async()=>{
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(new Request('https://example.invalid?organizationId='+id)),await POST(post({organizationId:id,operation:'preview'}))]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(new Request('https://example.invalid?organizationId=bad'))).status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId='+id))).status,401);
 assert.equal((await GET(new Request('https://example.invalid?organizationId='+id+'&taskId='+id))).status,401);
 for(const operation of ['preview','apply','start','create'])assert.equal((await POST(post({organizationId:id,operation}))).status,401);
 assert.equal((await POST(post({organizationId:id,operation:'complete'}))).status,400);
 assert.equal((await POST(post({organizationId:id},{'content-type':'text/plain'}))).status,415);
 assert.equal((await POST(post({organizationId:id,operation:'preview',data:'£'.repeat(9000)}))).status,413);
 assert.equal((await POST(post(null))).status,400);
 const invalid=new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'});
 assert.equal((await POST(invalid)).status,400);
});
