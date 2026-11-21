import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {POST as controlTest} from '../app/api/workspace/controls/test/route';
import {POST as research} from '../app/api/workspace/knowledge/research/route';
import {GET as overview} from '../app/api/workspace/knowledge/route';
import {POST as index,DELETE as remove,GET as indexStatus} from '../app/api/workspace/knowledge/index/route';
import {GET as recover,POST as search} from '../app/api/workspace/knowledge/search/route';
test('private knowledge routes authenticate before processing bodies, model calls or database access',async()=>{
 const request=new Request('https://example.invalid/api/workspace/knowledge?organizationId='+randomUUID());process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const route of [overview,index,indexStatus,remove,recover,search,research,controlTest]){const response=await route(request);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_AI_ALLOWED_EMAILS:'fictional@example.invalid',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
 for(const route of [overview,index,indexStatus,remove,recover,search,research,controlTest])assert.equal((await route(request)).status,401);
});
