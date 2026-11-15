import test from 'node:test';
import assert from 'node:assert/strict';
import {executeWithMaintenance} from '../lib/server/worker-maintenance';
import {executeScheduledTick} from '../lib/cron-tick.mjs';
const work=()=>executeScheduledTick({sources:async()=>({processed:12})});
test('maintenance failure preserves completed collection and reports degraded health without raw errors',async()=>{
 const result=await executeWithMaintenance(work,async()=>{throw Error('private database details');});
 assert.equal(result.ok,false);assert.equal(result.modules.sources.processed,12);
 assert.deepEqual(result.maintenance,{state:'failed'});assert.doesNotMatch(JSON.stringify(result),/private database/);
});
test('synchronous collection failure does not prevent independent maintenance',async()=>{
 let cleaned=false;
 const result=await executeWithMaintenance(()=>{throw Error('private');},async()=>{cleaned=true;return {webhookReceipts:4,publicSources:2};});
 assert.equal(cleaned,true);assert.equal(result.ok,false);assert.equal(result.modules.sources.state,'failed');
 assert.deepEqual(result.maintenance,{state:'completed',webhookReceipts:4,publicSources:2});
});
test('maintenance can be disabled on collection slots; synchronous cleanup failure cannot cancel work',async()=>{
 assert.deepEqual((await executeWithMaintenance(work)).maintenance,{state:'disabled'});
 const result=await executeWithMaintenance(work,()=>{throw Error('private');});
 assert.equal(result.modules.sources.processed,12);assert.equal(result.ok,false);
});
test('shared source deferral is visible as backlog instead of fabricated completion',async()=>{
 const result=await executeScheduledTick({sources:async()=>({processed:1,outcomes:['SOURCE_DEFERRED']})});
 assert.equal(result.modules.sources.state,'backlog');assert.equal(result.modules.sources.attention,0);
});

import {finalizeCollectionTick} from '../lib/server/collection-health';
test('empty sweeps cannot clear failed paused source or connector schedules',async()=>{
 const initial=await executeScheduledTick({sources:async()=>({processed:0}),connectors:async()=>({processed:0})});
 const paused=await finalizeCollectionTick(initial,async()=>({sources:1,connectors:2}));
 assert.equal(paused.ok,false);assert.equal(paused.modules.sources.attention,1);assert.equal(paused.modules.connectors.attention,2);
 assert.equal(paused.modules.sources.state,'attention');
 const repaired=await finalizeCollectionTick(initial,async()=>({sources:0,connectors:0}));assert.equal(repaired.ok,true);
 const unknown=await finalizeCollectionTick(initial,async()=>{throw Error('private database detail');});assert.equal(unknown.ok,false);assert.doesNotMatch(JSON.stringify(unknown),/private database/);
});
test('analysis capacity defers work without reporting completion or a permanent provider failure',async()=>{
 const result=await executeScheduledTick({sources:async()=>({processed:1,outcomes:['ANALYSIS_DEFERRED']})});
 assert.equal(result.modules.sources.state,'backlog');assert.equal(result.modules.sources.attention,0);
});
