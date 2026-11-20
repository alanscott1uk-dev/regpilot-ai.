import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {GET as overview} from '../app/api/workspace/evaluations/route';
import {POST as create,PATCH as decide} from '../app/api/workspace/evaluations/cases/route';
import {POST as run,GET as read} from '../app/api/workspace/evaluations/runs/route';
import {POST as review,GET as answer} from '../app/api/workspace/evaluations/answers/route';
import {GET as receipt} from '../app/api/workspace/evaluations/receipt/route';
test('quality evaluation authenticates before parsing cases, paid retrieval or independent assessment',async()=>{Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'false',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});const url='https://example.invalid/api/workspace/evaluations?organizationId='+randomUUID();for(const active of ['false','true']){process.env.REGPILOT_WORKSPACE_ENABLED=active;for(const fn of [overview,create,decide,run,read,review,answer,receipt]){const result=await fn(new Request(url,{method:'POST',body:'invalid'}));assert.equal(result.status,active==='false'?503:401);assert.equal(result.headers.get('cache-control'),'no-store');}}});
