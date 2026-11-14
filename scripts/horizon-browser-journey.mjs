import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
/** Fictional UI fixtures only; live discovery is verified by the separate public job. */
export async function horizonJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',task='123e4567-e89b-42d3-a456-426614174002';
 const now=new Date().toISOString(),session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 const ids=['mhra','home-office','hmrc','companies-house','business-trade','cma','environment-agency','defra','dwp','product-safety','dsit','dhsc'];
 const report={format:'regpilot-horizon-v1',generatedAt:now,windowStart:now,codeCommit:null,runId:null,previousAvailable:false,feeds:ids.map(id=>({id,state:'available',checkedAt:now,total:3,retrieved:3,reason:null})),items:Array.from({length:32},(_,i)=>({id:i.toString(16).padStart(32,'0'),revision:'b'.repeat(32),path:'/guidance/fictional-'+i,url:'https://www.gov.uk/guidance/fictional-'+i,title:'Fictional publication '+String(i).padStart(2,'0'),summary:'Fictional official metadata for UI acceptance. Not a real publication.',documentType:'detailed_guide',kind:'Guidance',publisherIds:['mhra'],updatedAt:now,firstSeenAt:now,observedAt:now,discovery:'BASELINE'})),pipeline:{cadenceMinutes:60,durationMs:1200,requests:36,retries:2,retentionLimited:false,history:[{generatedAt:new Date(Date.now()-3600000).toISOString(),runId:'1',publications:1440,available:12,limited:0,unavailable:0}]},limitations:['Fictional browser fixture, not live intelligence evidence.']};
 let role='OWNER',writes=0;const payloads=[],decisions=[];
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Fictional horizon workspace',role}]}}));
 await context.route('**/api/horizon',route=>route.fulfill({json:{report,state:'current'}}));
 await context.route('**/api/workspace/horizon*',async route=>{
  if(route.request().method()==='POST'){writes++;const body=route.request().postDataJSON();payloads.push(body);const d={itemId:body.itemId,revision:body.revision,state:body.action==='queue'?'queued':'dismissed',taskId:body.action==='queue'?task:null,notes:body.notes};decisions.push(d);return route.fulfill({json:{...d,reused:false}});}
  return route.fulfill({json:{role,members:[{id:user,email:session.user.email}],activities:['medicines'],decisions,limited:false}});
 });
 try{
  await page.goto(base+'/horizon',{waitUntil:'domcontentloaded'});await page.getByText('Assign owned reviews or record a dismissal.').waitFor();
  await page.getByText(/Collection reliability · 36 reads/).click();await page.getByRole('link',{name:/Machine-readable collection health/}).waitFor();
  const list=page.getByRole('region',{name:'Publications'});assert.equal(await list.getByRole('article').count(),20);
  await page.getByRole('button',{name:'Show 20 more'}).click();assert.equal(await list.getByRole('article').count(),32);
  await page.getByLabel('Search',{exact:true}).fill('Fictional publication 00');assert.equal(await list.getByRole('article').count(),1);
  await page.getByRole('button',{name:'Review publication',exact:true}).click();
  const create=page.getByRole('button',{name:'Create review task'});assert.equal(await create.isEnabled(),false);
  await page.getByLabel('Rationale / what needs checking').fill('Check this fictional guidance against our medicines activity.');
  await page.getByRole('checkbox',{name:/I understand this is a review decision/}).check();await create.click();
  await page.getByRole('status').filter({hasText:'Review task created'}).waitFor();assert.equal(writes,1);assert.equal(payloads[0].ownerId,user);assert.equal(payloads[0].itemId,report.items[0].id);assert.equal(payloads[0].reviewAcknowledged,true);
  await page.getByRole('link',{name:'Open assigned review'}).waitFor();
  await page.getByLabel('Awaiting a decision').check();assert.equal(await list.getByRole('article').count(),0);
  await page.getByLabel('Awaiting a decision').uncheck();await page.getByLabel('Search',{exact:true}).fill('');
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'horizon overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/horizon-'+name+'.png',fullPage:true});
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Read-only workspace access.').waitFor();assert.equal(await page.getByRole('button',{name:'Review publication',exact:true}).first().isEnabled(),false);
  assert.deepEqual(errors,[]);return {scenario:'horizon-'+name,passed:true,overflowPx:overflow,steps:10,testType:'fictional UI fixture; no live tenant assertion'};
 }finally{await context.close();}
}
