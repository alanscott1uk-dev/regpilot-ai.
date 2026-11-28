import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/evidence/route';
import {fixturePdf} from './helpers/pdf-fixture.mjs';

const endpoint='https://example.invalid/api/workspace/evidence';
const get=(organizationId:string,obligationId:string)=>new Request(endpoint+'?'+new URLSearchParams({organizationId,obligationId}));
function post(organizationId:string,obligationId:string){
 const form=new FormData();
 form.set('organizationId',organizationId);
 form.set('obligationId',obligationId);
 form.set('file',new File([new Uint8Array(fixturePdf([['Fictional HTTP boundary fixture.']]))],'fixture.pdf',{type:'application/pdf'}));
 return new Request(endpoint,{method:'POST',body:form});
}

test('evidence listing and multipart uploads accept real UUIDs and still require verified identity',async()=>{
 Object.assign(process.env,{
  REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',
  DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
  SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',
  SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',
  REGPILOT_CLAMD_HOST:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'
 });
 const organizationId=randomUUID(),obligationId=randomUUID();
 for(const [org,task] of [[organizationId,obligationId],[organizationId.toUpperCase(),obligationId.toUpperCase()]]){
  for(const response of [await GET(get(org,task)),await POST(post(org,task))]){
   assert.equal(response.status,401,'valid IDs must reach authentication, not be rejected as malformed');
   assert.deepEqual(await response.json(),{error:'Sign in to continue'});
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
 }
 // The former four-group validator rejected every real UUID while accepting this truncated shape.
 for(const invalid of ['123e4567-e89b-42d3-426614174000','bad','',organizationId+'0']){
  for(const [org,task] of [[invalid,obligationId],[organizationId,invalid]]){
   for(const response of [await GET(get(org,task)),await POST(post(org,task))]){
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{error:'Invalid organisation or task'});
   }
  }
 }
});
