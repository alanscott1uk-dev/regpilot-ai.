// Fictional browser identity/API fixtures: UI handoffs, recovery and isolation.
// The separate private-services journey verifies real onboarding and persistence.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const org='823e4567-e89b-42d3-a456-426614174000',other='823e4567-e89b-42d3-a456-426614174002';
const user='823e4567-e89b-42d3-a456-426614174001',otherUser='823e4567-e89b-42d3-a456-426614174003';
const unavailable='823e4567-e89b-42d3-a456-426614174099';
const storageKey='sb-auth-fixture-auth-token';
function session(id,email){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}
function workspace(organizationId){
 const first=organizationId===org,generatedAt=new Date().toISOString();
 const link=(path,extra={})=>path+'?'+new URLSearchParams({organizationId,...extra});
 const stepSpecs=[
  ['scope','Business scope','NOT_STARTED','Your fictional business scope has not been saved.','/team/setup','Set up your business'],
  ['sources','Regulatory updates','BLOCKED','A selected source awaits capture. Background monitoring awaits activation.','/team/sources','Inspect source monitoring'],
  ['work','Owned work','RECORDED','Seven recorded tasks have eligible member assignments.','/team/work','Open team work'],
  ['evidence','Reviewed evidence','NOT_STARTED','Supporting files have not been uploaded.','/team/evidence','Add supporting evidence'],
  ['completion','Recorded outcomes','NOT_STARTED','No verified completion record has been saved.','/team/work','Complete supported work'],
  ['report','Review report','AVAILABLE','A report includes recorded gaps without approving work.','/team/briefing','Open review report']
 ];
 const steps=stepSpecs.map(([key,title,status,detail,path,actionLabel])=>({key,title,status,detail,href:link(path),actionLabel}));
 if(!first){steps[0].detail='Second company has its own scope and no inherited work.';steps[2].status='NOT_STARTED';steps[2].detail='No work recorded for this organisation.';}
 const tasks=first?Array.from({length:7},(_,i)=>({id:'923e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),title:'Fictional first-company task '+i,dueDate:'2026-01-01T00:00:00.000Z',status:'OPEN',ownerName:'owner@example.invalid',assigneeId:user,controlId:null,connectorId:null,originKey:null,changeAction:null})):[];
 return {tasks,summary:{policyReading:0,vendorReviewsDue:0,open:tasks.length,overdue:tasks.length,evidencePending:0,monitoringAttention:0},assessments:[],imports:[],proposal:null,controls:[],controlLimitReached:false,members:[{role:'OWNER',user:{id:user,email:'owner@example.invalid'}}],evidence:[],connectors:[],taskLimitReached:false,sourceImpact:{tasks:[],limitReached:false},features:{programme:false,ai:false,connectors:false,microsoft365:false,googleWorkspace:false,gitlab:false,cloudflare:false,companiesHouse:false,vercel:false,supabase:false,automation:false},generatedAt,
  journey:{organizationId,generatedAt,steps,nextAction:{key:'scope',title:'Business scope',detail:steps[0].detail,href:steps[0].href,label:steps[0].actionLabel},facts:{profileVersion:null,selectedSources:1,latestCapturedSources:0,latestSourcesAwaitingReview:0,sourceFailures:0,monitoringActive:false,eligibleOtherReviewers:1,totalTasks:tasks.length,assignedOpenTasks:tasks.length,unassignedOpenTasks:0,cleanFiles:0,pendingFiles:0,independentlyApprovedFiles:0,completedTasks:0,completionExceptions:0,recordedCompletions:0},limits:{membershipLimited:false,sourceRecordsLimited:false,completionRecordsLimited:false},notice:'This is saved work and outstanding actions, not a compliance score or an audit opinion.'}};
}

export async function todayJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 let actor=session(user,'owner@example.invalid'),newCustomer=true,onlyOther=false,failNext=false,mismatchNext=false,holdNext=false,writes=0;
 let releaseHeld,heldReady,heldFinished;
 await context.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:actor});
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:actor.user}}));
 await context.route('**/api/ai/context',route=>{
  assert.equal(route.request().method(),'GET');
  return route.fulfill({json:{email:actor.user.email,userId:newCustomer?null:actor.user.id,organisations:newCustomer?[]:onlyOther?[{id:other,name:'Second company',role:'OWNER'}]:[{id:org,name:'First company',role:'OWNER'},{id:other,name:'Second company',role:'OWNER'}]}});
 });
 await context.route('**/api/workspace/operations*',async route=>{
  const request=route.request();if(request.method()!=='GET'){writes++;throw Error('Reading Today must not issue mutations');}
  const requested=new URL(request.url()).searchParams.get('organizationId');requests.push(requested);
  assert.ok([org,other].includes(requested));
  if(failNext){failNext=false;return route.fulfill({status:503,json:{error:'Fictional operations service temporarily unavailable.'}});}
  if(mismatchNext){mismatchNext=false;return route.fulfill({json:workspace(requested===org?other:org)});}
  const hold=holdNext&&requested===org;
  if(hold){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;heldReady();});}
  try{await route.fulfill({json:workspace(requested)});}catch{}finally{if(hold)heldFinished();}
 });
 try{
  await page.goto(base+'/team/operations');
  await page.getByRole('heading',{name:'Start with your organisation',exact:true}).waitFor();
  assert.equal(requests.length,0,'a verified account without application membership must not request private organisation data');
  assert.equal(await page.getByRole('link',{name:'Set up your organisation →',exact:true}).getAttribute('href'),'/team/setup');
  assert.equal(await page.getByRole('form',{name:'Email sign-in',exact:true}).count(),0,'a new verified customer should not be told to sign in again');
  await mkdir('artifacts/usability',{recursive:true});
  await page.screenshot({path:'artifacts/usability/today-'+name+'-first-use.png',fullPage:true});

  newCustomer=false;
  await page.goto(base+'/team/operations?'+new URLSearchParams({organizationId:org}));
  await page.getByRole('region',{name:'Your workspace journey',exact:true}).waitFor();
  const mainNav=page.getByRole('navigation',{name:'Main workspace',exact:true});
  assert.equal(await mainNav.getByRole('link').count(),5);
  assert.equal(await mainNav.getByRole('link',{name:'Today',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(new URL(await mainNav.getByRole('link',{name:'Reports',exact:true}).getAttribute('href'),base).searchParams.get('organizationId'),org);
  const actions=page.getByRole('region',{name:'What do you need to do?'});
  assert.equal(new URL(await actions.getByRole('link',{name:'Record a deviation'}).getAttribute('href'),base).searchParams.get('organizationId'),org);
  const opener=page.getByRole('button',{name:'Find a tool',exact:true});
  await opener.click();
  const finder=page.getByRole('dialog',{name:'Find a workspace tool'});
  await finder.getByRole('searchbox').fill('temperature excursion');
  const route=new URL(await finder.getByRole('link',{name:'Deviations & CAPA'}).getAttribute('href'),base);
  assert.equal(route.pathname,'/team/quality');assert.equal(route.searchParams.get('organizationId'),org);
  await finder.getByRole('button',{name:'Close'}).click();
  const nextStep=page.getByRole('region',{name:'Recommended next step',exact:true});
  await nextStep.getByRole('heading',{name:'Business scope',exact:true}).waitFor();
  assert.equal(new URL(await nextStep.getByRole('link',{name:/Set up your business/}).getAttribute('href'),base).searchParams.get('organizationId'),org);
  const progress=page.getByRole('region',{name:'Your workspace journey',exact:true});
  assert.equal(await progress.getByRole('listitem').count(),6);
  await progress.getByText(/Background monitoring awaits activation/).waitFor();
  const queue=page.getByRole('region',{name:'Prioritised next actions',exact:true});
  assert.equal(await queue.getByRole('link').filter({hasText:/Fictional first-company task/}).count(),5);
  await queue.getByRole('button',{name:'Show all 7 loaded actions',exact:true}).click();
  const queueLinks=queue.getByRole('link').filter({hasText:/Fictional first-company task/});
  assert.equal(await queueLinks.count(),7);
  for(const item of await queueLinks.all()){
   const url=new URL(await item.getAttribute('href'),base);assert.equal(url.pathname,'/team/work');assert.equal(url.searchParams.get('organizationId'),org);assert.ok(url.searchParams.get('taskId'));
  }
  await queue.getByRole('button',{name:'Show the first five',exact:true}).click();
  await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement?.tagName),'BODY');
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
  assert.ok(overflow<=3,'Today horizontal overflow '+overflow+'px');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'artifacts/usability/today-'+name+'-workspace.png',fullPage:true});

  failNext=true;await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await page.getByText('Fictional operations service temporarily unavailable.',{exact:true}).waitFor();
  assert.equal(await progress.count(),0,'failed refresh clears old private overview');
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await progress.waitFor();
  mismatchNext=true;await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await page.getByText('The workspace response does not match the selected organisation.',{exact:true}).waitFor();
  assert.equal(await progress.count(),0,'mismatched response never displays another company journey');
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await progress.waitFor();

  holdNext=true;const held=new Promise(resolve=>{heldReady=resolve;}),finished=new Promise(resolve=>{heldFinished=resolve;});
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await held;
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(other);
  await page.getByText('Second company has its own scope and no inherited work.',{exact:true}).first().waitFor();
  releaseHeld();await finished;
  assert.equal(await page.getByText('Fictional first-company task 0',{exact:false}).count(),0,'late first-company data cannot reappear after switching');
  assert.equal(new URL(page.url()).searchParams.get('organizationId'),other);
  assert.equal(new URL(await mainNav.getByRole('link',{name:'Reports',exact:true}).getAttribute('href'),base).searchParams.get('organizationId'),other);

  const beforeUnavailable=requests.length;
  await page.goto(base+'/team/operations?'+new URLSearchParams({organizationId:unavailable}));
  await page.getByText(/The linked organisation is unavailable/).waitFor();
  assert.equal(requests.length,beforeUnavailable,'missing requested organisation cannot silently fall back');
  assert.equal(await progress.count(),0);
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(org);await progress.waitFor();

  actor=session(otherUser,'second-owner@example.invalid');onlyOther=true;
  await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key:storageKey,value:actor});
  await page.getByText(/The linked organisation is unavailable/).waitFor();
  assert.equal(await page.getByText('Fictional first-company task 0',{exact:false}).count(),0,'account change clears previous private content');
  assert.equal(await progress.count(),0);
  await page.evaluate(key=>{localStorage.removeItem(key);const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();},storageKey);
  await page.getByRole('heading',{name:'Welcome to RegPilot',exact:true}).waitFor();
  await page.getByRole('form',{name:'Email sign-in',exact:true}).waitFor();
  assert.equal(await progress.count(),0);assert.equal(writes,0);assert.deepEqual(errors,[]);
  return {scenario:'today-'+name,passed:true,overflowPx:overflow,fixture:'fictional identity and API responses; private-services journey verifies persistence separately',checks:['new verified account reaches organisation setup','six factual journey milestones and explicit inactive monitoring','one bounded expandable priority queue','exact organisation/task/report handoffs','refresh error and mismatched response clear private data','late organisation response cannot restore prior content','unknown organisation never falls back','account change and sign-out clear private data','read-only overview makes no mutations']};
 }catch(error){
  releaseHeld?.();await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/today-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw error;
 }finally{await context.close();}
}
