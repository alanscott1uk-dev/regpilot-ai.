// Browser-only fictional session and API fixtures. This is UI acceptance, never live authentication evidence.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
export async function setupJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001';
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 let role='OWNER',writes=0,captures=0;
 const payloads=[];
 const data={role,profile:null,watches:[],independentReviewers:1,evidence:{total:0,approved:0},controls:0,openTasks:0,
 catalogue:[{id:'uk-data-protection',title:'Fictional data protection publication',agency:'Fictional publisher',path:'/fictional-publication',activities:['personal-data'],jurisdictions:['Scotland']},...Array.from({length:12},(_,i)=>({id:'fictional-extra-'+i,title:'Fictional medicines publication '+String(i).padStart(2,'0'),agency:'Fictional publisher',path:'/fictional-extra-'+i,activities:['medicines'],jurisdictions:['Scotland']}))],
 coverage:[{sourceId:'uk-data-protection',snapshotId:null,reviewStatus:null,schedule:null,monitoring:'Not scheduled'}],
 connections:{observed:0,total:0,needsAttention:0,listLimitReached:false},features:{monitoring:false,evidence:false,providers:[]},generatedAt:new Date().toISOString()};
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:session.user})}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Fictional acceptance company',role}]}}));
 await context.route('**/api/workspace/setup*',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();payloads.push(body);writes++;
   data.profile={activities:body.activities,jurisdictions:body.jurisdictions,version:1};data.watches=[{sourceId:'uk-data-protection',enabled:true,intervalHours:body.intervalHours,version:1}];
   await route.fulfill({json:{created:1,updated:0,unchanged:0,profileVersion:1}});
  }else await route.fulfill({json:{...data,role}});
 });
 await context.route('**/api/workspace/sources',route=>{captures++;return route.fulfill({status:503,json:{error:'Fictional source unavailable; no baseline stored'}});});
 try{
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
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('You can inspect setup.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save profile and schedules',exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:/Capture selected sources/}).isEnabled(),false);
  assert.deepEqual(errors,[]);
  return {scenario:'setup-'+name,passed:true,fixture:'fictional browser session and API responses; backend tested separately',writes,captures,overflowPx:overflow};
 }finally{await context.close();}
}
