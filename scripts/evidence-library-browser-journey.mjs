// Fictional HTTP/identity fixtures for the real Evidence Library and Assurance UI.
// Canonical file reuse, private bytes and database effects are tested in the
// separate actual private-services journey and PostgreSQL integration suite.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const org='c23e4567-e89b-42d3-a456-426614174000',first='c23e4567-e89b-42d3-a456-426614174001';
const owner='c23e4567-e89b-42d3-a456-426614174002',viewer='c23e4567-e89b-42d3-a456-426614174003',author='c23e4567-e89b-42d3-a456-426614174004';
const originalTask='c23e4567-e89b-42d3-a456-426614174005',taskId='c23e4567-e89b-42d3-a456-426614174006',assessmentId='c23e4567-e89b-42d3-a456-426614174007',missing='c23e4567-e89b-42d3-a456-426614174099';
const fileId='c23e4567-e89b-42d3-a456-426614175030',storageKey='sb-auth-fixture-auth-token';
const filename='Fictional training-record.pdf',taskTitle='Review fictional widget training';
const href=(path,values={})=>path+'?'+new URLSearchParams({organizationId:org,...values});
function session(id){return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:id===viewer?'viewer@example.invalid':'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}

export async function evidenceLibraryJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],reads=[];
 context.setDefaultTimeout(12_000);page.on('pageerror',error=>errors.push(error.message));
 let auth=session(owner),posts=0,downloads=0,failNext=false,holdNext=false,releaseRead,readHeld,readFinished;
 const bodyBytes=Buffer.from('%PDF-1.4\nFictional browser download fixture only.\n%%EOF');
 const now=new Date().toISOString();
 const rows=Array.from({length:34},(_,index)=>({id:'c23e4567-e89b-42d3-a456-'+String(426614175000+index),filename:index===30?filename:index===31?'Pending procedure.pdf':index===32?'Quarantined original.pdf':index===33?'Fictional procedure.docx':'Fictional evidence '+String(index).padStart(2,'0')+'.pdf',contentType:index===33?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf',sizeBytes:512,sha256:'a'.repeat(64),scanStatus:index===32?'INFECTED':'CLEAN',reviewStatus:index===31?'PENDING_REVIEW':'APPROVED',reviewVersion:2,obligationId:originalTask,createdAt:now,reviewedAt:index===31?null:now,uploadedById:index===30?owner:author,reviewerId:author,uploaderName:index===30?'owner@example.invalid':'colleague@example.invalid',reviewerName:'reviewer@example.invalid',originalTask:{id:originalTask,title:'Original training evidence collection',status:'COMPLETE',href:href('/team/work',{taskId:originalTask})},taskEvidenceHref:href('/team/evidence',{taskId:originalTask})}));
 const allTargets=Array.from({length:31},(_,index)=>({id:index===30?taskId:'c23e4567-e89b-42d3-a456-'+String(426614176000+index),title:index===30?taskTitle:'Fictional source task '+String(index).padStart(2,'0'),status:'OPEN',ownerName:'Fictional operator',href:href('/team/assurance',{taskId:index===30?taskId:'c23e4567-e89b-42d3-a456-'+String(426614176000+index),evidenceId:fileId})}));
 const summary={all:34,approved:32,pending:1,rejected:0,quarantined:1,mine:1};
 function item(row){const writer=auth.user.id!==viewer;return {...row,canReview:writer&&row.scanStatus==='CLEAN'&&row.reviewStatus==='PENDING_REVIEW',canReuse:writer&&row.scanStatus==='CLEAN',reuseReason:!writer?'An editor or administrator can prepare an evidence assessment.':row.scanStatus!=='CLEAN'?'This file is quarantined and cannot be used.':'Check the file against the new task. Its existing file approval does not approve a different use.'};}
 function library(url){
  let filtered=rows;const q=(url.searchParams.get('q')||'').toLowerCase(),review=url.searchParams.get('review')||'all',format=url.searchParams.get('format')||'all',uploader=url.searchParams.get('uploader')||'all';
  if(q)filtered=filtered.filter(row=>(row.filename+' '+row.originalTask.title).toLowerCase().includes(q));
  if(review==='quarantined')filtered=filtered.filter(row=>row.scanStatus!=='CLEAN');
  else if(review!=='all')filtered=filtered.filter(row=>row.scanStatus==='CLEAN'&&(review==='approved'?row.reviewStatus==='APPROVED':review==='pending'?row.reviewStatus==='PENDING_REVIEW':row.reviewStatus==='REJECTED'));
  if(format!=='all')filtered=filtered.filter(row=>format==='pdf'?row.contentType==='application/pdf':row.contentType!=='application/pdf');
  if(uploader==='mine')filtered=filtered.filter(row=>row.uploadedById===auth.user.id);
  const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(Number(url.searchParams.get('page')||1),pages),selectedId=url.searchParams.get('evidenceId');
  let selected=null;
  if(selectedId){
   const row=rows.find(value=>value.id===selectedId);if(!row)return null;
   const targetQ=(url.searchParams.get('targetQ')||'').toLowerCase(),usable=item(row).canReuse?allTargets.filter(target=>target.title.toLowerCase().includes(targetQ)):[],targetPages=Math.max(1,Math.ceil(usable.length/25)),targetPage=Math.min(Number(url.searchParams.get('targetPage')||1),targetPages);
   selected={...item(row),uses:{scope:'source-linked assessments',items:[{id:assessmentId,taskId,title:taskTitle,status:'ACCEPTED',current:true,reason:'Saved source and reviewed evidence still match.',href:href('/team/assurance',{taskId,assessmentId})},{id:'c23e4567-e89b-42d3-a456-426614174008',taskId:originalTask,title:'Earlier fictional source assessment',status:'ACCEPTED',current:false,reason:'The earlier source version changed; independent review is needed.',href:href('/team/assurance',{taskId:originalTask,assessmentId:'c23e4567-e89b-42d3-a456-426614174008'})}],total:2,truncated:false},targets:{items:usable.slice((targetPage-1)*25,targetPage*25),total:usable.length,page:targetPage,pages:targetPages,pageSize:25}};
  }
  return {organizationId:org,role:auth.user.id===viewer?'VIEWER':'OWNER',canPrepare:auth.user.id!==viewer,items:filtered.slice((page-1)*25,page*25).map(item),total:filtered.length,page,pages,pageSize:25,summary,selected,generatedAt:now};
 }
 await context.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:auth});
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 await context.route('**/api/ai/analyse',route=>route.fulfill({json:{workspaceEnabled:true}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:auth.user.id,email:auth.user.email,organisations:[{id:first,name:'First fictional company',role:auth.user.id===viewer?'VIEWER':'OWNER'},{id:org,name:'Fictional evidence company',role:auth.user.id===viewer?'VIEWER':'OWNER'}]}}));
 await context.route(url=>url.pathname==='/api/workspace/evidence/library',async route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET','library navigation must not mutate data');
  const organizationId=url.searchParams.get('organizationId');reads.push({organizationId,evidenceId:url.searchParams.get('evidenceId'),actor:auth.user.id,q:url.searchParams.get('q'),page:url.searchParams.get('page')});
  assert.equal(organizationId,org,'linked, missing and account-replaced library requests must preserve the requested company');
  if(failNext){failNext=false;return route.fulfill({status:503,json:{error:'Fictional evidence library temporarily unavailable.'}});}
  const body=library(url);if(!body)return route.fulfill({status:404,json:{error:'The selected evidence is unavailable in this company.'}});
  const held=holdNext;if(held){holdNext=false;await new Promise(resolve=>{releaseRead=resolve;readHeld();});}
  try{await route.fulfill({json:body});}catch{}finally{if(held)readFinished();}
 });
 await context.route(url=>url.pathname==='/api/workspace/evidence/'+fileId,route=>{
  assert.equal(route.request().method(),'GET');assert.equal(new URL(route.request().url()).searchParams.get('organizationId'),org);downloads++;
  return route.fulfill({status:200,body:bodyBytes,headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="'+filename+'"'}});
 });
 await context.route(url=>url.pathname==='/api/workspace/assurance',route=>{
  const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'){posts++;return route.fulfill({status:409,json:{error:'The library handoff must not create an assessment automatically.'}});}
  assert.equal(url.searchParams.get('organizationId'),org);assert.equal(url.searchParams.get('taskId'),taskId);
  return route.fulfill({json:{selectedTaskId:taskId,selectedAssessmentId:null,tasks:[{id:taskId,title:taskTitle,status:'OPEN',ownerName:'Fictional operator',dueDate:now}],evidence:[rows[30],rows[0]],source:{quote:'Fictional operators must keep current training records.',title:'Fictional training requirement',url:'https://www.gov.uk/example',hash:'c'.repeat(64)},contextIssue:null,assessments:[],nextStep:'Choose supporting files and prepare a content-level assessment.',aiEnabled:false,taskLimitReached:false,assessmentLimitReached:false}});
 });
 await context.route('**/api/workspace/work*',route=>route.fulfill({json:{organizationId:org,task:{id:taskId,title:taskTitle,status:'OPEN',ownerName:'Fictional operator',assignee:null,originKey:'fictional-training'},workflow:{stage:'ASSESSMENT_REQUIRED',title:'Prepare the evidence assessment',detail:'Review the original file against this task before preparing.',label:'Assess supporting evidence',href:href('/team/assurance',{taskId}),actor:'you',canAct:true,verified:false,assessmentId:null}}}));
 async function replaceAccount(next){auth=next;await page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close();},{key:storageKey,value:auth});}
 try{
  await page.goto(base+href('/team/evidence'));
  await page.getByRole('heading',{name:'Evidence library',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open evidence: Fictional evidence 00.pdf',exact:true}).waitFor();
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/evidence-library-'+name+'-overview.png',fullPage:false});
  assert.equal(await page.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),org);
  assert.equal(await page.getByRole('button',{name:'Open evidence: '+filename,exact:true}).count(),0,'fixture original starts beyond the first page');
  await page.getByRole('button',{name:'Next files',exact:true}).click();
  await page.getByRole('button',{name:'Open evidence: '+filename,exact:true}).waitFor();
  await page.getByLabel('Review status',{exact:true}).selectOption('pending');
  await page.getByRole('button',{name:'Open evidence: Pending procedure.pdf',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Open evidence: '+filename,exact:true}).count(),0);
  await page.getByLabel('Review status',{exact:true}).selectOption('quarantined');
  await page.getByRole('button',{name:'Open evidence: Quarantined original.pdf',exact:true}).click();
  const quarantined=page.getByRole('region',{name:'Selected evidence',exact:true});
  await quarantined.getByRole('heading',{name:'Quarantined original.pdf',exact:true}).waitFor();
  assert.equal(await quarantined.getByRole('button',{name:'Download verified original',exact:true}).isDisabled(),true);
  assert.equal(await quarantined.getByLabel('Task to assess',{exact:true}).count(),0,'quarantined files cannot offer reuse');
  await quarantined.getByRole('button',{name:'Back to all evidence',exact:true}).click();
  await page.getByLabel('Review status',{exact:true}).selectOption('all');
  await page.getByLabel('Document format',{exact:true}).selectOption('docx');
  await page.getByRole('button',{name:'Open evidence: Fictional procedure.docx',exact:true}).waitFor();
  await page.getByLabel('Document format',{exact:true}).selectOption('all');
  await page.getByLabel('Uploaded by',{exact:true}).selectOption('mine');
  await page.getByRole('button',{name:'Open evidence: '+filename,exact:true}).waitFor();
  await page.getByLabel('Uploaded by',{exact:true}).selectOption('all');
  await page.getByLabel('Search evidence',{exact:true}).fill('training-record');await page.getByRole('button',{name:'Search files',exact:true}).click();
  await page.getByRole('button',{name:'Open evidence: '+filename,exact:true}).click();
  const detail=page.getByRole('region',{name:'Selected evidence',exact:true});
  await detail.getByRole('heading',{name:filename,exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('evidenceId'),fileId);
  await detail.getByRole('heading',{name:'Recorded assessment uses',exact:true}).waitFor();
  await detail.getByText('The earlier source version changed; independent review is needed.',{exact:true}).waitFor();
  const originalHref=new URL(await detail.getByRole('link',{name:'Open original task',exact:true}).getAttribute('href'),base);
  assert.equal(originalHref.searchParams.get('taskId'),originalTask);assert.equal(originalHref.searchParams.get('organizationId'),org);
  const downloaded=page.waitForEvent('download');await detail.getByRole('button',{name:'Download verified original',exact:true}).click();
  assert.deepEqual(await readFile(await (await downloaded).path()),bodyBytes);assert.equal(downloads,1);
  await detail.getByLabel('Find a task for this evidence',{exact:true}).fill('widget');await detail.getByRole('button',{name:'Find tasks',exact:true}).click();
  await detail.getByLabel('Task to assess',{exact:true}).selectOption(taskId);
  const reuse=detail.getByRole('link',{name:/^Use this evidence/});await reuse.waitFor();
  const link=new URL(await reuse.getAttribute('href'),base);assert.equal(link.pathname,'/team/assurance');assert.equal(link.searchParams.get('organizationId'),org);assert.equal(link.searchParams.get('taskId'),taskId);assert.equal(link.searchParams.get('evidenceId'),fileId);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'evidence library horizontal overflow '+overflow);
  await detail.screenshot({path:'artifacts/usability/evidence-library-'+name+'.png'});
  await reuse.click();
  const selection=page.getByRole('checkbox',{name:/Fictional training-record\.pdf/});await selection.waitFor();
  assert.equal(await selection.isChecked(),true);assert.equal(await page.getByRole('checkbox',{name:/Fictional evidence 00\.pdf/}).isChecked(),false,'handoff does not substitute or select another file');
  await page.getByRole('complementary',{name:'Evidence Library selection',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Find evidence passages',exact:true}).isDisabled(),true,'file selection does not imply processing consent');
  assert.equal(posts,0);await page.screenshot({path:'artifacts/usability/evidence-library-handoff-'+name+'.png',fullPage:false});

  await page.goto(base+href('/team/evidence',{evidenceId:fileId}));await detail.getByRole('heading',{name:filename,exact:true}).waitFor();
  failNext=true;await page.getByRole('button',{name:'Refresh library',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fictional evidence library temporarily unavailable.'}).waitFor();
  assert.equal(await detail.count(),0,'failed reads discard previously displayed exact-file detail');
  await page.getByRole('button',{name:'Refresh library',exact:true}).click();await detail.getByRole('heading',{name:filename,exact:true}).waitFor();
  await page.goto(base+href('/team/evidence',{evidenceId:missing}));
  await page.getByRole('alert').filter({hasText:'The selected evidence is unavailable in this company.'}).waitFor();
  assert.equal(await detail.count(),0,'unavailable exact records never substitute another file');
  await page.getByRole('button',{name:'Back to all evidence',exact:true}).click();
  await page.getByRole('button',{name:'Open evidence: Fictional evidence 00.pdf',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('evidenceId'),false);
  const beforeUnavailable=reads.length;
  await page.goto(base+'/team/evidence?'+new URLSearchParams({organizationId:missing,evidenceId:fileId}));
  await page.getByText(/linked organisation is unavailable/).waitFor();assert.equal(reads.length,beforeUnavailable,'an unavailable company must not fall back to another membership');
  assert.equal(await detail.count(),0);

  await page.goto(base+href('/team/evidence',{evidenceId:fileId}));await detail.getByRole('heading',{name:filename,exact:true}).waitFor();
  const held=new Promise(resolve=>{readHeld=resolve;}),finished=new Promise(resolve=>{readFinished=resolve;});holdNext=true;
  await page.getByRole('button',{name:'Refresh library',exact:true}).click();await held;
  await replaceAccount(session(viewer));
  await page.getByText('An editor or administrator can prepare an evidence assessment.',{exact:true}).waitFor();
  releaseRead();await finished;
  assert.equal(await page.getByRole('link',{name:/^Use this evidence/}).count(),0,'late previous-account results cannot restore preparation controls');
  assert.equal(await page.getByLabel('Task to assess',{exact:true}).count(),0);
  assert.ok(reads.some(read=>read.actor===viewer),'replacement account obtains its own library projection');
  assert.equal(posts,0);assert.deepEqual(errors,[]);
  return {scenario:'evidence-library-'+name,passed:true,overflowPx:overflow,checks:['whole-company paging and search','review/format/uploader filters','quarantine blocks download and reuse','exact original and recorded uses','same-file source-task handoff without write','failed and unavailable exact selection','unavailable company isolation','late previous-account response rejected'],libraryReads:reads.length,downloads,assessmentWrites:posts};
 }catch(error){await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/evidence-library-'+name+'-failure.png',fullPage:true}).catch(()=>{});await writeFile('artifacts/usability/evidence-library-'+name+'-failure.json',JSON.stringify({error:error.message,reads,posts,downloads,pageErrors:errors},null,2)+'\n');throw error;}
 finally{releaseRead?.();await context.close();}
}
