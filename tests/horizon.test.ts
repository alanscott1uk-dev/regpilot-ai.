import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHorizon,boundedJson} from '../lib/horizon/collector';
import {emptyHorizonView, matchingPhrase, matchesHorizonView, searchPhrases, watchlistFilters} from '../lib/horizon/watchlists';
import {PUBLISHERS,describeFeedIssue,rankItem,reportState,validateReport} from '../lib/horizon/model';
const now=new Date('2026-11-12T02:00:00Z');
function fixture(change='',fail='',total=1){const calls:string[]=[];return {calls,fetch:(async(url:any,init:any)=>{const u=new URL(String(url)),slug=u.searchParams.get('filter_organisations')!,start=Number(u.searchParams.get('start'));calls.push(u.href);assert.equal(u.origin,'https://www.gov.uk');assert.equal(u.pathname,'/api/search.json');assert.equal(init.redirect,'error');if(slug===fail)return new Response(null,{status:503});return Response.json({total,results:Array.from({length:Math.min(Number(u.searchParams.get('count')),Math.max(0,total-start))},(_,n)=>({title:'Fictional guidance '+change,description:'Fictional test metadata only.',link:'/guidance/'+slug+'-'+(start+n),public_timestamp:'2026-11-11T12:00:00Z',content_store_document_type:'detailed_guide',organisations:[{slug}] }))});}) as typeof fetch};}
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
 const f=fixture('','',2001),r=await collectHorizon(null,f.fetch,now);assert.equal(f.calls.length,24);assert.ok(r.feeds.every(x=>x.state==='limited'));assert.ok(r.items.length>1500&&r.items.length<=10000);assert.ok(Buffer.byteLength(JSON.stringify(r))<4_000_000);assert.equal(r.pipeline?.retentionLimited,true);
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
 assert.equal(first.items.length,1440);assert.ok(first.feeds.every(f=>f.state==='available'&&f.retrieved===120));assert.equal(first.pipeline?.requests,12);
 const next=await collectHorizon(first,fixture().fetch,new Date(now.getTime()+60000));
 assert.equal(next.pipeline?.history[0].publications,1440);assert.equal(next.pipeline?.history[0].generatedAt,first.generatedAt);
 assert.equal(reportState(next,now.getTime()+4*3600000),'stale');
 assert.throws(()=>validateReport({...next,pipeline:{...next.pipeline,history:[next.pipeline!.history[0],next.pipeline!.history[0]]}},now.getTime()+60000));
});
test('changing provider totals never claim complete collection',async()=>{
 const f=fixture('','',1501);const report=await collectHorizon(null,async(u,o)=>{const response=await f.fetch(u,o),data=await response.json();if(new URL(String(u)).searchParams.get('start')==='1500'){data.total=1500;data.results=[];}return Response.json(data);},now);
 assert.ok(report.feeds.every(f=>f.state==='limited'&&f.reason==='INDEX_CHANGED'));
});

test('publisher cooldown survives published checkpoints and skips early retry while preserving old observation time',async()=>{
 const initial=await collectHorizon(null,fixture().fetch,now),f=fixture();
 const failed=await collectHorizon(initial,async(u,o)=>new URL(String(u)).searchParams.get('filter_organisations')===PUBLISHERS[0].slug?new Response(null,{status:429,headers:{'retry-after':'7200'}}):f.fetch(u,o),new Date(now.getTime()+60000));
 assert.equal(failed.feeds[0].failureCount,1);assert.equal(failed.feeds[0].reason,'RATE_LIMITED');
 const next=fixture();const recovered=await collectHorizon(failed,next.fetch,new Date(now.getTime()+3600000));
 assert.equal(next.calls.length,11);assert.equal(recovered.feeds[0].checkedAt,failed.generatedAt);assert.equal(recovered.items.find(i=>i.publisherIds.includes('mhra'))?.observedAt,initial.generatedAt);
 const due=fixture();const fresh=await collectHorizon(recovered,due.fetch,new Date(now.getTime()+3*3600000));assert.equal(due.calls.length,12);assert.equal(fresh.feeds[0].failureCount,0);assert.equal(fresh.feeds[0].state,'available');
});

test('discovery diagnostics distinguish safe failure reasons without accepting partial data or refreshing old observations',async()=>{
 const baseline=await collectHorizon(null,fixture().fetch,now),later=new Date(now.getTime()+60000);
 const cases:{reason:string;change:(data:any)=>Response}[]=[
  {reason:'HTTP_STATUS_403',change:()=>new Response('Private provider error secret',{status:403})},
  {reason:'INVALID_JSON',change:()=>new Response('Private provider error secret')},
  {reason:'INVALID_RESPONSE_SHAPE',change:data=>Response.json({...data,results:{secret:'Private provider error'}})},
  {reason:'INVALID_PUBLICATION_PATH',change:data=>{data.results[0].link='https://secret.invalid/private';return Response.json(data);}},
  {reason:'INVALID_PUBLICATION_TIMESTAMP',change:data=>{data.results[0].public_timestamp='invalid-private-date';return Response.json(data);}},
  {reason:'UNVERIFIED_PUBLISHER',change:data=>{data.results[0].organisations=[{slug:'private-unknown-publisher'}];return Response.json(data);}},
  {reason:'INVALID_PUBLICATION_METADATA',change:data=>{data.results[0].title='';return Response.json(data);}},
  {reason:'DUPLICATE_PAGE',change:data=>Response.json({...data,total:2,results:[data.results[0],data.results[0]]})}
 ];
 for(const scenario of cases){
  const base=fixture();
  const result=await collectHorizon(baseline,async(url,options)=>{
   const response=await base.fetch(url,options);
   return new URL(String(url)).searchParams.get('filter_organisations')==='hm-revenue-customs'?scenario.change(await response.json()):response;
  },later);
  const feed=result.feeds.find(f=>f.id==='hmrc')!;
  assert.equal(feed.state,'unavailable');assert.equal(feed.reason,scenario.reason);assert.equal(feed.retrieved,0);
  assert.equal(feed.failureCount,1);assert.equal(feed.retryAt,new Date(later.getTime()+900000).toISOString());
  assert.equal(result.feeds.filter(f=>f.state==='available').length,11);
  assert.deepEqual(result.items.filter(i=>i.publisherIds.includes('hmrc')),baseline.items.filter(i=>i.publisherIds.includes('hmrc')));
  assert.doesNotMatch(JSON.stringify(result),/secret|Private provider|private-unknown|invalid-private/);
 }
});

test('larger reads avoid unstable offset boundaries and oversized pages retry at the same offset', async () => {
 const base=fixture('','',120), seen:string[]=[];
 const result=await collectHorizon(null,async(url,opts)=>{
  const u=new URL(String(url)), response=await base.fetch(url,opts);
  if(u.searchParams.get('filter_organisations')!=='hm-revenue-customs') return response;
  seen.push(u.searchParams.get('start')+':'+u.searchParams.get('count'));
  if(Number(u.searchParams.get('count'))>100) return new Response('x'.repeat(2_000_001));
  return response;
 },now);
 assert.deepEqual(seen,['0:1500','0:750','0:375','0:187','0:93','93:93']);
 assert.equal(result.feeds.find(f=>f.id==='hmrc')?.state,'available');
 assert.equal(result.feeds.find(f=>f.id==='hmrc')?.retrieved,120);
 assert.equal(result.pipeline?.requests,17);
});

test('an incorrect offset or truncated publisher page cannot replace a previously observed feed', async () => {
 const base=fixture(),previous=await collectHorizon(null,base.fetch,now);
 for(const reason of ['PAGE_OFFSET_MISMATCH','INCOMPLETE_PAGE']){
  const next=await collectHorizon(previous,async(url,options)=>{
   const response=await base.fetch(url,options);
   if(new URL(String(url)).searchParams.get('filter_organisations')!=='environment-agency')return response;
   const raw=await response.json();return Response.json({...raw,...(reason==='INCOMPLETE_PAGE'?{total:2}:{start:30})});
  },new Date(now.getTime()+60_000));
  const feed=next.feeds.find(f=>f.id==='environment-agency')!;
  assert.equal(feed.state,'unavailable'); assert.equal(feed.reason,reason); assert.equal(feed.retrieved,0);
  assert.equal(next.items.find(i=>i.publisherIds.includes(feed.id))?.observedAt,previous.generatedAt);
 }
});

test('shared horizon filters match whole phrases within a single metadata field', async () => {
 const report = await collectHorizon(null, fixture().fetch, now);
 const item = {...report.items.find(row=>row.publisherIds.includes('mhra'))!, title:'Good practice for GMPs and GMPX', summary:'Guidance on the cold-chain and batch release.'};
 const phrases = searchPhrases(' GMP, cold chain,  gMp, , BATCH release ');
 assert.deepEqual(phrases, ['gmp','cold chain','batch release']);
 assert.equal(matchingPhrase(item, phrases), 'cold chain');
 const view = {...emptyHorizonView, publisher:'mhra', topic:'medicines', kind:'Guidance' as const, phrases};
 assert.equal(matchesHorizonView(item, view, report.generatedAt, false), true);
 for (const other of [{publisher:'hmrc'}, {topic:'commercial-waste'}, {kind:'Policy' as const}, {phrases:['gmp']}, {phrases:['gmpx guidance']}, {onlyOpen:true}]) {
   assert.equal(matchesHorizonView(item, {...view,...other}, report.generatedAt, true), false);
 }
 assert.equal(matchesHorizonView({...item,title:'GMP: updated'}, {...view,phrases:['gmp']}, report.generatedAt, false), true);
});

test('watchlists distinguish publisher update windows and changes observed in the latest collection', async () => {
 const report = await collectHorizon(null, fixture().fetch, now), item = report.items[0];
 const changeView = {...emptyHorizonView, changedOnly:true};
 for (const discovery of ['FIRST_SEEN','METADATA_UPDATED'] as const) {
   assert.ok(matchesHorizonView({...item,discovery}, changeView, report.generatedAt, false));
   assert.equal(matchesHorizonView({...item,discovery,observedAt:item.updatedAt}, changeView, report.generatedAt, false), false);
 }
 assert.equal(matchesHorizonView(item, changeView, report.generatedAt, false), false);
 assert.equal(matchesHorizonView({...item,discovery:'UNCHANGED'}, changeView, report.generatedAt, false), false);
 for (const [updatedWithin,days] of [['day',1],['week',7]] as const) {
   const cutoff=now.getTime()-days*86400000;
   assert.ok(matchesHorizonView({...item,updatedAt:new Date(cutoff).toISOString()}, {...emptyHorizonView,updatedWithin}, report.generatedAt, false));
   assert.equal(matchesHorizonView({...item,updatedAt:new Date(cutoff-1).toISOString()}, {...emptyHorizonView,updatedWithin}, report.generatedAt, false), false);
 }
});

test('saved filters validate vocabulary, reject oversized terms, and keep provider diagnostics public', () => {
 for (const invalid of [{phrases:['-']},{phrases:['a'.repeat(81)]},{phrases:Array(9).fill('gmp')},{publisher:'unknown'},{topic:'unknown'},{kind:'unknown'},{updatedWithin:'month'},{secret:'hidden'}]) {
   assert.equal(watchlistFilters.safeParse({...emptyHorizonView,...invalid}).success,false);
 }
 assert.deepEqual(watchlistFilters.parse({...emptyHorizonView, phrases:['  GMP ','gmp','COLD-CHAIN']}).phrases,['gmp','cold chain']);
 assert.match(describeFeedIssue('DUPLICATE_PAGE'),/duplicate publication/);
 assert.match(describeFeedIssue('HTTP_STATUS_403'),/HTTP 403/);
 assert.equal(describeFeedIssue('private error detail'),describeFeedIssue('__proto__'));
});
