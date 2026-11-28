import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
// Fictional API responses exercise the real UI; database authorization has separate integration tests.
export async function changeResponseJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',other='123e4567-e89b-42d3-a456-426614174009',user='123e4567-e89b-42d3-a456-426614174001',reviewer='123e4567-e89b-42d3-a456-426614174008',response='123e4567-e89b-42d3-a456-426614174002',action='123e4567-e89b-42d3-a456-426614174003',run='123e4567-e89b-42d3-a456-426614174004',now=new Date().toISOString();
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 let asReviewer=false,submission=null,status='OPEN',responseStatus='ACTIVE',version=1;const writes=[];
 const observation={id:run,connectorId:'fixture-connection',configuredById:'fixture-configurer',label:'Fictional training system',provider:'GITHUB',configVersion:1,resultHash:'a'.repeat(64),signalHash:'b'.repeat(64),capturedAt:now,sourceUrl:'https://github.com/fictional/training',engine:'fictional-v1',checks:[{id:'approval',label:'Approval setting',status:'PASS',observed:'Recorded approval present',nextStep:'Check its relevance to this requirement.'}],limitations:['Fictional collection; no assertion about live providers.']};
 await context.route('https://auth-fixture.example.invalid/**',r=>r.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/analyse',r=>r.fulfill({json:{workspaceEnabled:true}}));
 await context.route('**/api/ai/context',r=>r.fulfill({json:{email:session.user.email,userId:asReviewer?reviewer:user,organisations:[{id:other,name:'Other fictional workspace',role:'EDITOR'},{id:org,name:'Requested fictional workspace',role:asReviewer?'ADMIN':'EDITOR'}]}}));
 await context.route(/\/api\/workspace\/changes(?:\/|\?)/,async r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.method()==='PATCH'){const b=req.postDataJSON();writes.push(b);if(b.action==='SUBMIT'){submission={notes:b.notes,files:[],observations:[observation],mappings:[],submittedAt:now};status='SUBMITTED';}else if(b.action==='ACCEPT')status='ACCEPTED';else responseStatus='RESOLVED';version++;return r.fulfill({json:{id:action}});}
  if(url.pathname==='/api/workspace/changes')return r.fulfill({json:{responses:url.searchParams.get('organizationId')===org?[{id:response,title:'Fictional training response',status:'ACTIVE',createdAt:now,_count:{actions:1}}]:[],sources:[],evidence:[],admin:asReviewer,enabled:true}});
  assert.equal(url.searchParams.get('organizationId'),org,'deep link keeps the requested organisation');
  return r.fulfill({json:{response:{id:response,title:'Fictional training response',status:responseStatus,version,createdAt:now},actions:[{id:action,version,status,taskId:'task',task:{assigneeId:user,ownerName:'Fictional action owner',dueDate:now},control:{title:'Training approval'},requirements:[],blockers:[],history:[],submission,submittedById:submission?user:null,current:true,reviewNotes:''}],plan:{source:{contentHash:'a'.repeat(64)}},dependencies:{policies:[],suppliers:[],audits:[]},resolutionCurrent:responseStatus==='RESOLVED',blockers:status==='ACCEPTED'?[]:['An action still needs independent acceptance'],contextHash:'c'.repeat(64),observationChoices:{[action]:[observation]}}});
 });
 try{
  await page.goto(base+'/team/changes?organizationId='+org+'&responseId='+response+'&actionId='+action,{waitUntil:'domcontentloaded'});
  const card=page.locator('#action-'+action);await card.getByRole('heading',{name:'Training approval',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),org);
  if(viewport.width<1051)assert.equal(await page.getByRole('dialog',{name:'Find a workspace tool'}).isVisible(),false,'tool directory starts closed on mobile');
  await page.waitForFunction(id=>document.activeElement?.id==='action-'+id,action);
  assert.equal(await card.getByRole('button',{name:'Submit for independent acceptance'}).isEnabled(),false);
  await card.getByLabel('Use Fictional training system',{exact:true}).check();await card.getByText(/Fictional training system · Collected/).click();
  await card.getByText('Recorded approval present',{exact:true}).waitFor();await card.getByText('Fictional collection; no assertion about live providers.',{exact:true}).waitFor();
  await card.getByLabel('Resolution and limitations').fill('Reviewed the fictional training setting against the changed requirement and recorded its remaining limitations.');
  await card.getByRole('checkbox',{name:/I checked the current decisions/}).check();await card.getByRole('button',{name:'Submit for independent acceptance'}).click();
  await card.getByText('Submitted resolution and evidence',{exact:true}).waitFor();assert.equal(writes.length,1);assert.deepEqual(writes[0].evidenceIds,[]);assert.deepEqual(writes[0].observationIds,[run]);
  await card.getByText('Next: an independent administrator reviews the submitted evidence.',{exact:true}).waitFor();
  asReviewer=true;await page.reload({waitUntil:'domcontentloaded'});await card.getByLabel('Independent review',{exact:true}).waitFor();
  await card.getByLabel('Independent review',{exact:true}).fill('Independently inspected the fictional connected checks, the requirement decision and the stated collection limitations.');
  await card.getByRole('checkbox',{name:/I inspected the decisions/}).check();await card.getByRole('button',{name:'Accept this action',exact:true}).click();
  await card.getByText('Accepted. The response can close once every action is ready.',{exact:true}).waitFor();assert.equal(writes[1].action,'ACCEPT');
  await page.getByLabel('Overall outcome and downstream review').fill('Independently reviewed every action and confirmed the fictional outcome, recorded evidence and downstream scope.');
  await page.getByRole('checkbox',{name:/I independently reviewed all actions/}).check();await page.getByRole('button',{name:'Close with reviewed outcome',exact:true}).click();
  await page.getByText('The recorded resolution still matches the checked context.',{exact:true}).waitFor();assert.equal(writes.length,3);assert.equal(writes[2].dependenciesReviewed,true);assert.equal(writes[2].confirm,true);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'change response overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/change-response-'+name+'.png',fullPage:true});
  assert.deepEqual(errors,[]);return {scenario:'change-response-'+name,passed:true,steps:15,overflowPx:overflow,testType:'fictional UI fixture; live authorization separately tested'};
 }catch(e){await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/change-response-'+name+'-failure.png',fullPage:true}).catch(()=>{});throw new Error(e.message+'\nClient errors: '+JSON.stringify(errors)+'\nVisible page: '+(await page.locator('body').innerText()).slice(-6000));}finally{await context.close();}
}
