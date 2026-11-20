import assert from 'node:assert/strict';
import {checkAccessibility} from './browser-accessibility.mjs';
import {mkdir} from 'node:fs/promises';
function horizonFixture(now){
 const ids=['mhra','home-office','hmrc','companies-house','business-trade','cma','environment-agency','defra','dwp','product-safety','dsit','dhsc'];
 const report={format:'regpilot-horizon-v1',generatedAt:now,windowStart:now,codeCommit:null,runId:null,previousAvailable:false,feeds:ids.map(id=>({id,state:'available',checkedAt:now,total:3,retrieved:3,reason:null})),items:Array.from({length:32},(_,i)=>({id:i.toString(16).padStart(32,'0'),revision:'b'.repeat(32),path:'/guidance/fictional-'+i,url:'https://www.gov.uk/guidance/fictional-'+i,title:'Fictional publication '+String(i).padStart(2,'0'),summary:'Fictional official metadata for UI acceptance. Not a real publication.',documentType:'detailed_guide',kind:'Guidance',publisherIds:['mhra'],updatedAt:now,firstSeenAt:now,observedAt:now,discovery:'BASELINE'})),pipeline:{cadenceMinutes:60,durationMs:1200,requests:36,retries:2,retentionLimited:false,history:[{generatedAt:new Date(Date.now()-3600000).toISOString(),runId:'1',publications:1440,available:12,limited:0,unavailable:0}]},limitations:['Fictional browser fixture, not live intelligence evidence.']};
 Object.assign(report.items[1],{summary:'Fictional GMP and batch release notice.',discovery:'FIRST_SEEN'});
 Object.assign(report.items[2],{summary:'Fictional GMPX release notice.',discovery:'FIRST_SEEN'});
 Object.assign(report.items[3],{summary:'Fictional cold-chain notice from an earlier week.',discovery:'METADATA_UPDATED',updatedAt:new Date(Date.now()-9*86400000).toISOString()});
 return report;
}

/** Fictional UI fixtures only; live discovery is verified by the separate public job. */
export async function horizonJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',task='123e4567-e89b-42d3-a456-426614174002';
 const now=new Date().toISOString(),session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 const report=horizonFixture(now);
 let role='OWNER',writes=0;const payloads=[],decisions=[],watchlists=[],watchWrites=[];
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Fictional horizon workspace',role}]}}));
 await context.route('**/api/horizon',route=>route.fulfill({json:{report,state:'current'}}));
 await context.route('**/api/workspace/horizon*',async route=>{
  if(route.request().method()==='POST'){
   writes++;const body=route.request().postDataJSON();payloads.push(body);
   const watch=watchlists.find(row=>row.id===body.watchlist?.id);
   const d={itemId:body.itemId,revision:body.revision,state:body.action==='queue'?'queued':'dismissed',taskId:body.action==='queue'?task:null,notes:body.notes,
    ...(watch?{watchlist:{id:watch.id,name:watch.name,version:watch.version,filters:watch.filters,matchedPhrase:'gmp'}}:{})};
   decisions.push(d);return route.fulfill({json:{...d,reused:false}});
  }
  return route.fulfill({json:{role,watchlists,members:[{id:user,email:session.user.email}],activities:['medicines'],decisions,limited:false}});
 });
 await context.route('**/api/workspace/horizon/watchlists?*',async route=>{
  const request=route.request(), body=request.postDataJSON();
  assert.equal(request.method(),'POST');
  assert.equal(new URL(request.url()).searchParams.get('organizationId'),org);
  assert.equal(role,'OWNER');watchWrites.push(body);
  const previous=watchlists.find(row=>row.id===body.id);
  if(body.version!==(previous?.version??0))return route.fulfill({status:409,json:{error:'This watchlist changed. Reload the workspace watchlists before saving.'}});
  const saved=body.action==='archive'?{...previous,archived:true,version:body.version+1}:{id:body.id,version:body.version+1,name:body.name,filters:body.filters,archived:false};
  if(previous)watchlists.splice(watchlists.indexOf(previous),1);
  if(!saved.archived)watchlists.push(saved);
  return route.fulfill({json:saved});
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
  const search=page.getByLabel('Search',{exact:true}), shared=page.getByRole('region',{name:'Shared watchlists'});
  const heading=page.getByRole('heading',{name:'Fictional publication 01 ↗'});
  await search.fill('GMP, cold chain');
  await page.getByLabel('Publisher',{exact:true}).selectOption('mhra');
  await page.getByLabel('Publisher updated').selectOption('week');
  await page.getByLabel('New or updated in this collection').check();
  await page.getByLabel('Awaiting a decision').check();
  await heading.waitFor();
  assert.equal(await list.getByRole('article').count(),1);
  await shared.getByText('Save these filters for your team').click();
  await shared.getByLabel('Watchlist name').fill('Medicines this week');
  await shared.getByRole('button',{name:'Save new watchlist'}).click();
  await shared.getByText('Shared watchlist saved.').waitFor();
  const url=new URL(await shared.getByRole('link',{name:'Link to saved watchlist'}).getAttribute('href'),base);
  assert.equal(url.searchParams.get('organizationId'),org);
  assert.equal(url.searchParams.get('watchlistId'),watchlists[0].id);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'horizon overflow '+overflow);
  await checkAccessibility(page,'artifacts/usability/horizon-accessibility-'+name+'.json');
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/horizon-'+name+'.png',fullPage:true});
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await shared.getByRole('link',{name:'Link to saved watchlist'}).waitFor();
  assert.equal(await search.inputValue(),'gmp, cold chain');
  assert.equal(await page.getByLabel('Publisher updated').inputValue(),'week');
  assert.equal(await page.getByLabel('New or updated in this collection').isChecked(),true);
  assert.equal(await list.getByRole('article').count(),1);
  await shared.getByText('Manage saved watchlist').click();
  // A concurrent admin edit must be acknowledged before replacing its criteria.
  Object.assign(watchlists[0],{version:2,name:'Reviewed by another admin'});
  await shared.getByLabel('Watchlist name').fill('Medicines and release');
  await shared.getByRole('button',{name:'Update watchlist'}).click();
  await shared.getByRole('alert').filter({hasText:'This watchlist changed.'}).waitFor();
  await shared.getByRole('button',{name:'Refresh watchlists'}).click();
  await shared.getByText('Workspace watchlists refreshed.').waitFor();
  assert.equal(await shared.getByLabel('Watchlist name').inputValue(),'Reviewed by another admin');
  await shared.getByLabel('Watchlist name').fill('Medicines and release');
  await shared.getByRole('button',{name:'Update watchlist'}).click();
  await shared.getByText('Shared watchlist saved.').waitFor();
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('Read-only workspace access.').waitFor();
  await shared.getByRole('link',{name:'Link to saved watchlist'}).waitFor();
  assert.equal(await shared.getByText('Manage saved watchlist').count(),0);
  assert.equal(await list.getByRole('article').count(),1);
  assert.equal(await page.getByRole('button',{name:'Review publication',exact:true}).first().isEnabled(),false);
  assert.equal(watchWrites.length,3);
  role='OWNER';await page.reload({waitUntil:'domcontentloaded'});
  await shared.getByRole('link',{name:'Link to saved watchlist'}).waitFor();
  await page.getByRole('button',{name:'Review publication',exact:true}).click();
  await page.getByLabel('Rationale / what needs checking').fill('Reviewed this fictional release notice for applicability.');
  await page.getByRole('checkbox',{name:/I understand this is a review decision/}).check();
  await page.getByRole('button',{name:'Dismiss this revision'}).click();
  await page.getByRole('status').filter({hasText:'was dismissed'}).waitFor();
  assert.equal(await list.getByRole('article').count(),0);
  assert.deepEqual(payloads[1].watchlist,{id:watchlists[0].id,version:3});
  await page.getByLabel('Awaiting a decision').uncheck();
  await list.getByText(/Reviewed from Medicines and release, version 3/).waitFor();
  await shared.getByText('Manage saved watchlist').click();
  await shared.getByRole('button',{name:'Archive watchlist',exact:true}).click();
  await shared.getByRole('button',{name:'Confirm archive of Medicines and release'}).click();
  await shared.getByText('Watchlist archived.').waitFor();
  assert.equal(watchlists.length,0);
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await shared.getByRole('alert').filter({hasText:'unavailable in this workspace'}).waitFor();
  assert.equal(writes,2);assert.deepEqual(watchWrites.map(row=>row.version),[0,1,2,3]);
  assert.deepEqual(errors,[]);return {scenario:'horizon-'+name,passed:true,overflowPx:overflow,steps:21,testType:'fictional UI fixture; no live tenant assertion'};
 }finally{await context.close();}
}

// Only public publication metadata is supplied by a fixture. Both accounts,
// their memberships, the Next.js routes and the PostgreSQL writes are real.
export async function authenticatedHorizonWatchlist({review,upload,app,org,otherOrgId,db,checkpoint,passed}) {
 await checkpoint('share a medicines watchlist between two signed-in accounts');
 const ownerPage=await review.context().newPage(),editorPage=await upload.context().newPage();
 const report=horizonFixture(new Date().toISOString());
 const publicationFeed=route=>route.fulfill({json:{report,state:'current'}});
 const region=page=>page.getByRole('region',{name:'Shared watchlists',exact:true});
 try {
  await Promise.all([ownerPage.route('**/api/horizon',publicationFeed),editorPage.route('**/api/horizon',publicationFeed)]);
  await ownerPage.goto(app+'/horizon?organizationId='+org.id);
  const owner=region(ownerPage),editor=region(editorPage);
  await owner.getByText('Save these filters for your team').waitFor();
  await ownerPage.getByLabel('Search',{exact:true}).fill('GMP, cold chain');
  await ownerPage.getByLabel('Publisher',{exact:true}).selectOption('mhra');
  await ownerPage.getByLabel('Publisher updated',{exact:true}).selectOption('week');
  await owner.getByText('Save these filters for your team').click();
  await owner.getByLabel('Watchlist name').fill('Fictional medicines bulletin');
  await owner.getByRole('button',{name:'Save new watchlist',exact:true}).click();
  await owner.getByText('Shared watchlist saved.').waitFor();
  const shared=new URL(await owner.getByRole('link',{name:'Link to saved watchlist'}).getAttribute('href'),app);
  const id=shared.searchParams.get('watchlistId');
  const where={organizationId_id:{organizationId:org.id,id}};
  const stored=await db.horizonWatchlist.findUniqueOrThrow({where});
  assert.equal(stored.version,1);
  assert.deepEqual(stored.filters.phrases,['gmp','cold chain']);
  await editorPage.goto(shared.href);
  await editor.getByRole('link',{name:'Link to saved watchlist'}).waitFor();
  assert.equal(await editorPage.getByLabel('Search',{exact:true}).inputValue(),'gmp, cold chain');
  assert.equal(await editor.getByText('Manage saved watchlist').count(),0);
  await editorPage.getByRole('heading',{name:'Fictional publication 01 ↗'}).waitFor();
  assert.equal(await editorPage.getByRole('region',{name:'Publications',exact:true}).getByRole('article').count(),1);
  const other=new URL(shared);other.searchParams.set('organizationId',otherOrgId);
  await editorPage.goto(other.href);
  await editor.getByRole('alert').filter({hasText:'unavailable in this workspace'}).waitFor();
  assert.equal(await editor.getByRole('option',{name:stored.name}).count(),0);
  const archive=owner.getByRole('button',{name:'Archive watchlist',exact:true});
  if(!await archive.isVisible())await owner.getByText('Manage saved watchlist').click();
  await archive.click();
  await owner.getByRole('button',{name:'Confirm archive of '+stored.name,exact:true}).click();
  await owner.getByText('Watchlist archived.').waitFor();
  await editorPage.goto(shared.href);
  await editor.getByRole('alert').filter({hasText:'unavailable in this workspace'}).waitFor();
  const archived=await db.horizonWatchlist.findUniqueOrThrow({where});
  assert.equal(archived.version,2);assert.equal(archived.archived,true);
  assert.equal(await db.auditEvent.count({where:{organizationId:org.id,entityType:'HorizonWatchlist',entityId:id}}),2);
  passed('An owner saved a weekly MHRA watchlist through the real app. A signed-in editor opened its matching publication, could not access the watchlist in their other workspace, and saw its archive take effect.');
  return {watchlistId:id,versions:2,matchedPublications:1,isolatedWorkspaces:2,publicMetadata:'fixture'};
 } finally {
  await Promise.all([ownerPage.close(),editorPage.close()]);
 }
}
