import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET as controls} from '../app/api/v1/controls/route';
import {GET as tasks} from '../app/api/v1/tasks/route';
import {GET as sources} from '../app/api/v1/regulatory-sources/route';
import {GET as evidence} from '../app/api/v1/evidence/route';
import {GET as observations,POST as submit} from '../app/api/v1/observations/route';
import {GET as contract} from '../app/api/v1/openapi/route';
import {GET as workspace,POST as create} from '../app/api/workspace/developers/route';
import {PATCH as change} from '../app/api/workspace/developers/credentials/[id]/route';
import {POST as review} from '../app/api/workspace/developers/observations/[id]/review/route';

test('customer API data routes authenticate before body parsing and fail closed with structured non-cacheable errors',async()=>{
 const request=()=>new Request('https://example.invalid/api/v1/observations',{method:'POST',body:'{invalid JSON',headers:{'content-type':'application/json'}});
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fictional@example.invalid',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_CUSTOMER_API_ENABLED:'false'});
 for(const route of [controls,tasks,sources,evidence,observations,submit]){const response=await route(request());assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).error.code,'api_inactive');}
 process.env.REGPILOT_CUSTOMER_API_ENABLED='true';for(const route of [controls,tasks,sources,evidence,observations,submit]){const response=await route(request());assert.equal(response.status,401);assert.match(response.headers.get('www-authenticate')||'',/^Bearer/);const body=await response.json();assert.equal(body.error.code,'invalid_credential');assert.equal(body.requestId,response.headers.get('x-request-id'));}
 const publicContract=await contract();assert.equal(publicContract.status,200);assert.equal((await publicContract.json()).openapi,'3.1.0');assert.equal(publicContract.headers.get('x-regpilot-api-version'),'2026-11-20');
});
test('developer administrator routes authenticate before secret creation and review data parsing',async()=>{
 const id=randomUUID(),args={params:Promise.resolve({id})},request=()=>new Request('https://example.invalid/api/workspace/developers?organizationId='+id,{method:'POST',body:'invalid',headers:{'content-type':'application/json'}});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';for(const call of [()=>workspace(request()),()=>create(request()),()=>change(request(),args),()=>review(request(),args)])assert.equal((await call()).status,503);
 process.env.REGPILOT_WORKSPACE_ENABLED='true';for(const call of [()=>workspace(request()),()=>create(request()),()=>change(request(),args),()=>review(request(),args)]){const response=await call();assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');}
});
