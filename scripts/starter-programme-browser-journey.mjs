// Fictional HTTP/identity fixtures exercise the production programme UI.
// The private-services journey separately verifies task creation and persistence.
import assert from 'node:assert/strict';
import {scopedSecurityProgramme} from '../lib/scoped-security-programme.mjs';
import {mkdir,writeFile} from 'node:fs/promises';

const org='d23e4567-e89b-42d3-a456-426614174000',first='d23e4567-e89b-42d3-a456-426614174001';
const owner='d23e4567-e89b-42d3-a456-426614174002',editor='d23e4567-e89b-42d3-a456-426614174003',viewer='d23e4567-e89b-42d3-a456-426614174004',missing='d23e4567-e89b-42d3-a456-426614174099';
const storageKey='sb-auth-fixture-auth-token',endpoint='/api/workspace/programmes';
const scope='Fictional operational starting points for browser acceptance. Each task requires its normal evidence and review workflow.';
const href=(path,values={})=>path+'?'+new URLSearchParams({organizationId:org,...values});
function session(id){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:id===viewer?'viewer@example.invalid':'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}
const packs=['Business foundations','People and access','Suppliers and continuity'].map((title,index)=>({
 id:['business-foundations','people-access','supplier-continuity'][index],version:1,title,description:'A fictional plan for reviewing a bounded set of operational responsibilities.',
 items:Array.from({length:3},(_,item)=>({key:'fictional-item-'+item,title:'Review fictional '+['business scope','access records','recovery arrangements'][item],description:'Record the actual working arrangements, named responsible person and any unresolved decisions for this fictional exercise.',why:'This work makes the responsibilities and current working arrangements explicit for the selected fictional activity.',evidenceHint:'A dated reviewed record of the observed arrangements and remaining questions.',suggestedDays:7+item*7}))
}));

packs.push(scopedSecurityProgramme);

export async function starterProgrammeJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],reads=[];
 context.setDefaultTimeout(12_000);page.on('pageerror',error=>errors.push(error.message));
 let auth=session(owner),previewPosts=0,applyPosts=0,programmeWrites=0,taskWrites=0,loseApply=false,failRead=false,holdRead=false,releaseRead,readHeld,readFinished;
 const saved=[],tokens=new Map(),now=new Date().toISOString();
 const summary=plan=>({id:plan.id,packId:plan.packId,packVersion:plan.packVersion,name:plan.name,createdAt:plan.createdAt,total:plan.total,completed:0,needsAttention:0,href:href('/team/programmes',{programmeId:plan.id})});
 const workspace=selected=>({organizationId:org,role:auth.user.id===viewer?'VIEWER':'OWNER',canCreate:auth.user.id!==viewer,packs,members:auth.user.id===viewer?[]:[{id:owner,email:'owner@example.invalid'},{id:editor,email:'editor@example.invalid'}],membersLimited:false,programmes:saved.map(summary),programmesLimited:false,selected:selected?saved.find(plan=>plan.id===selected):null});
 await context.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:auth});
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 await context.route('**/api/ai/analyse',route=>route.fulfill({json:{workspaceEnabled:true}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:auth.user.id,email:auth.user.email,organisations:[{id:first,name:'First fictional company',role:auth.user.id===viewer?'VIEWER':'OWNER'},{id:org,name:'Fictional programme company',role:auth.user.id===viewer?'VIEWER':'OWNER'}]}}));
 await context.route(url=>url.pathname===endpoint,async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='GET'){
   assert.equal(url.searchParams.get('organizationId'),org,'programme reads must preserve the requested company');
   const selected=url.searchParams.get('programmeId');reads.push({selected,actor:auth.user.id});
   if(failRead){failRead=false;return route.fulfill({status:503,json:{error:'Fictional saved programme status temporarily unavailable.'}});}
   if(selected&&!saved.some(plan=>plan.id===selected))return route.fulfill({status:404,json:{error:'Starter programme not found in this company'}});
   const body=workspace(selected),held=holdRead;if(held){holdRead=false;await new Promise(resolve=>{releaseRead=resolve;readHeld();});}
   try{await route.fulfill({json:body});}catch{}finally{if(held)readFinished();}return;
  }
  assert.equal(request.method(),'POST');assert.equal(auth.user.id,owner,'read-only account must never submit a programme mutation');
  const body=request.postDataJSON();assert.equal(body.organizationId,org);assert.equal(body.packVersion,1);assert.ok(body.items.length>0);
  assert.ok(body.items.every(item=>item.assigneeId===editor&&item.dueDate),'each selected task needs its chosen owner and date');
  const pack=packs.find(pack=>pack.id===body.packId);assert.ok(pack);
  const items=body.items.map(item=>({...item,evidenceHint:pack.items.find(template=>template.key===item.key).evidenceHint,ownerName:'editor@example.invalid'}));
  if(body.operation==='preview'){
   previewPosts++;const token=previewPosts.toString(16).padStart(64,'0');tokens.set(body.packId,token);
   return route.fulfill({json:{organizationId:org,packId:body.packId,packVersion:1,name:body.name,scopeRationale:body.scopeRationale,items,total:items.length,token,existingProgrammeId:saved.find(plan=>plan.packId===body.packId)?.id||null,scope}});
  }
  assert.equal(body.operation,'apply');assert.equal(body.confirm,true);assert.equal(body.token,tokens.get(body.packId));applyPosts++;
  assert.equal(saved.some(plan=>plan.packId===body.packId),false,'a duplicate creation request must never be sent by recovery');
  const id='d23e4567-e89b-42d3-a456-'+String(426614175000+saved.length);
  const plan={organizationId:org,id,packId:body.packId,packVersion:1,name:body.name,createdAt:now,total:items.length,completed:0,needsAttention:0,href:href('/team/programmes',{programmeId:id}),scopeRationale:body.scopeRationale,recordHash:'a'.repeat(64),scope,items:items.map((item,index)=>({...item,attention:[],task:{id:'d23e4567-e89b-42d3-a456-'+String(426614176000+saved.length*10+index),title:item.title,status:'OPEN',assigneeId:editor,ownerName:item.ownerName,dueDate:item.dueDate,href:href('/team/work',{taskId:'d23e4567-e89b-42d3-a456-'+String(426614176000+saved.length*10+index)})}}))};
  saved.push(plan);programmeWrites++;taskWrites+=items.length;
  if(loseApply){loseApply=false;return route.abort('failed');}
  return route.fulfill({json:{organizationId:org,id,packId:body.packId,reused:false,taskIds:plan.items.map(item=>item.task.id),href:plan.href}});
 });
 async function tailor(packTitle,programmeName){
  await page.getByRole('button',{name:'Choose '+packTitle,exact:true}).click();
  await page.getByLabel('Programme name',{exact:true}).fill(programmeName);
  await page.getByLabel('Why this programme fits',{exact:true}).fill('This fictional quality team needs a bounded operational plan with clear owners, dated working records and explicit review limits.');
  await page.getByRole('checkbox',{name:'Include '+packs[0].items[2].title,exact:true}).uncheck();
  await page.getByLabel('Assign selected tasks to',{exact:true}).selectOption(editor);
  await page.getByRole('button',{name:'Apply owner to selected tasks',exact:true}).click();
 }
 async function replaceAccount(next){auth=next;await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key:storageKey,value:auth});}
 try{
  await page.goto(base+'/audit-programmes');
  await page.getByRole('searchbox',{name:'Find a programme or control'}).fill('CC6.2');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('link',{name:'Joint SOC 2 Security and ISO/IEC 27001 audit',exact:true}).click();
  await page.getByRole('heading',{name:'24 editable tasks',exact:true}).waitFor();
  assert.equal(await page.locator('details').count(),24);
  assert.equal(await page.getByRole('link',{name:'Use this programme in your workspace'}).getAttribute('href'),'/team/programmes?starter=soc2-iso27001-joint');
  await page.goto(base+href('/team/programmes',{starter:'soc2-iso27001-scoped'}));
  const tailoring=page.getByRole('region',{name:'Tailor your programme'});
  await tailoring.getByText('24 selected tasks.',{exact:false}).waitFor();
  const availability=tailoring.getByRole('checkbox',{name:'Include Availability tasks',exact:true});
  await availability.check();
  await tailoring.getByText('26 selected tasks.',{exact:false}).waitFor();
  const optional=tailoring.getByRole('checkbox',{name:'Include Test service recovery against agreed objectives',exact:true});
  await optional.uncheck();
  assert.ok(await availability.evaluate(input=>input.indeterminate));
  await availability.check();
  await tailoring.getByRole('checkbox',{name:'Include Privacy tasks',exact:true}).check();
  await tailoring.getByText('34 selected tasks.',{exact:false}).waitFor();
  await tailoring.getByRole('checkbox',{name:'Include Privacy tasks',exact:true}).uncheck();
  await tailoring.getByText('26 selected tasks.',{exact:false}).waitFor();
  assert.equal(previewPosts+applyPosts,0);
  await page.goto(base+href('/team/programmes',{starter:'business-foundations'}));
  await page.getByLabel('Programme name',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Programme name',{exact:true}).inputValue(),'Business foundations');
  assert.equal(previewPosts+applyPosts,0);
  await page.goto(base+href('/team/programmes'));await page.getByRole('heading',{name:'Starter programmes',exact:true}).waitFor();
  await page.getByRole('button',{name:'Choose Business foundations',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),org);
  assert.equal(previewPosts,0);assert.equal(applyPosts,0);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/starter-programmes-'+name+'-overview.png',fullPage:false});
  await tailor('Business foundations','Fictional first working programme');
  await page.getByLabel('Task title 1',{exact:true}).fill('Review the fictional quality team scope');
  await page.getByRole('button',{name:'Preview programme',exact:true}).click();
  const preview=page.getByRole('region',{name:'Programme preview',exact:true});await preview.waitFor();
  assert.equal(previewPosts,1);assert.equal(taskWrites,0,'preview must not save work');
  assert.equal(await preview.getByRole('button',{name:'Create 2 tasks',exact:true}).isDisabled(),true,'creation requires explicit confirmation');
  await page.getByLabel('Why this task applies 1',{exact:true}).fill('This fictional team needs an agreed scope before it can decide which working records and reviewers are appropriate.');
  assert.equal(await preview.count(),0,'editing the draft invalidates its earlier preview and confirmation');
  await page.getByRole('button',{name:'Preview programme',exact:true}).click();await preview.waitFor();
  assert.equal(previewPosts,2);assert.equal(taskWrites,0);
  await preview.screenshot({path:'artifacts/usability/starter-programme-'+name+'-preview.png'});
  await preview.getByRole('checkbox',{name:'I have reviewed these tasks, owners and dates.',exact:true}).check();
  await preview.getByRole('button',{name:'Create 2 tasks',exact:true}).evaluate(button=>{button.click();button.click();});
  const detail=page.getByRole('region',{name:'Saved programme',exact:true});await detail.getByRole('heading',{name:'Fictional first working programme',exact:true}).waitFor();
  assert.equal(applyPosts,1);assert.equal(programmeWrites,1);assert.equal(taskWrites,2);assert.equal(new URL(page.url()).searchParams.get('programmeId'),saved[0].id);
  assert.equal(await detail.getByRole('link',{name:/^Open task/}).count(),2);
  const taskHref=new URL(await detail.getByRole('link',{name:/^Open task/}).first().getAttribute('href'),base);
  assert.equal(taskHref.pathname,'/team/work');assert.equal(taskHref.searchParams.get('organizationId'),org);assert.equal(taskHref.searchParams.get('taskId'),saved[0].items[0].task.id);
  assert.equal(saved[0].items[0].task.title,'Review the fictional quality team scope');
  await page.reload();await detail.getByRole('heading',{name:'Fictional first working programme',exact:true}).waitFor();assert.equal(applyPosts,1);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'starter programme horizontal overflow '+overflow);
  await detail.screenshot({path:'artifacts/usability/starter-programme-'+name+'-saved.png'});

  await page.goto(base+href('/team/programmes',{programmeId:missing}));
  await page.getByRole('alert').filter({hasText:'Starter programme not found in this company'}).waitFor();assert.equal(await detail.count(),0);
  await page.getByRole('button',{name:'Open programme list',exact:true}).click();await page.getByRole('button',{name:'Choose People and access',exact:true}).waitFor();
  await tailor('People and access','Fictional people working programme');
  await page.getByRole('button',{name:'Preview programme',exact:true}).click();await preview.waitFor();
  await preview.getByRole('checkbox',{name:'I have reviewed these tasks, owners and dates.',exact:true}).check();loseApply=true;
  await preview.getByRole('button',{name:'Create 2 tasks',exact:true}).evaluate(button=>{button.click();button.click();});
  const recovery=page.getByRole('region',{name:'Unconfirmed programme creation',exact:true});await recovery.waitFor();
  assert.equal(applyPosts,2);assert.equal(programmeWrites,2);assert.equal(taskWrites,4);
  assert.equal(await page.getByRole('button',{name:'Preview programme',exact:true}).isDisabled(),true,'uncertain creation pauses further mutations');
  failRead=true;await recovery.getByRole('button',{name:'Check saved programmes',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fictional saved programme status temporarily unavailable.'}).waitFor();assert.equal(await detail.count(),0);assert.equal(applyPosts,2);
  await recovery.getByRole('button',{name:'Check saved programmes',exact:true}).click();
  await detail.getByRole('heading',{name:'Fictional people working programme',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('programmeId'),saved[1].id);assert.equal(applyPosts,2);assert.equal(taskWrites,4);
  await page.reload();await detail.getByRole('heading',{name:'Fictional people working programme',exact:true}).waitFor();assert.equal(applyPosts,2);

  const beforeUnavailable=reads.length;await page.goto(base+'/team/programmes?'+new URLSearchParams({organizationId:missing,programmeId:saved[0].id}));
  await page.getByText(/linked organisation is unavailable/).waitFor();assert.equal(reads.length,beforeUnavailable);assert.equal(await detail.count(),0);
  await page.goto(base+href('/team/programmes',{programmeId:saved[0].id}));await detail.getByRole('heading',{name:'Fictional first working programme',exact:true}).waitFor();
  const held=new Promise(resolve=>{readHeld=resolve;}),finished=new Promise(resolve=>{readFinished=resolve;});holdRead=true;
  await page.getByRole('button',{name:'Refresh programmes',exact:true}).click();await held;await replaceAccount(session(viewer));
  await page.getByText('You can inspect these starting points and saved work. An owner or administrator must create a programme.',{exact:true}).waitFor();releaseRead();await finished;
  await page.getByRole('button',{name:'Choose Suppliers and continuity',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Preview programme',exact:true}).isDisabled(),true,'a late administrator read cannot restore mutation rights');
  assert.equal(await page.getByLabel('Programme name',{exact:true}).isDisabled(),true);assert.equal(applyPosts,2);assert.equal(taskWrites,4);
  assert.ok(reads.some(read=>read.actor===viewer));assert.deepEqual(errors,[]);
  return {scenario:'starter-programme-'+name,passed:true,overflowPx:overflow,previewPosts,applyPosts,programmeWrites,taskWrites,checks:['additional SOC 2 categories and partial selection','second-company scope','editable selected tasks and owner assignment','preview has no task writes','draft changes invalidate preview','rapid explicit creation saves once','saved task handoff and reload','missing exact programme never substitutes','lost response reconciles with GET only','failed reconciliation keeps creation paused','unavailable company isolation','late previous-account result cannot restore administrator controls']};
 }catch(error){await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/starter-programme-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});await writeFile('artifacts/usability/starter-programme-'+name+'-failure.json',JSON.stringify({error:error.message,reads,previewPosts,applyPosts,programmeWrites,taskWrites,pageErrors:errors},null,2)+'\n');throw error;}
 finally{releaseRead?.();await context.close();}
}
