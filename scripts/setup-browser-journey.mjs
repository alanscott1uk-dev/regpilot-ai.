// Browser-only fictional session and API fixtures. This is UI acceptance, never live authentication evidence.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
export async function setupJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001';
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
 let actor=session;
 await context.addInitScript(value=>{if(!localStorage.getItem('sb-auth-fixture-auth-token'))localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value));},session);
 let role='OWNER',writes=0,captures=0,reads=0,holdNext=false,heldReady,heldFinished,releaseHeld;
 const payloads=[];
 const data={role,profile:null,watches:[],independentReviewers:1,evidence:{total:0,approved:0},controls:0,openTasks:0,
 catalogue:[{id:'uk-data-protection',title:'Fictional data protection publication',agency:'Fictional publisher',path:'/fictional-publication',activities:['personal-data'],jurisdictions:['Scotland']},...Array.from({length:12},(_,i)=>({id:'fictional-extra-'+i,title:'Fictional medicines publication '+String(i).padStart(2,'0'),agency:'Fictional publisher',path:'/fictional-extra-'+i,activities:['medicines'],jurisdictions:['Scotland']}))],
 coverage:[{sourceId:'uk-data-protection',snapshotId:null,reviewStatus:null,schedule:null,monitoring:'Not scheduled'}],
 connections:{observed:0,total:0,needsAttention:0,listLimitReached:false},features:{monitoring:false,evidence:false,providers:[]},generatedAt:new Date().toISOString()};
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:actor.user})}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:actor.user.email,userId:actor.user.id,organisations:[{id:org,name:'Fictional acceptance company',role}]}}));
 await context.route('**/api/workspace/setup*',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();payloads.push(body);writes++;
   data.profile={activities:body.activities,jurisdictions:body.jurisdictions,version:1};data.watches=[{sourceId:'uk-data-protection',enabled:true,intervalHours:body.intervalHours,version:1}];
   await route.fulfill({json:{created:1,updated:0,unchanged:0,profileVersion:1}});
  }else {
   reads++;assert.equal(new URL(route.request().url()).searchParams.get('organizationId'),org);
   const payload=structuredClone({...data,role}),held=holdNext;
   if(held){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;heldReady();});}
   try{await route.fulfill({json:payload});}catch{}finally{if(held)heldFinished();}
  }
 });
 await context.route('**/api/workspace/sources',route=>{captures++;return route.fulfill({status:503,json:{error:'Fictional source unavailable; no baseline stored'}});});
 try{
  await accountingJourney(context,page,base,org);
  await page.goto(base+'/team/setup',{waitUntil:'domcontentloaded'});
  const save=page.getByRole('button',{name:'Save profile and schedules',exact:true});await save.waitFor();
  assert.equal(await save.isEnabled(),false,'empty setup cannot save');
  const choices=page.getByRole('region',{name:'Publication choices'});assert.equal(await choices.getByRole('article').count(),8,'large catalogues start with a bounded list');
  await page.getByLabel('Search publications').fill('publication 11');await choices.getByText('Fictional medicines publication 11',{exact:true}).waitFor();
  await page.getByLabel('Search publications').fill('');
  await page.getByRole('checkbox',{name:'Handling personal data',exact:true}).check();
  await page.getByRole('checkbox',{name:'Scotland',exact:true}).check();
  await page.getByRole('button',{name:/Select suggested sources/}).click();
  assert.equal(await save.isEnabled(),false,'review acknowledgement is required');
  await page.getByRole('checkbox',{name:/I have reviewed this profile/}).check();
  await save.click();await page.getByRole('status').filter({hasText:'Setup saved.'}).waitFor();
  assert.equal(writes,1);assert.deepEqual(payloads[0],{organizationId:org,profileVersion:0,activities:['personal-data'],jurisdictions:['Scotland'],sources:[{sourceId:'uk-data-protection',version:0}],intervalHours:24,reviewAcknowledged:true});
  await page.getByRole('button',{name:/Capture selected sources/}).click();
  await page.getByRole('list',{name:'Capture results'}).getByText(/Fictional source unavailable/).waitFor();assert.equal(captures,1,'failed capture is not automatically retried');
  await page.getByText('Background monitoring awaiting activation',{exact:true}).waitFor();
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'setup overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/setup-'+name+'.png',fullPage:true});
  holdNext=true;const held=new Promise(resolve=>{heldReady=resolve;}),finished=new Promise(resolve=>{heldFinished=resolve;});
  await page.getByRole('button',{name:'Reload saved setup',exact:true}).click();await held;
  // Account replacement retains membership of the same organisation but changes
  // the permitted role. A concurrent saved-profile change makes stale data visible.
  role='VIEWER';data.profile={activities:['medicines'],jurisdictions:['Scotland'],version:2};
  const otherUser='123e4567-e89b-42d3-a456-426614174003';
  actor={...session,access_token:'fixture.'+Buffer.from(JSON.stringify({sub:otherUser,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',user:{...session.user,id:otherUser,email:'viewer@example.invalid'}};
  await page.evaluate(value=>{localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value));const channel=new BroadcastChannel('sb-auth-fixture-auth-token');channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},actor);
  await page.getByText('You can inspect setup.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Medicines',exact:true}).isChecked(),true);
  releaseHeld();await finished;
  assert.equal(await page.getByRole('checkbox',{name:'Medicines',exact:true}).isChecked(),true,'late response from prior account cannot replace current profile');
  assert.equal(await page.getByRole('checkbox',{name:'Handling personal data',exact:true}).isChecked(),false);
  assert.equal(await page.getByRole('button',{name:'Save profile and schedules',exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:/Capture selected sources/}).isEnabled(),false);
  for(const item of await page.getByRole('link').all()){
   const href=await item.getAttribute('href');
   if(href?.startsWith('/team/'))assert.equal(new URL(href,base).searchParams.get('organizationId'),org,'setup handoffs retain the active organisation');
  }
  const beforeUnavailable=reads;
  await page.goto(base+'/team/setup?organizationId=123e4567-e89b-42d3-a456-426614174099');
  await page.getByText(/The linked organisation is unavailable/).waitFor();
  assert.equal(reads,beforeUnavailable,'setup cannot fall back to the first available organisation');
  assert.equal(await page.getByRole('region',{name:'Publication choices',exact:true}).count(),0);
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(org);
  await page.getByRole('region',{name:'Publication choices',exact:true}).waitFor();
  await page.evaluate(()=>{localStorage.removeItem('sb-auth-fixture-auth-token');const channel=new BroadcastChannel('sb-auth-fixture-auth-token');channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();});
  await page.getByRole('form',{name:'Email sign-in',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Publication choices',exact:true}).count(),0,'sign-out clears saved scope, source choices and private progress');
  assert.deepEqual(errors,[]);
  return {scenario:'setup-'+name,passed:true,fixture:'fictional browser session and API responses; backend tested separately',writes,captures,overflowPx:overflow};
 }finally{releaseHeld?.();await context.close();}
}

async function accountingJourney(context,page,base,org){
 const state={organizationId:org,serviceIds:[],available:['freeagent'],canManage:true};
 const operations=[];let connected=true;
 await context.route('**/api/workspace/accounting-software*',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:state});
  const input=route.request().postDataJSON();operations.push(input.action);
  assert.equal(input.organizationId,org);assert.equal(input.provider,'freeagent');
  const common={organizationId:org,provider:'freeagent'},checkedAt=new Date().toISOString();
  if(input.action==='ADD'){state.serviceIds=['freeagent'];return route.fulfill({json:{type:'workspace',workspace:state}});}
  if(input.action==='AUTHORISE')return route.fulfill({json:{type:'consent',...common,link:'https://connect.nango.dev/?session_token=fixture',expiresAt:checkedAt}});
  if(input.action==='VERIFY'){assert.equal(input.reference,'fictional');return route.fulfill({json:{type:'business',...common,connectionId:'fixture',name:'Fictional Books Ltd',reference:input.reference,checkedAt}});}
  if(input.action==='DISCONNECT'){assert.equal(input.confirm,true);connected=false;}
  return route.fulfill({json:{type:'grants',...common,grants:connected?[{id:'fixture',state:'authorised',lastCheck:null}]:[],checkedAt}});
 });
 await page.goto(base+'/team/accounting?organizationId='+org);
 await page.getByLabel('Accounting package',{exact:true}).selectOption('freeagent');
 await page.getByRole('button',{name:'Add to workspace',exact:true}).click();
 const card=page.getByRole('region',{name:'FreeAgent',exact:true});
 await card.getByRole('button',{name:'Start authorisation'}).click();
 assert.equal(await card.getByRole('link',{name:'Continue to FreeAgent authorisation'}).getAttribute('referrerpolicy'),'no-referrer');
 await card.getByRole('button',{name:'Check connections'}).click();
 await card.getByLabel('FreeAgent business subdomain').fill('fictional');
 await card.getByRole('button',{name:'Check business identity'}).click();
 await card.getByText('Fictional Books Ltd',{exact:true}).waitFor();
 await card.getByRole('button',{name:'Disconnect authorisation'}).click();
 await card.getByRole('button',{name:'Confirm disconnect'}).click();
 await card.getByText(/0 connections\./).waitFor();
 assert.deepEqual(operations,['ADD','AUTHORISE','CHECK','VERIFY','DISCONNECT']);
}
