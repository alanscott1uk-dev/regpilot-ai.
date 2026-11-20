import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/training/route';
import {GET as procedureGET} from '../app/api/workspace/training/[id]/procedure/route';
import {GET as exportGET} from '../app/api/workspace/training/[id]/export/route';
test('training administration, learner actions, originals and matrices stay private, uncached and bounded',async()=>{
 const org=randomUUID(),id=randomUUID(),request=(query:string)=>new Request('https://example.invalid/api/workspace/training?'+query),post=(body:unknown,type='application/json')=>new Request('https://example.invalid/api/workspace/training',{method:'POST',headers:{'content-type':type},body:JSON.stringify(body)}),params={params:Promise.resolve({id})};process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(request('organizationId='+org)),await POST(post({organizationId:org,action:'CREATE'})),await procedureGET(request('organizationId='+org),params),await exportGET(request('organizationId='+org),params)]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const action of ['CREATE','REQUIREMENT','ENROL','REFRESH','SET_ACTIVE','ACKNOWLEDGE','SUBMIT','DECIDE'])assert.equal((await POST(post({organizationId:org,action,curriculumId:id,trainingId:id,attemptId:id}))).status,401);
 assert.equal((await GET(request('organizationId='+org+'&trainingId='+id))).status,401);assert.equal((await procedureGET(request('organizationId='+org),params)).status,401);assert.equal((await exportGET(request('organizationId='+org+'&format=csv'),params)).status,401);
 for(const query of ['organizationId=bad','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&trainingId='+id+'&trainingId='+id,'organizationId='+org+'&requestKey='+id+'&requestKey='+id,'organizationId='+org+'&unknown=1'])assert.equal((await GET(request(query))).status,400);
 assert.equal((await exportGET(request('organizationId='+org+'&format=html'),params)).status,400);assert.equal((await procedureGET(request('organizationId='+org+'&format=json'),params)).status,400);assert.equal((await POST(post({organizationId:org,action:'AUTO_CERTIFY'}))).status,400);assert.equal((await POST(post({organizationId:org,action:'CREATE'},'text/plain'))).status,415);assert.equal((await POST(post({organizationId:org,action:'CREATE',notes:'£'.repeat(13000)}))).status,413);
});
