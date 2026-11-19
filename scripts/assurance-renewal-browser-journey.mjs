/** Fictional API fixtures for the real renewal UI; private-byte policy is tested separately against PostgreSQL. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

export async function assuranceRenewalJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 context.setDefaultTimeout(12_000);
 page.on('pageerror',error=>errors.push(error.message));
 const org='723e4567-e89b-42d3-a456-426614174000',other='723e4567-e89b-42d3-a456-426614174001';
 const user='723e4567-e89b-42d3-a456-426614174002',author='723e4567-e89b-42d3-a456-426614174003';
 const taskId='723e4567-e89b-42d3-a456-426614174004',assessmentId='723e4567-e89b-42d3-a456-426614174005',fileId='723e4567-e89b-42d3-a456-426614174006';
 const olderId='723e4567-e89b-42d3-a456-426614174050',viewerId='723e4567-e89b-42d3-a456-426614174051';
 const now=Date.now(),past=new Date(now-86400000).toISOString(),future=new Date(now+30*86400000).toISOString().slice(0,10);
 let auth={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(now/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(now/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'reviewer@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date(now).toISOString()}};
 await context.addInitScript(value=>{if(!localStorage.getItem('sb-auth-fixture-auth-token'))localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value));},auth);
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:auth.user.id,email:auth.user.email,organisations:[{id:org,name:'Fictional renewal company',role:auth.user.id===user?'ADMIN':'VIEWER'},{id:other,name:'Other fictional company',role:auth.user.id===user?'ADMIN':'VIEWER'}]}}));
 const sourceQuote='Fictional operators must keep dated training records for the equipment they use.';
 const quote='All fictional operators completed the equipment training and the dated record is retained.';
 const manifest={id:fileId,obligationId:taskId,sha256:'a'.repeat(64),reviewVersion:2,reviewStatus:'APPROVED',scanStatus:'CLEAN',uploadedById:author,reviewerId:user};
 const result={engineVersion:'evidence-assurance-2.0.0',sourceQuote,method:'CONTENT_SEARCH',rejectedClaims:0,passages:[{key:'b'.repeat(64),evidenceId:fileId,page:1,unitKind:'page',start:0,end:quote.length,quote,matchedTerms:['training','record'],negationDetected:false}],checks:[{criterion:'Check the declared scope and training record.',sourceQuote,verdict:'UNASSESSED',explanation:'Candidate passage found; independent human assessment is needed.',passageKeys:['b'.repeat(64)]}],documents:[{id:fileId,filename:'Fictional training record.pdf',totalPages:1,extractedPages:1,truncated:false,skippedPages:[],blockingIssues:[],unitKind:'page',format:'PDF'}],warnings:['Fictional browser acceptance data. Inspect originals before a real review.']};
 let version=2,validUntil=past,renewals=0,posts=0,prepares=0,staleNext=false,lostNext=false,workspaceReads=0;
 let draftStatus='DRAFT',draftVersion=1,decisionPosts=0,decisionWrites=0,failWorkspace=false,holdWorkspace=false,olderExposed=false,releaseWorkspace,workspaceHeld,workspaceFinished;
 const assessment=()=>({id:assessmentId,obligationId:taskId,createdById:author,createdAt:new Date(now-10*86400000).toISOString(),method:'CONTENT_SEARCH',status:'ACCEPTED',version,result,integrityValid:true,reviewNotes:'The earlier independent decision covered the equipment training record and declared scope.',reviewerId:user,reviewedAt:new Date(now-9*86400000).toISOString(),validUntil,evidenceManifest:[manifest],current:renewals>0,reason:renewals>0?null:'The evidence review period has expired'});
 const older=()=>({...assessment(),id:olderId,createdAt:new Date(now-40*86400000).toISOString(),status:draftStatus,version:draftVersion,current:true,reason:null,validUntil:future+'T23:59:59.999Z',reviewNotes:decisionWrites?'The exact older draft was independently reviewed against its original passages and declared scope.':'',reviewerId:decisionWrites?user:null,reviewedAt:decisionWrites?new Date().toISOString():null});
 await context.route('**/api/workspace/work*',route=>{
  const url=new URL(route.request().url());assert.equal(url.searchParams.get('organizationId'),org);assert.equal(url.searchParams.get('taskId'),taskId);
  const exact=olderExposed;
  return route.fulfill({json:{organizationId:org,task:{id:taskId,title:'Review fictional equipment training',status:'COMPLETE',ownerName:'Fictional operator',assignee:null,originKey:'fictional-training'},workflow:{stage:exact&&draftStatus==='DRAFT'?'ASSESSMENT_REVIEW':'COMPLETED',title:exact&&draftStatus==='DRAFT'?'Review the evidence assessment':'Outcome recorded',detail:'Fictional saved work context; inspect the exact selected assessment below.',label:exact&&draftStatus==='DRAFT'?'Review evidence assessment':'Review completed task',href:'/team/assurance?'+new URLSearchParams({organizationId:org,taskId,assessmentId:exact?olderId:assessmentId}),actor:auth.user.id===user?'you':'reviewer',canAct:auth.user.id===user,verified:true,assessmentId:exact?olderId:assessmentId}}});
 });
 await context.route(url=>url.pathname==='/api/workspace/assurance'||url.pathname.startsWith('/api/workspace/assurance/'),async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/workspace/assurance'){
   if(request.method()!=='GET'){prepares++;return route.fulfill({status:409,json:{error:'No preparation should be requested during explicit renewal'}});}
   workspaceReads++;
   const selectedOrg=url.searchParams.get('organizationId');assert.ok([org,other].includes(selectedOrg),'unavailable organisation must not reach a workspace request');
   if(selectedOrg===other)return route.fulfill({json:{selectedTaskId:null,tasks:[],evidence:[],source:null,contextIssue:null,assessments:[],nextStep:'Accept a source recommendation first.',aiEnabled:false,taskLimitReached:false}});
   assert.equal(url.searchParams.get('taskId'),taskId,'renewal must retain the exact task');
   if(failWorkspace){failWorkspace=false;return route.fulfill({status:503,json:{error:'Fictional saved assessments temporarily unavailable.'}});}
   const exact=url.searchParams.get('assessmentId')===olderId;
   if(exact)olderExposed=true;
   const body={selectedTaskId:taskId,selectedAssessmentId:exact?olderId:assessmentId,tasks:[{id:taskId,title:'Review fictional equipment training',status:'COMPLETE',ownerName:'Fictional operator',dueDate:new Date(now).toISOString()}],evidence:[{...manifest,filename:'Fictional training record.pdf'}],source:{quote:sourceQuote,title:'Fictional source requirement',url:'https://www.gov.uk/example',hash:'c'.repeat(64)},contextIssue:null,assessments:exact?[...Array.from({length:10},(_,i)=>({...assessment(),id:'823e4567-e89b-42d3-a456-'+String(i).padStart(12,'0')})),older()]:[assessment()],nextStep:exact?(auth.user.id===user?'Previous reviewer workspace context.':'Current viewer workspace context.'):(renewals?'Evidence assessment is current.':'The evidence review period has expired'),aiEnabled:false,taskLimitReached:false,assessmentLimitReached:exact};
   const held=holdWorkspace;if(held){holdWorkspace=false;await new Promise(resolve=>{releaseWorkspace=resolve;workspaceHeld();});}
   try{await route.fulfill({json:body});}catch{}finally{if(held)workspaceFinished();}return;
  }
  if(url.pathname==='/api/workspace/assurance/'+olderId){
   assert.equal(request.method(),'PATCH');const body=request.postDataJSON();decisionPosts++;
   assert.equal(body.organizationId,org);assert.equal(body.version,1);assert.equal(body.decision,'ACCEPTED');assert.equal(body.scopeConfirmed,true);assert.equal(body.originalsChecked,true);assert.deepEqual(body.passageKeys,['b'.repeat(64)]);
   draftStatus='ACCEPTED';draftVersion++;decisionWrites++;return route.abort('failed');
  }
  if(url.pathname==='/api/workspace/assurance/'+olderId+'/renew')return route.fulfill({json:{id:olderId,organizationId:org,version:draftVersion,status:draftStatus,eligible:false,reason:'The fictional review period is current.',expired:false,validUntil:older().validUntil,reviewedAt:older().reviewedAt,reviewerId:user,selectedPassages:['b'.repeat(64)],scope:'Fictional selected record.'}});
  assert.equal(url.pathname,'/api/workspace/assurance/'+assessmentId+'/renew');
  if(request.method()==='GET'){
   assert.equal(url.searchParams.get('organizationId'),org);
   return route.fulfill({json:{id:assessmentId,organizationId:org,version,status:'ACCEPTED',eligible:true,reason:null,expired:renewals===0,validUntil,reviewedAt:assessment().reviewedAt,reviewerId:user,selectedPassages:['b'.repeat(64)],scope:'Scoped evidence review; original task completion is unchanged.'}});
  }
  assert.equal(request.method(),'POST');posts++;
  const body=request.postDataJSON();
  assert.equal(body.organizationId,org);assert.equal(body.version,version);
  assert.equal(body.scopeConfirmed,true);assert.equal(body.originalsChecked,true);
  assert.deepEqual(body.passageKeys,['b'.repeat(64)]);assert.equal(body.validUntil,future);
  assert.ok(body.notes.length>=40);
  if(staleNext){staleNext=false;return route.fulfill({status:409,json:{error:'Supporting context changed during renewal. Refresh and review again.'}});}
  renewals++;version++;validUntil=future+'T23:59:59.999Z';
  if(lostNext){lostNext=false;return route.abort('failed');}
  return route.fulfill({json:{id:assessmentId,status:'ACCEPTED',version,reviewedAt:new Date().toISOString(),validUntil,eventId:'723e4567-e89b-42d3-a456-426614174007'}});
 });
 async function fillRenewal(){
  await page.getByRole('button',{name:'Renew evidence review',exact:true}).click();
  await page.getByLabel('Renewal rationale',{exact:true}).fill('Independently rechecked the original training record, its dates and the declared equipment scope before renewing this evidence decision.');
  await page.getByLabel('Next evidence review date',{exact:true}).fill(future);
  await page.getByLabel('Use this passage in my evidence decision',{exact:true}).check();
  const confirm=page.getByRole('button',{name:'Confirm renewed evidence review',exact:true});
  assert.equal(await confirm.isDisabled(),true,'renewal must require explicit scope and original-document checks');
  await page.getByLabel('I checked the full requirement, its conditions and exceptions, and the business scope covered by these files.',{exact:true}).check();
  await page.getByLabel('I inspected the original documents, including dates, signatures, tables and evidence of implementation.',{exact:true}).check();
  return confirm;
 }
 try{
  await page.goto(base+'/team/assurance?'+new URLSearchParams({organizationId:org,taskId}));
  await page.getByText('The evidence review period has expired',{exact:true}).first().waitFor();
  assert.equal(renewals,0);assert.equal(prepares,0);
  let confirm=await fillRenewal();
  assert.equal(posts,0,'reading eligibility and selecting passages must not renew');
  await mkdir('artifacts/usability',{recursive:true});
  await page.screenshot({path:'artifacts/usability/assurance-renewal-'+name+'-form.png',fullPage:true});
  await confirm.click();
  await page.getByText('Context checked',{exact:true}).waitFor();
  assert.equal(renewals,1);assert.equal(posts,1);assert.equal(prepares,0,'renewal must not regenerate the assessment');
  await page.reload();
  await page.getByText('Context checked',{exact:true}).waitFor();
  assert.equal(renewals,1,'reload must not renew automatically');
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
  assert.ok(overflow<=3,'renewal page horizontal overflow '+overflow+'px');
  await page.screenshot({path:'artifacts/usability/assurance-renewal-'+name+'-saved.png',fullPage:true});
  staleNext=true;confirm=await fillRenewal();await confirm.click();
  await page.getByText(/Supporting context changed during renewal\. Refresh and review again\./).waitFor();
  assert.equal(renewals,1,'a stale review cannot extend the period');
  assert.equal(posts,2,'a failed renewal must not retry itself');
  assert.equal(await page.getByRole('button',{name:'Confirm renewed evidence review',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Refresh saved review',exact:true}).click();
  lostNext=true;confirm=await fillRenewal();await confirm.click();
  await page.getByText(/The renewal result could not be confirmed/).waitFor();
  assert.equal(renewals,2,'the simulated lost response follows a saved review');
  assert.equal(posts,3,'an unconfirmed response must not trigger another POST');
  assert.equal(await page.getByRole('button',{name:'Confirm renewed evidence review',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Refresh saved review',exact:true}).click();
  await page.getByText(/Saved review refreshed\. Inspect its recorded reviewer/).waitFor();
  assert.equal(renewals,2);assert.equal(posts,3,'recovery reads the saved state without repeating the decision');

  // An older exact draft must remain selected even when ten newer records exist.
  const exactUrl=base+'/team/assurance?'+new URLSearchParams({organizationId:org,taskId,assessmentId:olderId});
  await page.goto(exactUrl);const selector=page.getByRole('combobox',{name:'Assessment',exact:true});await selector.waitFor();
  assert.equal(await selector.inputValue(),olderId);assert.equal(await selector.locator('option').count(),11);
  await page.getByText('Showing the ten latest assessments and the exact linked record when it is older.',{exact:true}).waitFor();
  await page.getByLabel('Use this passage in my evidence decision',{exact:true}).check();
  await page.getByLabel('Explain what is demonstrated, the scope, dates and remaining limitations',{exact:true}).fill('The exact older draft was independently reviewed against its original passages and declared scope.');
  await page.getByLabel('Review this evidence again by',{exact:true}).fill(future);
  await page.getByLabel('I checked the full requirement, its conditions and exceptions, and the business scope covered by these files.',{exact:true}).check();
  await page.getByLabel('I inspected the original documents, including dates, signatures, tables and evidence of implementation.',{exact:true}).check();
  const accept=page.getByRole('button',{name:'Record evidence adequate for this task',exact:true});await accept.evaluate(button=>{button.click();button.click();});
  const reconcile=page.getByRole('button',{name:'Check saved assessments',exact:true});await reconcile.waitFor();
  assert.equal(decisionPosts,1);assert.equal(decisionWrites,1);assert.equal(await selector.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Find evidence passages',exact:true}).isDisabled(),true);
  failWorkspace=true;await reconcile.click();await page.getByText('Fictional saved assessments temporarily unavailable.',{exact:true}).waitFor();assert.equal(await selector.count(),0,'a failed reconciliation removes the older visible assessment');
  await reconcile.click();await page.getByText(/Saved assessments checked/).waitFor();assert.equal(await selector.inputValue(),olderId);
  assert.equal(decisionPosts,1);assert.equal(decisionWrites,1);assert.equal(prepares,0,'lost review replies must not submit another review or paid preparation');
  await page.screenshot({path:'artifacts/usability/assurance-exact-review-'+name+'-saved.png',fullPage:true});
  holdWorkspace=true;const held=new Promise(resolve=>{workspaceHeld=resolve}),finished=new Promise(resolve=>{workspaceFinished=resolve});
  await page.goto(exactUrl);await held;
  auth={...auth,access_token:'fixture.'+Buffer.from(JSON.stringify({sub:viewerId,exp:Math.floor(now/1000)+3600})).toString('base64url')+'.fixture',user:{...auth.user,id:viewerId,email:'viewer@example.invalid'}};
  await page.evaluate(value=>{const key='sb-auth-fixture-auth-token';localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},auth);
  await page.getByText(/Current viewer workspace context/).waitFor();releaseWorkspace();await finished;
  assert.equal(await page.getByText(/Previous reviewer workspace context/).count(),0,'late reviewer content cannot replace the current account’s workspace');
  assert.equal(await page.getByRole('button',{name:'Find evidence passages',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Record evidence adequate for this task',exact:true}).count(),0);
  const readsBeforeUnknown=workspaceReads;
  await page.goto(base+'/team/assurance?'+new URLSearchParams({organizationId:'723e4567-e89b-42d3-a456-426614174099',taskId}));
  await page.getByText(/organisation is unavailable/i).waitFor();
  assert.equal(workspaceReads,readsBeforeUnknown,'an unavailable linked organisation must not fall back to another company');
  assert.equal(await page.getByRole('button',{name:'Renew evidence review',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  return {scenario:'assurance-renewal-'+name,passed:true,overflowPx:overflow,decisionPosts,decisionWrites,checks:['expired accepted assessment can be independently renewed','explicit scope/original/passage confirmation','no preparation or paid-model request','current decision survives reload','stale confirmation does not renew or retry','lost response is reconciled with read-only refresh','exact older assessment beyond latest ten','lost independent review reply requires GET-only recovery','failed reconciliation clears saved content','same-organisation account replacement rejects late reviewer response','unavailable linked organisation cannot fall back']};
 }catch(error){
  await mkdir('artifacts/usability',{recursive:true});
  await page.screenshot({path:'artifacts/usability/assurance-renewal-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});
  throw error;
 }finally{releaseWorkspace?.();await context.close();}
}
