// Fictional browser identity/API fixtures exercise handoff and ambiguous replies.
// The separate private-services customer journey proves real invitations and joins.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const first='b23e4567-e89b-42d3-a456-426614174000',target='b23e4567-e89b-42d3-a456-426614174002';
const owner='b23e4567-e89b-42d3-a456-426614174001',colleague='b23e4567-e89b-42d3-a456-426614174003',viewer='b23e4567-e89b-42d3-a456-426614174004';
const invitationId='b23e4567-e89b-42d3-a456-426614174005',taskId='b23e4567-e89b-42d3-a456-426614174006',missing='b23e4567-e89b-42d3-a456-426614174099';
const key='sb-auth-fixture-auth-token',ownerEmail='team-owner@example.invalid',colleagueEmail='invited-colleague@example.invalid';
const nameFor=id=>id===target?'Fictional invited company':'Fictional existing company';
function session(id,email){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}

export async function teamCollaborationJourney(browser,base,viewport,name){
 const ctx=await browser.newContext({viewport,locale:'en-GB'}),page=await ctx.newPage();page.setDefaultTimeout(12000);
 const errors=[],teamReads=[],statusReads=[];page.on('pageerror',error=>errors.push(error.message));
 let actor=session(owner,ownerEmail),invite=null,createPosts=0,joinPosts=0,membershipWrites=0,loseCreate=true,loseJoin=true,failTeam=false,failStatus=false,holdTeam=false;
 let releaseTeam,teamHeld,teamFinished;
 const now=new Date().toISOString(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
 const organizations=()=>actor.user.id===owner?[{id:first,name:nameFor(first),role:'OWNER'},{id:target,name:nameFor(target),role:'OWNER'}]:actor.user.id===viewer?[{id:first,name:nameFor(first),role:'VIEWER'}]:[{id:first,name:nameFor(first),role:'OWNER'},...(membershipWrites?[{id:target,name:nameFor(target),role:'EDITOR'}]:[])];
 const team=id=>({organizationId:id,role:'OWNER',members:[{role:'OWNER',user:{id:actor.user.id,email:actor.user.email}},...(id===target&&membershipWrites?[{role:'EDITOR',user:{id:colleague,email:colleagueEmail}}]:[])],invitations:id===target&&invite?[{...invite}]:[],activity:[],memberLimitReached:false,limits:{members:100,pending:50,dailyInvitations:20,expiryDays:7}});
 await ctx.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key,value:actor});
 await ctx.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:actor.user}}));
 await ctx.route('**/api/ai/analyse',route=>route.fulfill({json:{workspaceEnabled:true}}));
 await ctx.route('**/api/ai/context',route=>route.fulfill({json:{userId:actor.user.id,email:actor.user.email,organisations:organizations()}}));
 await ctx.route('**/api/workspace/team*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'){
   const body=request.postDataJSON();assert.equal(actor.user.id,owner);assert.equal(body.organizationId,target);assert.equal(body.email,colleagueEmail);assert.equal(body.role,'EDITOR');createPosts++;
   invite={id:invitationId,email:colleagueEmail,role:'EDITOR',status:'PENDING',version:1,expiresAt,createdAt:now,resolvedAt:null};
   if(loseCreate){loseCreate=false;return route.abort('failed');}
   return route.fulfill({json:{...invite,reused:false}});
  }
  assert.equal(request.method(),'GET','recovery must never repeat a team mutation');
  const id=url.searchParams.get('organizationId');teamReads.push(id);assert.ok(organizations().some(org=>org.id===id&&org.role==='OWNER'));
  if(failTeam){failTeam=false;return route.fulfill({status:503,json:{error:'Fictional team status temporarily unavailable.'}});}
  const body=team(id),held=holdTeam;if(held){holdTeam=false;await new Promise(resolve=>{releaseTeam=resolve;teamHeld();});}
  try{await route.fulfill({json:body});}catch{}finally{if(held)teamFinished();}
 });
 await ctx.route('**/api/workspace/invitations*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'){
   const body=request.postDataJSON();assert.equal(actor.user.id,colleague);assert.equal(body.id,invitationId);assert.equal(body.version,1);assert.equal(body.decision,'ACCEPT');joinPosts++;
   assert.equal(invite.status,'PENDING');invite={...invite,status:'ACCEPTED',version:2,resolvedAt:now};membershipWrites++;
   if(loseJoin){loseJoin=false;return route.abort('failed');}
   return route.fulfill({json:{status:'ACCEPTED',organizationId:target}});
  }
  const id=url.searchParams.get('invitationId');
  if(id){
   statusReads.push(id);
   if(failStatus){failStatus=false;return route.fulfill({status:503,json:{error:'Fictional invitation status temporarily unavailable.'}});}
   if(id!==invitationId||!invite||actor.user.email!==invite.email)return route.fulfill({status:404,json:{error:'Invitation not available'}});
   return route.fulfill({json:{invitation:{id:invite.id,role:invite.role,status:invite.status,version:invite.version,expiresAt:invite.expiresAt,resolvedAt:invite.resolvedAt,organization:{id:target,name:nameFor(target)},membership:membershipWrites?{role:'EDITOR'}:null}}});
  }
  return route.fulfill({json:{invitations:invite?.status==='PENDING'&&actor.user.email===invite.email?[{id:invite.id,role:invite.role,version:invite.version,expiresAt,organization:{id:target,name:nameFor(target)}}]:[]}});
 });
 async function replaceAccount(next){actor=next;await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key,value:actor});}
 try{
  await page.goto(base+'/team/settings?'+new URLSearchParams({organizationId:target,taskId}));
  await page.getByRole('heading',{name:'Invite a colleague',exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),target);
  assert.ok(teamReads.length>0&&teamReads.every(id=>id===target),'a linked organisation must not silently select the first membership');
  await page.getByLabel('Colleague’s email',{exact:true}).fill(colleagueEmail);await page.getByLabel('Role',{exact:true}).selectOption('EDITOR');
  await page.getByRole('button',{name:'Create invitation',exact:true}).evaluate(button=>{button.click();button.click();});
  const reconcile=page.getByRole('button',{name:'Check saved invitation status',exact:true});await reconcile.waitFor();assert.equal(createPosts,1);
  const create=page.getByRole('button',{name:'Create invitation',exact:true});if(await create.count())assert.equal(await create.isDisabled(),true);
  failTeam=true;await reconcile.click();await page.getByRole('status').filter({hasText:'Fictional team status temporarily unavailable.'}).waitFor();
  assert.equal(createPosts,1);assert.equal(await page.getByRole('button',{name:'Copy invitation link',exact:true}).count(),0,'a failed status read must not publish an unverified invitation handoff');
  await reconcile.click();const linkField=page.getByLabel('Invitation link',{exact:true});await linkField.waitFor();
  const invitationUrl=await linkField.inputValue(),link=new URL(invitationUrl);
  assert.equal(link.origin,base);assert.equal(link.pathname,'/team/settings');assert.equal(link.searchParams.get('organizationId'),target);assert.equal(link.searchParams.get('invitationId'),invitationId);assert.equal(link.searchParams.get('taskId'),taskId);assert.equal(createPosts,1);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/team-invitation-'+name+'.png',fullPage:true});

  await replaceAccount(session(colleague,colleagueEmail));await page.goto(invitationUrl);
  const pending=page.getByRole('article').filter({hasText:nameFor(target)}),join=pending.getByRole('button',{name:'Join workspace',exact:true});await join.waitFor();
  assert.equal(await page.getByRole('heading',{name:'Invite a colleague',exact:true}).count(),0,'an unjoined link must not display another company’s administrator controls');
  await join.evaluate(button=>{button.click();button.click();});await reconcile.waitFor();assert.equal(joinPosts,1);assert.equal(membershipWrites,1);
  assert.equal(await page.getByRole('link',{name:/^Open invited task/}).count(),0,'an ambiguous reply must not claim the invitation was accepted');
  failStatus=true;await reconcile.click();await page.getByRole('status').filter({hasText:'Fictional invitation status temporarily unavailable.'}).waitFor();assert.equal(joinPosts,1);
  await reconcile.click();const taskLink=page.getByRole('link',{name:/^Open invited task/});await taskLink.waitFor();
  const taskUrl=new URL(await taskLink.getAttribute('href'),base);assert.equal(taskUrl.pathname,'/team/work');assert.equal(taskUrl.searchParams.get('organizationId'),target);assert.equal(taskUrl.searchParams.get('taskId'),taskId);
  assert.equal(await page.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),target,'the joined company replaces the colleague’s prior company selection');
  assert.equal(joinPosts,1);assert.equal(membershipWrites,1);assert.equal(await page.getByRole('heading',{name:'Invite a colleague',exact:true}).count(),0);
  await page.reload();await taskLink.waitFor();assert.equal(joinPosts,1,'reload reads the saved decision without accepting twice');
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'team collaboration horizontal overflow '+overflow);
  await page.screenshot({path:'artifacts/usability/team-joined-'+name+'.png',fullPage:true});

  const readsBeforeMissing=teamReads.length;await page.goto(base+'/team/settings?organizationId='+missing);
  await page.getByText(/The linked organisation is unavailable/).waitFor();assert.equal(teamReads.length,readsBeforeMissing);assert.equal(await taskLink.count(),0);
  await page.getByRole('combobox',{name:'Organisation',exact:true}).selectOption(first);await page.getByRole('heading',{name:'Invite a colleague',exact:true}).waitFor();
  holdTeam=true;const held=new Promise(resolve=>{teamHeld=resolve}),finished=new Promise(resolve=>{teamFinished=resolve});
  await page.goto(base+'/team/settings?organizationId='+first);await held;
  await replaceAccount(session(viewer,'current-viewer@example.invalid'));
  await page.getByRole('heading',{name:'Your access: viewer',exact:true}).waitFor();releaseTeam();await finished;
  assert.equal(await page.getByRole('heading',{name:'Invite a colleague',exact:true}).count(),0);assert.equal(await page.getByText(colleagueEmail,{exact:true}).count(),0,'a late administrator response cannot repopulate the previous account’s team');
  await page.evaluate(key=>{localStorage.removeItem(key);const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();},key);
  await page.getByRole('form',{name:'Email sign-in',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Your access: viewer',exact:true}).count(),0);
  assert.equal(createPosts,1);assert.equal(joinPosts,1);assert.deepEqual(errors,[]);
  return {scenario:'team-collaboration-'+name,passed:true,fixture:'fictional identity/API replies; actual invitation and membership persistence verified separately with disposable private services',overflowPx:overflow,createPosts,joinPosts,membershipWrites,statusReads:statusReads.length,checks:['exact company and task invitation link','lost create response reconciled without duplicate writes','failed reconciliation withholds unverified handoff','existing-member joins correct invited company','lost acceptance response resolved by email-scoped GET','one membership and acceptance after reload','unavailable company never falls back','late previous-account team response rejected','viewer has no administrator invitation controls','sign-out clears private collaboration state']};
 }catch(error){
  releaseTeam?.();await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/team-collaboration-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});
  await writeFile('artifacts/usability/team-collaboration-'+name+'-failure.txt',String(error)+'\n\n'+await page.locator('body').ariaSnapshot()).catch(()=>{});throw error;
 }finally{releaseTeam?.();await ctx.close();}
}
