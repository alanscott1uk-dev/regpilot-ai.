import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/questionnaires/[id]/automation/route';
import {GET as WORKSPACE,POST as CREATE} from '../app/api/workspace/questionnaires/route';
import {GET as ANSWERS} from '../app/api/workspace/answers/route';

test('questionnaire automation and exact recovery authenticate before processing bodies and never cache private results',async()=>{
 const id=randomUUID(),params={params:Promise.resolve({id})},request=()=>new Request('https://example.invalid?organizationId='+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'OWNER',padding:'x'.repeat(1700000)})});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(request(),params),await POST(request(),params),await WORKSPACE(request()),await CREATE(request()),await ANSWERS(request())]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const response of [await GET(request(),params),await POST(request(),params),await WORKSPACE(request()),await CREATE(request()),await ANSWERS(request())])assert.equal(response.status,401);
 const duplicate=new Request('https://example.invalid?organizationId='+id+'&organizationId='+randomUUID());assert.equal((await GET(duplicate,params)).status,400);
 assert.equal((await WORKSPACE(new Request('https://example.invalid?organizationId='+id+'&requestKey='+id+'&requestKey='+id))).status,400);
 assert.equal((await ANSWERS(new Request('https://example.invalid?organizationId='+id+'&requestKey='+id+'&requestKey='+id))).status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId=wrong'),params)).status,400);
});
