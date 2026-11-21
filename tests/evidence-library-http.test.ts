import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET} from '../app/api/workspace/evidence/library/route';
test('evidence library reads remain gated, private and identity-verified before database access',async()=>{
 const org=randomUUID(),id=randomUUID(),request=(query:string)=>new Request('https://example.invalid/api/workspace/evidence/library?'+query);
 process.env.REGPILOT_EVIDENCE_ENABLED='false';
 let response=await GET(request('organizationId='+org));assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const query of ['organizationId='+org,'organizationId='+org+'&evidenceId='+id+'&targetPage=2']){
  response=await GET(request(query));assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Sign in to continue'});assert.equal(response.headers.get('cache-control'),'no-store');
 }
 for(const query of ['organizationId=invalid','organizationId='+org+'&organizationId='+org,'organizationId='+org+'&evidenceId=bad','organizationId='+org+'&review=anything','organizationId='+org+'&page=-1'])assert.equal((await GET(request(query))).status,400,query);
});
