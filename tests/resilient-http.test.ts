import test from 'node:test';
import assert from 'node:assert/strict';
import {resilientGet,retryAfterSeconds} from '../lib/connectors/resilient-http';
import {CollectionError} from '../lib/connectors/collection-error';
const origin='https://api.example.invalid';
const code=(s:string)=>(e:any)=>e instanceof CollectionError&&e.code===s;
test('idempotent reads retry transient faults with shared budget and no credential redirects',async()=>{
 let calls=0,now=1000;const waits:number[]=[],metrics={requests:0,retries:0};
 const get=resilientGet(async(_u,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');return calls<3?new Response(null,{status:503}):Response.json({ok:true});},origin,{Authorization:'Bearer fictional'},{metrics,clock:()=>now,sleep:async ms=>{waits.push(ms);now+=ms},random:()=>0,maxRequests:3});
 assert.deepEqual(await (await get(origin+'/health')).json(),{ok:true});assert.deepEqual(waits,[250,500]);assert.deepEqual(metrics,{requests:3,retries:2});
 await assert.rejects(()=>get(origin+'/again'),code('REQUEST_LIMIT'));
 await assert.rejects(()=>get('https://other.invalid/'),code('UNSAFE_TARGET'));assert.equal(calls,3);
});
test('long Retry-After is returned for durable scheduling and never retried early',async()=>{
 let calls=0;const get=resilientGet(async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'7200'}})},origin,{}, {sleep:async()=>assert.fail('must defer')});
 await assert.rejects(()=>get(origin),(e:any)=>e.code==='RATE_LIMITED'&&e.retryAfterSeconds===7200);assert.equal(calls,1);
 assert.equal(retryAfterSeconds(new Headers({'retry-after':new Date(7200000).toUTCString()}),0),7200);
 assert.equal(retryAfterSeconds(new Headers({'x-ratelimit-remaining':'0','x-ratelimit-reset':'100'}),90000),10);
});
test('permission denials do not retry; GitHub secondary throttling is distinguished',async()=>{
 let calls=0;const get=resilientGet(async()=>{calls++;return new Response(null,{status:403});},origin,{});
 assert.equal((await get(origin)).status,403);assert.equal(calls,1);
 const throttled=resilientGet(async()=>new Response(null,{status:403,headers:{'retry-after':'60'}}),origin,{});
 await assert.rejects(()=>throttled(origin),code('RATE_LIMITED'));
});
test('network retries are bounded and credentials never enter error text',async()=>{
 let calls=0;const get=resilientGet(async()=>{calls++;throw Error('Bearer SECRET');},origin,{}, {sleep:async()=>{},random:()=>0});
 await assert.rejects(()=>get(origin),(e:any)=>e.code==='PROVIDER_UNAVAILABLE'&&!e.message.includes('SECRET'));assert.equal(calls,3);
 const moved=Response.json({});Object.defineProperty(moved,'url',{value:'https://other.invalid/'});
 await assert.rejects(()=>resilientGet(async()=>moved,origin,{})(origin),code('TARGET_MISMATCH'));
});
