// Fictional identity/API responses exercise the real connected risk UI.
// Real private bytes, completion receipts and independent decisions are verified
// separately in starter-risk-customer-journey.mjs and PostgreSQL integration.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const org='e23e4567-e89b-42d3-a456-426614174000',first='e23e4567-e89b-42d3-a456-426614174001';
const owner='e23e4567-e89b-42d3-a456-426614174002',editor='e23e4567-e89b-42d3-a456-426614174003',viewer='e23e4567-e89b-42d3-a456-426614174004';
const riskId='e23e4567-e89b-42d3-a456-426614175030',taskId='e23e4567-e89b-42d3-a456-426614174005',fileId='e23e4567-e89b-42d3-a456-426614174006',controlId='e23e4567-e89b-42d3-a456-426614174007',treatmentId='e23e4567-e89b-42d3-a456-426614174008',reviewId='e23e4567-e89b-42d3-a456-426614174009',createdId='e23e4567-e89b-42d3-a456-426614174010',missing='e23e4567-e89b-42d3-a456-426614174099';
const storageKey='sb-auth-fixture-auth-token',endpoint='/api/workspace/risks',title='Fictional widget training exposure',filename='Fictional training record.pdf';
const href=(path,values={})=>path+'?'+new URLSearchParams({organizationId:org,...values});
function session(id){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:(id===owner?'owner':id===viewer?'viewer':'editor')+'@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}

export async function riskJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],reads=[],posts=[];
 context.setDefaultTimeout(12_000);page.on('pageerror',error=>errors.push(error.message));
 let auth=session(editor),treatment=null,review=null,stale=false,failRead=false,holdRead=false,releaseRead,readHeld,readFinished,createWrites=0,treatmentWrites=0,prepareWrites=0,decisionWrites=0;
 const now=new Date().toISOString(),until=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 const control={id:controlId,title:'Fictional training review control',enabled:true,version:1};
 const file={id:fileId,filename,sha256:'a'.repeat(64),reviewVersion:2,uploadedById:editor,reviewerId:owner};
 const rows=Array.from({length:31},(_,index)=>({id:'e23e4567-e89b-42d3-a456-'+String(426614175000+index),title:index===30?title:'Fictional operational risk '+String(index).padStart(2,'0'),description:'A fictional operational exposure with a recorded human assessment and explicit limits.',category:'QUALITY',ownerId:editor,ownerName:'editor@example.invalid',createdById:editor,likelihood:4,impact:4,score:16,ratingRationale:'Fictional frequency and business impact require a documented treatment assessment.',strategy:'MITIGATE',reviewDueAt:until,status:'OPEN',version:1}));
 const tasks=Array.from({length:31},(_,index)=>({id:index===30?taskId:'e23e4567-e89b-42d3-a456-'+String(426614176000+index),title:index===30?'Review fictional widget training':'Fictional operational task '+index,status:index===30?'COMPLETE':'OPEN',ownerName:'editor@example.invalid',href:href('/team/work',{taskId:index===30?taskId:'e23e4567-e89b-42d3-a456-'+String(426614176000+index)})}));
 function workspace(url){
  const writer=auth.user.id!==viewer,role=auth.user.id===owner?'OWNER':writer?'EDITOR':'VIEWER';
  const q=(url.searchParams.get('q')||'').toLowerCase(),status=url.searchParams.get('status')||'all';
  const filtered=rows.filter(row=>(!q||row.title.toLowerCase().includes(q))&&(status==='all'||row.status.toLowerCase()===status));
  const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(Number(url.searchParams.get('page')||1),pages);
  const creation=rows.find(row=>row.createKey===url.searchParams.get('requestKey')),selectedId=url.searchParams.get('riskId')||creation?.id;
  const row=selectedId?rows.find(row=>row.id===selectedId):null;if(selectedId&&!row)return null;
  const selected=row?{risk:{...row},controls:[control],treatments:row.id===riskId&&treatment?[{...treatment,completion:{...treatment.completion,current:!stale,reason:stale?'The reviewed evidence changed.':'The saved completion receipt and current supporting metadata match.'}}]:[],reviews:row.id===riskId&&review?[{...review,current:!stale,reason:stale?'The supporting evidence changed. Prepare a fresh review.':'The saved risk, treatment receipts and supporting metadata still match.'}]:[],canEdit:writer,canReview:auth.user.id===owner&&row.id===riskId&&review?.status==='PENDING',blockers:row.id===riskId&&treatment&&!stale?[]:['Record completed treatment work before assessing remaining risk.']}:null;
  const taskQ=(url.searchParams.get('taskQ')||'').toLowerCase(),matched=tasks.filter(task=>!taskQ||task.title.toLowerCase().includes(taskQ)),taskPages=Math.max(1,Math.ceil(matched.length/25)),taskPage=Math.min(Number(url.searchParams.get('taskPage')||1),taskPages);
  return {organizationId:org,role,canWrite:writer,members:[{id:owner,email:'owner@example.invalid',role:'OWNER'},{id:editor,email:'editor@example.invalid',role:'EDITOR'}],membersLimited:false,controls:[control],controlsLimited:false,evidence:[file],items:filtered.slice((page-1)*25,page*25).map(row=>({...row})),total:filtered.length,page,pages,pageSize:25,summary:{all:rows.length,open:rows.filter(row=>row.status==='OPEN').length,underReview:rows.filter(row=>row.status==='UNDER_REVIEW').length,accepted:rows.filter(row=>row.status==='ACCEPTED').length,archived:0,overdue:0},selected,tasks:{items:matched.slice((taskPage-1)*25,taskPage*25),total:matched.length,page:taskPage,pages:taskPages,pageSize:25},creationLookup:url.searchParams.has('requestKey')?{requestKey:url.searchParams.get('requestKey'),found:!!creation,riskId:creation?.id||null}:null};
 }
 await context.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:auth});
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 await context.route('**/api/ai/analyse',route=>route.fulfill({json:{workspaceEnabled:true}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:auth.user.id,email:auth.user.email,organisations:[{id:first,name:'First fictional company',role:auth.user.id===owner?'OWNER':auth.user.id===viewer?'VIEWER':'EDITOR'},{id:org,name:'Fictional risk company',role:auth.user.id===owner?'OWNER':auth.user.id===viewer?'VIEWER':'EDITOR'}]}}));
 await context.route(url=>url.pathname===endpoint,async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='GET'){
   assert.equal(url.searchParams.get('organizationId'),org);reads.push({actor:auth.user.id,riskId:url.searchParams.get('riskId'),requestKey:url.searchParams.get('requestKey')});
   if(failRead){failRead=false;return route.fulfill({status:503,json:{error:'Fictional risk status temporarily unavailable.'}});}
   const body=workspace(url);if(!body)return route.fulfill({status:404,json:{error:'Risk not found in this company'}});
   const held=holdRead;if(held){holdRead=false;await new Promise(resolve=>{releaseRead=resolve;readHeld();});}
   try{await route.fulfill({json:body});}catch{}finally{if(held)readFinished();}return;
  }
  assert.equal(request.method(),'POST');assert.notEqual(auth.user.id,viewer);
  const body=request.postDataJSON();assert.equal(body.organizationId,org);posts.push({action:body.action,actor:auth.user.id});
  const row=rows.find(row=>row.id===riskId);
  if(body.action==='CREATE'){
   assert.equal(auth.user.id,owner);assert.equal(createWrites,0);assert.ok(body.requestKey);assert.deepEqual(body.controlIds,[controlId]);
   rows.push({id:createdId,createKey:body.requestKey,title:body.title,description:body.description,category:body.category,ownerId:body.ownerId,ownerName:'editor@example.invalid',createdById:owner,likelihood:body.likelihood,impact:body.impact,score:body.likelihood*body.impact,ratingRationale:body.ratingRationale,strategy:body.strategy,reviewDueAt:body.reviewDueAt,status:'OPEN',version:1});createWrites++;
   return route.abort('failed');
  }
  assert.equal(body.riskId,riskId);
  if(body.action==='TREATMENT'){
   assert.equal(auth.user.id,editor);assert.equal(body.version,row.version);assert.equal(body.taskId,taskId);assert.equal(treatmentWrites,0);treatmentWrites++;
   treatment={id:treatmentId,requestKey:body.requestKey,purpose:body.purpose,task:tasks[30],completion:{recorded:true,current:true,reason:'The exact completed training task has a current receipt.'}};
   row.version++;return route.fulfill({json:{id:treatmentId,riskId,taskId,version:row.version,reused:false}});
  }
  if(body.action==='PREPARE_REVIEW'){
   assert.equal(auth.user.id,editor);assert.equal(body.version,row.version);assert.equal(body.confirm,true);assert.deepEqual(body.evidenceIds,[fileId]);assert.equal(prepareWrites,0);prepareWrites++;
   review={id:reviewId,requestKey:body.requestKey,status:'PENDING',residualLikelihood:body.residualLikelihood,residualImpact:body.residualImpact,score:body.residualLikelihood*body.residualImpact,rationale:body.rationale,validUntil:body.validUntil,authorId:editor,reviewerId:null,reviewedAt:null,reviewNotes:null,version:1,current:true,reason:null,evidence:[file]};
   row.version++;row.status='UNDER_REVIEW';return route.fulfill({json:{id:reviewId,riskId,version:1,riskVersion:row.version,status:'PENDING',reused:false}});
  }
  assert.equal(body.action,'DECIDE_REVIEW');assert.equal(auth.user.id,owner);assert.equal(body.reviewId,reviewId);assert.equal(body.version,review.version);assert.equal(body.riskVersion,row.version);assert.equal(body.decision,'ACCEPTED');assert.equal(body.confirm,true);assert.equal(decisionWrites,0);decisionWrites++;
  review={...review,status:'ACCEPTED',reviewerId:owner,reviewedAt:now,reviewNotes:body.notes,version:review.version+1};row.status='ACCEPTED';row.version++;
  return route.abort('failed');
 });
 async function replaceAccount(next){auth=next;await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key:storageKey,value:auth});}
 async function expand(text){const summary=page.locator('summary').filter({hasText:text}).first();if(!await summary.evaluate(element=>element.parentElement.open))await summary.click();}
 try{
  await page.goto(base+href('/team/risks'));await page.getByRole('heading',{name:'Risk register',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open risk: Fictional operational risk 00',exact:true}).waitFor();assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),org);
  assert.equal(await page.getByRole('button',{name:'Open risk: '+title,exact:true}).count(),0);
  await page.getByRole('button',{name:'Next risks',exact:true}).click();await page.getByRole('button',{name:'Open risk: '+title,exact:true}).waitFor();
  await page.getByLabel('Search risks',{exact:true}).fill('widget');await page.getByRole('button',{name:'Search risks',exact:true}).click();
  await page.getByRole('button',{name:'Open risk: '+title,exact:true}).click();
  const detail=page.getByRole('region',{name:'Selected risk',exact:true});await detail.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('riskId'),riskId);await detail.getByText('Not recorded',{exact:true}).waitFor();
  await expand('Add treatment');await page.getByLabel('Find a treatment task',{exact:true}).fill('widget');await page.getByRole('button',{name:'Find tasks',exact:true}).click();
  await detail.getByRole('heading',{name:title,exact:true}).waitFor();await expand('Add treatment');
  await page.getByLabel('Treatment task',{exact:true}).selectOption(taskId);await page.getByLabel('Why this task treats the risk',{exact:true}).fill('The independently completed fictional training task records the work that addresses this exposure while retaining the need for a separate residual judgement.');
  await page.getByRole('button',{name:'Link treatment task',exact:true}).evaluate(button=>{button.click();button.click();});
  await detail.getByRole('link',{name:'Open treatment task →',exact:true}).waitFor();assert.equal(treatmentWrites,1);
  await detail.getByText('Not recorded',{exact:true}).waitFor();assert.equal(rows[30].score,16,'finishing a treatment cannot lower the inherent rating');
  const taskLink=new URL(await detail.getByRole('link',{name:'Open treatment task →',exact:true}).getAttribute('href'),base);assert.equal(taskLink.searchParams.get('organizationId'),org);assert.equal(taskLink.searchParams.get('taskId'),taskId);
  await expand('Prepare a residual risk review');await page.getByLabel('Residual likelihood',{exact:true}).selectOption('2');await page.getByLabel('Residual impact',{exact:true}).selectOption('3');
  await page.getByLabel('Review rationale',{exact:true}).fill('The fictional completed training record supports a lower remaining likelihood within this bounded exercise. Another administrator must judge the evidence and its limitations before accepting the proposal.');
  await page.getByRole('checkbox',{name:filename,exact:true}).check();assert.equal(await page.getByRole('button',{name:'Prepare risk review',exact:true}).isDisabled(),true);assert.equal(prepareWrites,0);
  await page.getByRole('checkbox',{name:'I have reviewed the treatment work, supporting evidence and proposed residual rating.',exact:true}).check();
  await page.getByRole('button',{name:'Prepare risk review',exact:true}).evaluate(button=>{button.click();button.click();});
  await detail.getByText('This proposal needs an independent eligible administrator. Its author cannot approve it.',{exact:true}).waitFor();assert.equal(prepareWrites,1);
  assert.equal(await page.getByRole('button',{name:'Accept residual risk decision',exact:true}).count(),0);await detail.getByText('Not recorded',{exact:true}).waitFor();
  await replaceAccount(session(owner));await page.getByRole('button',{name:'Accept residual risk decision',exact:true}).waitFor();
  await page.getByLabel('Independent review notes '+reviewId,{exact:true}).fill('Independently reviewed the fictional treatment receipt, original supporting record and the scope and limitations of this remaining risk assessment.');
  assert.equal(await page.getByRole('button',{name:'Accept residual risk decision',exact:true}).isDisabled(),true);
  await page.getByRole('checkbox',{name:'I independently reviewed this proposal, its treatment records and supporting evidence.',exact:true}).check();
  await page.getByRole('button',{name:'Accept residual risk decision',exact:true}).evaluate(button=>{button.click();button.click();});
  const recovery=page.getByRole('region',{name:'Unconfirmed risk action',exact:true});await recovery.waitFor();assert.equal(decisionWrites,1);
  failRead=true;await recovery.getByRole('button',{name:'Check saved risk',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fictional risk status temporarily unavailable.'}).waitFor();assert.equal(await detail.count(),0);
  await recovery.getByRole('button',{name:'Check saved risk',exact:true}).click();await detail.getByText('6 / 25',{exact:true}).waitFor();assert.equal(decisionWrites,1);
  assert.equal(await detail.getByText('Not recorded',{exact:true}).count(),0);
  const evidenceLink=new URL(await detail.getByRole('link',{name:filename+' →',exact:true}).getAttribute('href'),base);assert.equal(evidenceLink.pathname,'/team/evidence');assert.equal(evidenceLink.searchParams.get('evidenceId'),fileId);assert.equal(evidenceLink.searchParams.get('organizationId'),org);
  await page.getByLabel('Risk status',{exact:true}).selectOption('accepted');await page.getByRole('button',{name:'Open risk: '+title,exact:true}).waitFor();
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'risk register horizontal overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await detail.screenshot({path:'artifacts/usability/risk-'+name+'-accepted.png'});
  await page.reload();await detail.getByText('6 / 25',{exact:true}).waitFor();assert.equal(decisionWrites,1);
  stale=true;await page.getByRole('button',{name:'Refresh risks',exact:true}).click();await detail.getByText('Not recorded',{exact:true}).waitFor();await detail.getByText('The supporting evidence changed. Prepare a fresh review.',{exact:true}).waitFor();
  assert.equal(review.status,'ACCEPTED');assert.equal(prepareWrites,1);assert.equal(decisionWrites,1);await detail.screenshot({path:'artifacts/usability/risk-'+name+'-changed-evidence.png'});

  await page.goto(base+href('/team/risks',{riskId:missing}));await page.getByRole('alert').filter({hasText:'Risk not found in this company'}).waitFor();assert.equal(await detail.count(),0);
  const beforeUnavailable=reads.length;await page.goto(base+'/team/risks?'+new URLSearchParams({organizationId:missing,riskId}));await page.getByText(/linked organisation is unavailable/).waitFor();assert.equal(reads.length,beforeUnavailable);assert.equal(await detail.count(),0);
  await page.goto(base+href('/team/risks'));await page.getByRole('button',{name:'New risk',exact:true}).click();
  await page.getByLabel('Risk title',{exact:true}).fill('Fictional retained creation identity');await page.getByLabel('Risk description',{exact:true}).fill('This fictional risk verifies that a lost creation response is reconciled without recording a second risk.');
  await page.getByLabel('Risk owner',{exact:true}).selectOption(editor);await page.getByLabel('Why these ratings',{exact:true}).fill('A fictional human assessment records its basis explicitly for this bounded acceptance exercise.');
  await page.getByRole('checkbox',{name:control.title,exact:true}).check();
  await page.getByRole('button',{name:'Save risk',exact:true}).evaluate(button=>{button.click();button.click();});await recovery.waitFor();assert.equal(createWrites,1);
  await recovery.getByRole('button',{name:'Check saved risk',exact:true}).click();await detail.getByRole('heading',{name:'Fictional retained creation identity',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('riskId'),createdId);assert.equal(createWrites,1);assert.ok(reads.some(read=>read.requestKey===rows.find(row=>row.id===createdId).createKey));

  const held=new Promise(resolve=>{readHeld=resolve;}),finished=new Promise(resolve=>{readFinished=resolve;});holdRead=true;
  await page.getByRole('button',{name:'Refresh risks',exact:true}).click();await held;await replaceAccount(session(viewer));
  await detail.getByRole('heading',{name:'Fictional retained creation identity',exact:true}).waitFor();releaseRead();await finished;
  assert.equal(await page.getByRole('button',{name:'New risk',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Edit risk',exact:true}).count(),0);assert.equal(await page.locator('summary').filter({hasText:'Add treatment'}).count(),0);
  assert.deepEqual(posts.map(post=>post.action),['TREATMENT','PREPARE_REVIEW','DECIDE_REVIEW','CREATE']);assert.deepEqual(errors,[]);
  return {scenario:'risk-'+name,passed:true,overflowPx:overflow,createWrites,treatmentWrites,prepareWrites,decisionWrites,checks:['whole-company risk paging and search','exact task search and handoff','completed treatment does not lower risk automatically','explicit residual proposal with canonical evidence','independent decision prevents author approval','lost decision response reconciles with GET only','failed reconciliation withholds stale detail','accepted residual rating and original file link survive reload','changed evidence invalidates reliance without rewriting history','missing risk and company never substitute','creation reconciles by original request identity','late account response cannot restore write controls']};
 }catch(error){await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/risk-'+name+'-failure.png',fullPage:true,timeout:5000}).catch(()=>{});await writeFile('artifacts/usability/risk-'+name+'-failure.json',JSON.stringify({error:error.message,reads,posts,createWrites,treatmentWrites,prepareWrites,decisionWrites,pageErrors:errors},null,2)+'\n');throw error;}
 finally{releaseRead?.();await context.close();}
}
