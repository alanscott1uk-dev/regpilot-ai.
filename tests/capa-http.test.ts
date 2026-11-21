import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/quality/route';
import {GET as exportGET} from '../app/api/workspace/quality/[id]/export/route';
test('quality case routes and chronology exports are explicitly scoped, private and bounded',async()=>{
 const org=randomUUID(),id=randomUUID(),get=(query:string)=>new Request('https://example.invalid/api/workspace/quality?'+query),post=(body:unknown,type='application/json')=>new Request('https://example.invalid/api/workspace/quality',{method:'POST',headers:{'content-type':type},body:JSON.stringify(body)}),params={params:Promise.resolve({id})};
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(get('organizationId='+org)),await POST(post({organizationId:org,action:'CREATE'})),await exportGET(get('organizationId='+org),params)]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(get('organizationId='+org+'&caseId='+id))).status,401);
 for(const action of ['CREATE','OFFER_HANDOVER','ACCEPT_HANDOVER','CANCEL_HANDOVER','INVESTIGATE','ADD_ACTION','PREPARE_EFFECTIVENESS','DECIDE_EFFECTIVENESS','REOPEN'])assert.equal((await POST(post({organizationId:org,action,caseId:id,reviewId:randomUUID()}))).status,401);
 assert.equal((await exportGET(get('organizationId='+org),params)).status,401);
 assert.equal((await exportGET(get('organizationId='+org+'&format=text'),params)).status,401);
 for(const format of ['pdf','text&format=json'])assert.equal((await exportGET(get('organizationId='+org+'&format='+format),params)).status,400);
 for(const query of ['organizationId=bad','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&caseId='+id+'&caseId='+id,'organizationId='+org+'&requestKey='+id+'&requestKey='+id,'organizationId='+org+'&unexpected=x'])assert.equal((await GET(get(query))).status,400);
 assert.equal((await exportGET(get('organizationId='+org),{params:Promise.resolve({id:'bad'})})).status,400);
 assert.equal((await POST(post({organizationId:org,action:'AUTO_CERTIFY'}))).status,400);assert.equal((await POST(post({organizationId:org,action:'CREATE'},'text/plain'))).status,415);assert.equal((await POST(post({organizationId:org,action:'CREATE',notes:'£'.repeat(8300)}))).status,413);assert.equal((await POST(post([]))).status,400);
});
