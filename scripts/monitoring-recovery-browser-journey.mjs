// Fictional identity and API responses verify the recovery UI and account isolation.
// PostgreSQL/runtime integration tests separately prove worker claims and persistence.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const org='a23e4567-e89b-42d3-a456-426614174000',second='a23e4567-e89b-42d3-a456-426614174002';
const owner='a23e4567-e89b-42d3-a456-426614174001',viewer='a23e4567-e89b-42d3-a456-426614174003';
const missing='a23e4567-e89b-42d3-a456-426614174099',snapshotId='a23e4567-e89b-42d3-a456-426614174004';
const sourceId='uk-data-protection',key='sb-auth-fixture-auth-token';
function session(id,email){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}
export async function monitoringRecoveryJourney(browser,base,viewport,name){
 const ctx=await browser.newContext({viewport,locale:'en-GB',acceptDownloads:true}),page=await ctx.newPage();
 page.setDefaultTimeout(12000);
 const errors=[],reads=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 let actor=session(owner,'monitoring-owner@example.invalid'),role='OWNER',state='failed',version=7,ambiguousNext=false,failReadNext=false,holdNext=false;
 let releaseHeld,heldReady,heldFinished;
 const now=new Date().toISOString(),past=new Date(Date.now()-36*3600000).toISOString();
 const titleFor=id=>id===org?'First-company monitoring fixture':role==='VIEWER'?'Current viewer monitoring fixture':'Second-company monitoring fixture';
 function feed(id){
  const title=titleFor(id),isSecond=id===second,mode=isSecond?state:'failed';
  const successful=mode==='recovered',pending=mode==='queued';
  const runtime={configured:isSecond,mode:isSecond?'worker':'inactive',state:isSecond?(successful?'healthy':'degraded'):'inactive',cadenceMinutes:isSecond?30:null,staleAfterMinutes:isSecond?90:null,channels:[],lastStartedAt:isSecond?now:null,lastFinishedAt:isSecond?now:null,lastSuccessfulAt:isSecond?(successful?now:past):null,reason:isSecond?'Observed execution and individual source collection are separate records.':'The monitoring service and trigger are not active.'};
  const schedule={version,enabled:successful||pending,intervalHours:24,active:isSecond,failureCode:successful?null:'PROVIDER_UNAVAILABLE',nextCheckAt:successful?new Date(Date.now()+24*3600000).toISOString():now,lastSuccessAt:successful?now:past,lastAttemptAt:now,lastOutcome:successful?'CONTENT_CHANGED':pending?'RECOVERY_QUEUED':'FAILED',attempts:pending||successful?0:3,state:pending?'recovery-queued':successful?'scheduled':'attention',checking:false,recoveryPending:pending,retryAvailable:role==='OWNER'&&!successful&&!pending,retryReason:role==='VIEWER'?'An administrator must request recovery.':pending?'A recovery is already queued.':null,history:[{id:'fixture-event-'+version,at:now,action:pending?'monitoring.recovery_requested':successful?'monitoring.check_completed':'monitoring.check_failed',outcome:successful?'CONTENT_CHANGED':pending?'RECOVERY_QUEUED':'FAILED',failureCode:successful?null:'PROVIDER_UNAVAILABLE',attempt:pending?0:3,paused:!successful&&!pending}],historyLimited:false};
  return {organizationId:id,monitoringRuntime:runtime,catalogue:[{id:sourceId,title,agency:'Fictional publisher',path:'/guidance/fictional-only',topic:'Training',activities:['personal-data'],jurisdictions:['Scotland']}],coverage:[{sourceId,snapshotId,reviewStatus:successful?'NEEDS_REVIEW':'REVIEWED',lastCheckedAt:successful?now:past,monitoring:pending?'Recovery requested':successful?'Scheduled':'Collection needs attention',schedule,reviewHref:'/team/sources?'+new URLSearchParams({organizationId:id,sourceId})}],snapshots:[{id:snapshotId,organizationId:id,sourceId,title,url:'https://www.gov.uk/guidance/fictional-only',contentHash:'f'.repeat(64),revisionAt:null,firstCapturedAt:now,lastCheckedAt:successful?now:past,reviewStatus:successful?'NEEDS_REVIEW':'REVIEWED',reviewNotes:successful?'':'Fictional prior independent review.',reviewedAt:successful?null:past,reviewerId:successful?null:owner,capturedById:viewer,addedSnippets:['Fictional changed publication text for independent review.'],removedSnippets:[],version:1}]};
 }
 await ctx.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key,value:actor});
 await ctx.route('https://auth-fixture.example.invalid/**',r=>r.fulfill({json:{user:actor.user}}));
 await ctx.route('**/api/ai/context',r=>r.fulfill({json:{email:actor.user.email,userId:actor.user.id,organisations:[{id:org,name:'First company',role},{id:second,name:'Second company',role}]}}));
 await ctx.route('**/api/workspace/intelligence/profile*',r=>r.fulfill({json:{profile:{activities:['personal-data'],jurisdictions:['Scotland'],version:1}}}));
 await ctx.route('**/api/workspace/connectors/health*',r=>{
  assert.equal(r.request().method(),'GET');const id=new URL(r.request().url()).searchParams.get('organizationId');
  return r.fulfill({json:{organizationId:id,items:[],total:0,observed:0,needsAttention:0,notice:'No fictional connectors configured.'}});
 });
 await ctx.route('**/api/workspace/sources*',async r=>{
  assert.equal(r.request().method(),'GET','monitoring refresh must not collect a source');
  const id=new URL(r.request().url()).searchParams.get('organizationId');assert.ok([org,second].includes(id));reads.push(id);
  if(failReadNext){failReadNext=false;return r.fulfill({status:503,json:{error:'Fictional monitoring status temporarily unavailable.'}});}
  const body=structuredClone(feed(id)),hold=holdNext&&id===second;
  if(hold){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;heldReady();});}
  try{await r.fulfill({json:body});}catch{}finally{if(hold)heldFinished();}
 });
 await ctx.route('**/api/workspace/monitoring/retry',async r=>{
  assert.equal(r.request().method(),'POST');const body=r.request().postDataJSON();
  assert.deepEqual(body,{organizationId:second,sourceId,version});writes.push(body);version++;state='queued';
  if(ambiguousNext){ambiguousNext=false;return r.abort('failed');}
  return r.fulfill({json:{id:'fixture-watch',version,reused:false,nextCheckAt:now,recoveryPending:true,monitoringConfigured:true}});
 });
 try{
  await page.goto(base+'/team/coverage?organizationId='+second);
  const source=()=>page.getByRole('article',{name:titleFor(second),exact:true});
  await source().waitFor();
  assert.ok(reads.length>0&&reads.every(id=>id===second),'a linked second organisation must never use the first membership');
  assert.equal(await page.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),second);
  await page.getByRole('region',{name:'Monitoring runtime',exact:true}).getByRole('heading',{name:'The latest monitoring run needs attention',exact:true}).waitFor();
  const reviewUrl=new URL(await source().getByRole('link',{name:'Review source and diffs',exact:true}).getAttribute('href'),base);
  assert.equal(reviewUrl.searchParams.get('organizationId'),second);assert.equal(reviewUrl.searchParams.get('sourceId'),sourceId);
  for(const label of ['Manage source portfolio','Manage connections'])assert.equal(new URL(await page.getByRole('link',{name:label,exact:true}).getAttribute('href'),base).searchParams.get('organizationId'),second);
  const nav=page.getByRole('navigation',{name:'Main workspace',exact:true});assert.equal(await nav.getByRole('link').count(),5);
  for(const link of await nav.getByRole('link').all()){
   const box=await link.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=viewport.width+3,'main navigation is visible within the viewport width');
  }
  const downloadReady=page.waitForEvent('download');await page.getByRole('button',{name:'Export source-health CSV',exact:true}).click();
  const download=await downloadReady,csv=await readFile(await download.path(),'utf8');assert.match(csv,/Second-company monitoring fixture/);assert.doesNotMatch(csv,/First-company/);
  await mkdir('artifacts/usability',{recursive:true});await writeFile('artifacts/usability/monitoring-recovery-'+name+'.csv',csv);

  await source().getByRole('button',{name:'Request recovery',exact:true}).click();
  await source().getByText(/Recovery requested — waiting for a completed check/).waitFor();
  assert.equal(writes.length,1);assert.equal(await source().getByRole('button',{name:'Request recovery',exact:true}).count(),0);
  await source().getByText("Last recorded issue: provider unavailable. Previous successful evidence remains available.",{exact:true}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/usability/monitoring-recovery-'+name+'-queued.png',fullPage:true});

  // A later failure is a new saved state. Simulate a committed recovery whose reply is lost.
  state='failed';version++;await page.getByRole('button',{name:'Refresh monitoring status',exact:true}).click();
  await source().getByRole('button',{name:'Request recovery',exact:true}).waitFor();
  ambiguousNext=true;await source().getByRole('button',{name:'Request recovery',exact:true}).click();
  const reconcile=page.getByRole('button',{name:'Check saved monitoring status',exact:true});await reconcile.waitFor();
  assert.equal(writes.length,2);assert.equal(await source().getByRole('button',{name:'Request recovery',exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:'Export source-health CSV',exact:true}).isEnabled(),false);
  failReadNext=true;await reconcile.click();await page.getByText('Fictional monitoring status temporarily unavailable.',{exact:true}).waitFor();
  assert.equal(await source().count(),0,'failed reconciliation removes stale source state');assert.equal(writes.length,2);
  await reconcile.click();await source().getByText(/Recovery requested — waiting for a completed check/).waitFor();
  assert.equal(writes.length,2,'reconciliation must make no duplicate recovery write');

  state='recovered';version++;await page.getByRole('button',{name:'Refresh monitoring status',exact:true}).click();
  await page.getByRole('region',{name:'Monitoring runtime',exact:true}).getByRole('heading',{name:'Recent monitoring run recorded',exact:true}).waitFor();
  await source().getByText(/Human interpretation outstanding/).waitFor();assert.equal(await source().getByText(/Last recorded issue:/).count(),0);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'monitoring recovery horizontal overflow '+overflow+'px');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/usability/monitoring-recovery-'+name+'-recovered.png',fullPage:true});
  await source().getByRole('link',{name:'Review source and diffs',exact:true}).click();
  await page.getByRole('heading',{name:'Record independent impact assessment',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('organizationId'),second);assert.equal(new URL(page.url()).searchParams.get('sourceId'),sourceId);
  await page.getByText('Fictional changed publication text for independent review.',{exact:true}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/usability/monitoring-recovery-'+name+'-source-review.png',fullPage:true});

  // Late data from a prior organisation must not restore its source list or actions.
  state='failed';await page.goto(base+'/team/coverage?organizationId='+second);await source().waitFor();
  holdNext=true;let held=new Promise(resolve=>{heldReady=resolve}),finished=new Promise(resolve=>{heldFinished=resolve});
  await page.getByRole('button',{name:'Refresh monitoring status',exact:true}).click();await held;
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(org);
  await page.getByRole('article',{name:'First-company monitoring fixture',exact:true}).waitFor();
  releaseHeld();await finished;assert.equal(await page.getByRole('article',{name:'Second-company monitoring fixture',exact:true}).count(),0);
  await page.getByRole('region',{name:'Monitoring runtime',exact:true}).getByRole('heading',{name:'Monitoring awaits activation',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Request recovery',exact:true}).isEnabled(),true,'an inactive runtime can accept a queued recovery without activating collection');
  assert.equal(writes.length,2,'viewing inactive monitoring must not collect or queue anything automatically');

  const beforeMissing=reads.length;await page.goto(base+'/team/coverage?organizationId='+missing);
  await page.getByText(/The linked organisation is unavailable/).waitFor();assert.equal(reads.length,beforeMissing);assert.equal(await page.getByRole('region',{name:'Monitoring runtime',exact:true}).count(),0);
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(second);await source().waitFor();

  // Same organisation, different account: reject a pending OWNER response after VIEWER signs in.
  holdNext=true;held=new Promise(resolve=>{heldReady=resolve});finished=new Promise(resolve=>{heldFinished=resolve});
  await page.getByRole('button',{name:'Refresh monitoring status',exact:true}).click();await held;
  actor=session(viewer,'monitoring-viewer@example.invalid');role='VIEWER';
  await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key,value:actor});
  await page.getByRole('article',{name:'Current viewer monitoring fixture',exact:true}).waitFor();releaseHeld();await finished;
  assert.equal(await page.getByRole('article',{name:'Second-company monitoring fixture',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Request recovery',exact:true}).count(),0);
  await page.evaluate(key=>{localStorage.removeItem(key);const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();},key);
  await page.getByRole('form',{name:'Email sign-in',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Monitoring runtime',exact:true}).count(),0);
  assert.equal(writes.length,2);assert.deepEqual(errors,[]);
  return {scenario:'monitoring-recovery-'+name,passed:true,fixture:'fictional identity/API responses; actual runtime and database persistence tested separately',overflowPx:overflow,recoveryWrites:writes.length,checks:['exact second-organisation deep link and scoped CSV','configured runtime distinct from observed execution','failure persists while recovery is queued','uncertain write response requires GET-only reconciliation','failed refresh clears stale status','successful collection returns to independent source review','all five mobile destinations remain visible','late prior-organisation response rejected','unknown organisation never falls back','same-organisation account replacement removes old content/actions','sign-out clears private monitoring records']};
 }catch(error){
  releaseHeld?.();await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/monitoring-recovery-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw error;
 }finally{releaseHeld?.();await ctx.close();}
}
