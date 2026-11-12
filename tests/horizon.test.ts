import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHorizon,boundedJson} from '../lib/horizon/collector';
import {PUBLISHERS,rankItem,reportState,validateReport} from '../lib/horizon/model';
const now=new Date('2026-11-12T02:00:00Z');
function fixture(change='',fail='',total=1){const calls:string[]=[];return {calls,fetch:(async(url:any,init:any)=>{const u=new URL(String(url)),slug=u.searchParams.get('filter_organisations')!,start=Number(u.searchParams.get('start'));calls.push(u.href);assert.equal(u.origin,'https://www.gov.uk');assert.equal(u.pathname,'/api/search.json');assert.equal(init.redirect,'error');if(slug===fail)return new Response(null,{status:503});return Response.json({total,results:Array.from({length:Math.min(50,Math.max(0,total-start))},(_,n)=>({title:'Fictional guidance '+change,description:'Fictional test metadata only.',link:'/guidance/'+slug+'-'+(start+n),public_timestamp:'2026-11-11T12:00:00Z',content_store_document_type:'detailed_guide',organisations:[{slug}] }))});}) as typeof fetch};}
test('horizon verifies publishers, bounds requests and compares persisted metadata without inventing legal changes',async()=>{
 const f=fixture(),first=await collectHorizon(null,f.fetch,now);assert.equal(first.items.length,12);assert.ok(first.items.every(i=>i.discovery==='BASELINE'));assert.equal(reportState(first,now.getTime()),'current');
 const next=await collectHorizon(first,fixture().fetch,new Date(now.getTime()+60000));assert.ok(next.items.every(i=>i.discovery==='UNCHANGED'));
 const changed=await collectHorizon(first,fixture('revised').fetch,new Date(now.getTime()+60000));assert.ok(changed.items.every(i=>i.discovery==='METADATA_UPDATED'));
 assert.equal(f.calls.length,12);assert.match(first.limitations.join(' '),/not legal effective dates/);
});
test('horizon retains known metadata through outages without refreshing its observation time',async()=>{
 const first=await collectHorizon(null,fixture().fetch,now),later=new Date(now.getTime()+13*3600000);
 const next=await collectHorizon(first,fixture('',PUBLISHERS[0].slug).fetch,later);
 assert.equal(next.feeds[0].state,'unavailable');assert.equal(reportState(next,later.getTime()),'degraded');
 assert.equal(next.items.find(i=>i.publisherIds.includes('mhra'))?.observedAt,first.generatedAt);
 assert.equal(reportState(next,later.getTime()+13*3600000),'stale');
});
test('result caps remain visible and malicious publisher, path, date and duplicate data cannot enter the feed',async()=>{
 const f=fixture('','',2001),r=await collectHorizon(null,f.fetch,now);assert.equal(f.calls.length,480);assert.ok(r.feeds.every(x=>x.state==='limited'));assert.ok(r.items.length>1500&&r.items.length<=10000);assert.ok(Buffer.byteLength(JSON.stringify(r))<4_000_000);assert.equal(r.pipeline?.retentionLimited,true);
 for(const change of [{link:'https://evil.invalid/'},{organisations:[{slug:'other-authority'}]},{public_timestamp:'2099-01-01T00:00:00Z'}]){
  const base=fixture();const bad=(async(url:any,init:any)=>{const body=await (await base.fetch(url,init)).json();Object.assign(body.results[0],change);return Response.json(body);}) as typeof fetch;
  const report=await collectHorizon(null,bad,now);assert.equal(report.items.length,0);assert.ok(report.feeds.every(x=>x.state==='unavailable'));
 }
});
test('report validation rejects unsafe links, duplicate publisher identity and future reports',async()=>{
 const r=await collectHorizon(null,fixture().fetch,now);
 assert.throws(()=>validateReport({...r,generatedAt:'2099-01-01T00:00:00Z'},now.getTime()));
 assert.throws(()=>validateReport({...r,feeds:r.feeds.map(()=>r.feeds[0])},now.getTime()));
 assert.throws(()=>validateReport({...r,items:[{...r.items[0],url:'https://evil.invalid'}]},now.getTime()));
 const mhra=r.items.find(i=>i.publisherIds.includes('mhra'))!;
 assert.equal(rankItem(mhra,['medicines']).suggested,true);assert.match(rankItem(mhra,['medicines']).reasons.join(' '),/selected activity/);
});
test('public reader refuses oversized, redirected and non-JSON responses',async()=>{
 for(const r of [new Response('x'.repeat(51)),new Response('no json'),new Response(null,{status:302})])await assert.rejects(()=>boundedJson('https://www.gov.uk/api/search.json',(async()=>r) as typeof fetch,50));
});

test('expanded horizon completes more than 100 results and records prior published runs',async()=>{
 const first=await collectHorizon(null,fixture('','',120).fetch,now);
 assert.equal(first.items.length,1440);assert.ok(first.feeds.every(f=>f.state==='available'&&f.retrieved===120));assert.equal(first.pipeline?.requests,36);
 const next=await collectHorizon(first,fixture().fetch,new Date(now.getTime()+60000));
 assert.equal(next.pipeline?.history[0].publications,1440);assert.equal(next.pipeline?.history[0].generatedAt,first.generatedAt);
 assert.equal(reportState(next,now.getTime()+4*3600000),'stale');
 assert.throws(()=>validateReport({...next,pipeline:{...next.pipeline,history:[next.pipeline!.history[0],next.pipeline!.history[0]]}},now.getTime()+60000));
});
test('changing provider totals never claim complete collection',async()=>{
 const f=fixture('','',80);const report=await collectHorizon(null,async(u,o)=>{const response=await f.fetch(u,o),data=await response.json();if(new URL(String(u)).searchParams.get('start')==='50')data.total=81;return Response.json(data);},now);
 assert.ok(report.feeds.every(f=>f.state==='limited'&&f.reason==='INDEX_CHANGED'));
});
