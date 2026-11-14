import test from 'node:test';
import assert from 'node:assert/strict';
import {compareProbeHistory} from '../lib/regulatory/probe-history.mjs';
const when='2026-11-12T01:00:00Z',later='2026-11-12T07:00:00Z',row={id:'source',url:'https://www.gov.uk/example',state:'text-retrieved',textHash:'a'.repeat(64)};
test('first capture is a baseline; repeat and changed hashes remain distinct',()=>{
 const first=compareProbeHistory([row],null,when);assert.equal(first.comparison.changes[0].state,'BASELINE');
 assert.equal(compareProbeHistory([row],first.history,later).comparison.changes[0].state,'UNCHANGED');
 assert.equal(compareProbeHistory([{...row,textHash:'b'.repeat(64)}],first.history,later).comparison.changes[0].state,'CONTENT_CHANGED');
});
test('outages preserve the last good hash, so recovery cannot hide changes',()=>{
 const first=compareProbeHistory([row],null,when);
 const outage=compareProbeHistory([{...row,state:'unavailable',textHash:null}],first.history,later);
 assert.equal(outage.comparison.changes[0].state,'UNAVAILABLE');assert.equal(outage.history.sources[0].lastGoodHash,row.textHash);
 const recovered=compareProbeHistory([{...row,textHash:'b'.repeat(64)}],outage.history,'2026-11-13T01:00:00Z');
 assert.equal(recovered.comparison.changes[0].state,'CONTENT_CHANGED');assert.equal(recovered.comparison.changes[0].recoveredAfterOutage,true);
});
test('new URL, invalid/future cache and absent baseline are never unchanged',()=>{
 const first=compareProbeHistory([row],null,when);
 for(const previous of [null,{...first.history,checkedAt:'2099-01-01'}, {...first.history,sources:[{...first.history.sources[0],url:'https://elsewhere.invalid'}]}, {...first.history,sources:[{...first.history.sources[0],lastGoodHash:'invalid'}]}])assert.equal(compareProbeHistory([row],previous,later).comparison.changes[0].state,'BASELINE');
});
