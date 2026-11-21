import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/effectivity/route';
import {GET as procedureGET} from '../app/api/workspace/effectivity/[id]/procedure/route';
import {GET as exportGET} from '../app/api/workspace/effectivity/[id]/export/route';
test('controlled releases, authorisations and exports remain private, uncached and bounded',async()=>{
 const org=randomUUID(),id=randomUUID(),request=(query:string)=>new Request('https://example.invalid/api/workspace/effectivity?'+query),post=(body:unknown,type='application/json')=>new Request('https://example.invalid/api/workspace/effectivity',{method:'POST',headers:{'content-type':type},body:JSON.stringify(body)}),params={params:Promise.resolve({id})};process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const response of [await GET(request('organizationId='+org)),await POST(post({organizationId:org,action:'PREPARE'})),await procedureGET(request('organizationId='+org),params),await exportGET(request('organizationId='+org),params)]){assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const action of ['PREPARE','CHALLENGE','SIGN','CHECK','CANCEL'])assert.equal((await POST(post({organizationId:org,action,releaseId:id,auth:{method:'otp',sessionHash:'a'.repeat(64)}}))).status,401,'client-supplied authentication is not authority');
 assert.equal((await GET(request('organizationId='+org+'&challengeId='+id))).status,401);assert.equal((await procedureGET(request('organizationId='+org),params)).status,401);assert.equal((await exportGET(request('organizationId='+org),params)).status,401);
 for(const query of ['organizationId=bad','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&releaseId='+id+'&releaseId='+id,'organizationId='+org+'&challengeId='+id+'&challengeId='+id,'organizationId='+org+'&unknown=1'])assert.equal((await GET(request(query))).status,400);
 assert.equal((await POST(post({organizationId:org,action:'PREPARE'},'text/plain'))).status,415);assert.equal((await POST(post({organizationId:org,action:'PREPARE',notes:'£'.repeat(70000)}))).status,413);
});
