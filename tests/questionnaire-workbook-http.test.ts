import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {POST as inspect} from '../app/api/workspace/questionnaires/inspect/route';
import {POST as importFile} from '../app/api/workspace/questionnaires/import/route';
import {GET as exportFile} from '../app/api/workspace/questionnaires/[id]/export/route';

test('questionnaire file APIs authenticate before parsing uploads or exporting disclosure data',async()=>{
 const organizationId=randomUUID(),id=randomUUID(),params={params:Promise.resolve({id})};
 const request=(suffix='')=>new Request('https://example.invalid/api/workspace/questionnaires?organizationId='+organizationId+suffix,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=invalid'},body:'x'.repeat(200000)});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const call of [()=>inspect(request()),()=>importFile(request()),()=>exportFile(request('&format=xlsx'),params)]){const response=await call();assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const call of [()=>inspect(request()),()=>importFile(request()),()=>exportFile(request('&format=xlsx'),params)]){const response=await call();assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Sign in to continue'});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 for(const call of [inspect,importFile])assert.equal((await call(request('&organizationId='+organizationId))).status,400);
});
