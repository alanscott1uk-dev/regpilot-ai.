import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/products/route';
import {PATCH} from '../app/api/workspace/products/[id]/route';
import {PATCH as EVIDENCE} from '../app/api/workspace/products/evidence/route';
test('product and evidence-scope APIs authenticate before reading bodies, refuse duplicate companies and never cache private results',async()=>{
 const id=randomUUID(),params={params:Promise.resolve({id})},request=()=>new Request('https://example.invalid?organizationId='+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'OWNER',padding:'x'.repeat(200000)})});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(request()),await POST(request()),await PATCH(request(),params),await EVIDENCE(request())]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const response of [await GET(request()),await POST(request()),await PATCH(request(),params),await EVIDENCE(request())])assert.equal(response.status,401);
 const duplicate=()=>new Request('https://example.invalid?organizationId='+id+'&organizationId='+randomUUID());for(const response of [await GET(duplicate()),await POST(duplicate()),await PATCH(duplicate(),params),await EVIDENCE(duplicate())])assert.equal(response.status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId='+id+'&requestKey='+id+'&requestKey='+id))).status,400);
 assert.equal((await GET(new Request('https://example.invalid?organizationId=invalid'))).status,400);
});
