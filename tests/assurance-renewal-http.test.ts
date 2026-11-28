import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workspace/assurance/[id]/renew/route';
const id='123e4567-e89b-42d3-a456-426614174000',route={params:Promise.resolve({id})};
const request=()=>new Request('https://example.invalid/api/workspace/assurance/'+id+'/renew?organizationId='+id);
const post=(body:unknown,headers={'content-type':'application/json'})=>new Request(request(),{method:'POST',headers,body:JSON.stringify(body)});
test('renewal endpoints are disabled by default, never cache private checks and require identity before database or original file access',async()=>{
 process.env.REGPILOT_ASSURANCE_ENABLED='false';
 for(const response of [await GET(request(),route),await POST(post({organizationId:id}),route)]){
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_ASSURANCE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(request(),route)).status,401);
 assert.equal((await POST(post({organizationId:id,version:2}),route)).status,401);
 assert.equal((await GET(new Request('https://example.invalid?organizationId=bad'),route)).status,400);
 assert.equal((await GET(request(),{params:Promise.resolve({id:'bad'})})).status,400);
 assert.equal((await POST(post({organizationId:'bad'}),route)).status,400);
 assert.equal((await POST(post({organizationId:id}),{params:Promise.resolve({id:'bad'})})).status,400);
 assert.equal((await POST(post({organizationId:id},{'content-type':'text/plain'}),route)).status,415);
 assert.equal((await POST(post({organizationId:id,notes:'£'.repeat(5000)}),route)).status,413,'bound actual UTF-8 request bytes');
 assert.equal((await POST(post(null),route)).status,400);
 assert.equal((await POST(new Request(request(),{method:'POST',headers:{'content-type':'application/json'},body:'{broken'}),route)).status,400);
});
