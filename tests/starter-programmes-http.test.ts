import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/programmes/route';
test('starter programmes require private workspace identity and bounded explicit operations',async()=>{
 const org=randomUUID(),record=randomUUID(),get=(q:string)=>new Request('https://example.invalid/api/workspace/programmes?'+q),post=(body:unknown,type='application/json')=>new Request('https://example.invalid/api/workspace/programmes',{method:'POST',headers:{'content-type':type},body:JSON.stringify(body)});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';for(const response of [await GET(get('organizationId='+org)),await POST(post({organizationId:org,operation:'preview'}))]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const query of ['organizationId='+org,'organizationId='+org+'&programmeId='+record])assert.equal((await GET(get(query))).status,401);
 for(const operation of ['preview','apply'])assert.equal((await POST(post({organizationId:org,operation}))).status,401);
 for(const query of ['organizationId=bad','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&programmeId=','organizationId='+org+'&programmeId='+record+'&programmeId='+record])assert.equal((await GET(get(query))).status,400);
 assert.equal((await POST(post({organizationId:org,operation:'approve'}))).status,400);assert.equal((await POST(post({organizationId:org,operation:'preview'},'text/plain'))).status,415);
 assert.equal((await POST(post({organizationId:org,operation:'preview',text:'£'.repeat(33000)}))).status,413);
});
