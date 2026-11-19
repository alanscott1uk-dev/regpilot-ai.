import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/risks/route';
import {GET as exportGET} from '../app/api/workspace/risks/[id]/export/route';

test('risk register actions and export are private, uncached, explicitly scoped and bounded',async()=>{
 const org=randomUUID(),risk=randomUUID(),get=(query:string)=>new Request('https://example.invalid/api/workspace/risks?'+query),post=(body:unknown,type='application/json')=>new Request('https://example.invalid/api/workspace/risks',{method:'POST',headers:{'content-type':type},body:JSON.stringify(body)}),params={params:Promise.resolve({id:risk})};
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(get('organizationId='+org)),await POST(post({organizationId:org,action:'CREATE'})),await exportGET(get('organizationId='+org),params)]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 assert.equal((await GET(get('organizationId='+org+'&riskId='+risk))).status,401);
 for(const action of ['CREATE','UPDATE','TREATMENT','PREPARE_REVIEW','DECIDE_REVIEW','ARCHIVE','REOPEN'])assert.equal((await POST(post({organizationId:org,action,riskId:risk,reviewId:randomUUID()}))).status,401);
 assert.equal((await exportGET(get('organizationId='+org),params)).status,401);
 for(const query of ['organizationId=bad','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&riskId='+risk+'&riskId='+risk,'organizationId='+org+'&page=1&page=2','organizationId='+org+'&requestKey='+risk+'&requestKey='+risk])assert.equal((await GET(get(query))).status,400);
 for(const query of ['', 'organizationId='+org+'&organizationId='+org])assert.equal((await exportGET(get(query),params)).status,400);
 assert.equal((await exportGET(get('organizationId='+org),{params:Promise.resolve({id:'invalid'})})).status,400);
 assert.equal((await POST(post({organizationId:org,action:'AUTO_ACCEPT'}))).status,400);
 assert.equal((await POST(post({organizationId:org,action:'CREATE'},'text/plain'))).status,415);
 assert.equal((await POST(post({organizationId:org,action:'CREATE',notes:'£'.repeat(8300)}))).status,413);
 assert.equal((await POST(post([]))).status,400);
});
