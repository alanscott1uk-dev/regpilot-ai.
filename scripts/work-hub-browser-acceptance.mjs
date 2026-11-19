/** Fictional authenticated UI fixtures. Real PostgreSQL policy/transaction tests run separately. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const port=await new Promise((resolve,reject)=>{const s=createServer().once('error',reject).listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base='http://127.0.0.1:'+port;
const host=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,NODE_ENV:'production',REGPILOT_WORKSPACE_ENABLED:'false',REGPILOT_AI_ENABLED:'false',REGPILOT_PAID_SERVICES_ENABLED:'false',REGPILOT_CRON_ENABLED:'false'},stdio:'ignore'});
let browser;
const results=[];
async function journey(viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',other='123e4567-e89b-42d3-a456-426614174002';
 const auth={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),auth);
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 let role='OWNER',applyCount=0,startCount=0,createCount=0,stale=false;
 let evidenceReady=false,completionReads=0,completionPosts=0,completionWrites=0,completionMode='stale';
 let releaseCompletion,completionSubmitted,holdReadinessTask='',releaseReadiness,readinessHeld,readinessFinished;
 let legacyListReads=0,exactHandoffReads=0,holdLegacyQueue=false,legacyQueueHeld,releaseLegacyQueue,legacyQueueFinished;
 const completionRecords=new Map(),proofFiles=[
  {id:'423e4567-e89b-42d3-a456-426614174001',filename:'Approved control procedure.pdf',sha256:'a'.repeat(64),reviewVersion:1,reviewedAt:'2026-11-18T09:00:00.000Z',required:false},
  {id:'423e4567-e89b-42d3-a456-426614174002',filename:'Independent review notes.pdf',sha256:'b'.repeat(64),reviewVersion:2,reviewedAt:'2026-11-18T10:00:00.000Z',required:false}
 ];
 const evidenceHref=id=>'/team/evidence?'+new URLSearchParams({organizationId:org,taskId:id});
 const workflowFor=(task,detail=false)=>{
  const complete=task.status==='COMPLETE',stage=complete?'COMPLETED':evidenceReady?(detail?'READY_TO_COMPLETE':'COMPLETION_CHECK'):'FILE_REVIEW';
  return {stage,title:complete?'Completion recorded':evidenceReady?(detail?'Ready for your completion decision':'Check completion readiness'):'Supporting files need review',detail:complete?'The outcome and its evidence were saved.':evidenceReady?'The saved file approvals are available for an explicit completion decision.':'A different administrator must inspect the submitted files.',label:complete?'Review completed work':evidenceReady?'Open completion check':'Review supporting evidence',href:complete?'/team/work/reviews?'+new URLSearchParams({organizationId:org,taskId:task.id}):evidenceReady?'/team/work?'+new URLSearchParams({organizationId:org,taskId:task.id}):evidenceHref(task.id),actor:role==='OWNER'?'you':'teammate',canAct:role==='OWNER',verified:detail,assessmentId:null};
 };
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:user,email:auth.user.email,organisations:[{id:org,name:'Fictional work company',role},{id:other,name:'Empty second company',role}]}}));
 let rows=Array.from({length:31},(_,i)=>({id:'223e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),title:'Fictional action '+String(i).padStart(2,'0'),category:'Quality',ownerName:'Unassigned',assigneeId:null,dueDate:'2026-12-01T00:00:00.000Z',status:'OPEN',updatedAt:'2026-11-18T00:00:00.000Z',originKey:null,controlId:null,connectorId:null,assignee:null,managedControl:null,changeAction:null,auditRequest:null,accessItem:null,_count:{evidence:1},evidenceToReview:true,planningBlocked:null,canPlan:true,workflow:{label:'Review supporting evidence',href:'/team/evidence?organizationId='+org}}));
 const handoffTask={...rows[0],id:'523e4567-e89b-42d3-a456-426614174099',title:'Fictional linked exception task beyond the first page',notes:'An older task opened through its scoped exception handoff.',sourceUrl:null,sourceCheckedAt:null,createdAt:rows[0].updatedAt,completionException:false,completionRationale:''};
 const recentOtherTasks=Array.from({length:100},(_,index)=>({...handoffTask,id:'623e4567-e89b-42d3-a456-'+String(index).padStart(12,'0'),title:'Recent second-company task '+index}));
 const legacyMainTask={...handoffTask,id:rows[0].id,title:'Fictional current-company team task'};
 await context.route('**/api/workspace/obligations*',async route=>{
  const requestedOrg=new URL(route.request().url()).searchParams.get('organizationId');
  assert.equal(route.request().method(),'GET');assert.ok([org,other].includes(requestedOrg));legacyListReads++;
  const held=holdLegacyQueue&&requestedOrg===other;
  if(held){holdLegacyQueue=false;await new Promise(resolve=>{releaseLegacyQueue=resolve;legacyQueueHeld();});}
  try{await route.fulfill({json:{items:requestedOrg===other?recentOtherTasks:[legacyMainTask]}});}catch{}finally{if(held)legacyQueueFinished();}
 });
 await context.route('**/api/workspace/work*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'){
   const body=request.postDataJSON();
   if(body.operation==='create'){
    createCount++;const created={...rows[0],id:'323e4567-e89b-42d3-a456-426614174099',title:body.title,category:body.category,assigneeId:body.assigneeId,assignee:{id:user,email:'owner@example.invalid'},ownerName:'owner@example.invalid',status:'OPEN',dueDate:body.dueDate+'T00:00:00.000Z',updatedAt:new Date().toISOString()};rows.push(created);return route.fulfill({status:201,json:{id:created.id,title:created.title}});
   }
   if(body.operation==='start'){
    startCount++;rows=rows.map(row=>row.id===body.id?{...row,status:'IN_PROGRESS',updatedAt:new Date().toISOString()}:row);return route.fulfill({json:{id:body.id,status:'IN_PROGRESS'}});
   }
   const items=body.items.map(selection=>{const item=rows.find(r=>r.id===selection.id);return {id:item.id,title:item.title,updatedAt:item.updatedAt,before:{ownerName:item.ownerName,dueDate:item.dueDate.slice(0,10),assigneeId:item.assigneeId},after:{ownerName:'owner@example.invalid',assigneeId:user,dueDate:body.changes.dueDate||item.dueDate.slice(0,10)}};});
   if(body.operation==='apply'){
    if(stale)return route.fulfill({status:409,json:{error:'A selected task changed. Refresh the list and preview again.'}});
    applyCount++;rows=rows.map(row=>items.some(x=>x.id===row.id)?{...row,ownerName:'owner@example.invalid',assigneeId:user,assignee:{id:user,email:'owner@example.invalid'},dueDate:items.find(x=>x.id===row.id).after.dueDate+'T00:00:00.000Z',updatedAt:new Date().toISOString()}:row);
   }
   return route.fulfill({json:{items,token:'a'.repeat(64),reason:body.reason,applied:body.operation==='apply'?items.length:0,batchId:null}});
  }
  if(url.searchParams.has('taskId')){
   if(url.searchParams.get('organizationId')===other){
    assert.equal(url.searchParams.get('taskId'),handoffTask.id);exactHandoffReads++;
    return route.fulfill({json:{organizationId:other,task:handoffTask}});
   }
   const task=rows.find(r=>r.id===url.searchParams.get('taskId'));
   const saved=completionRecords.get(task.id);
   return route.fulfill({json:{organizationId:org,task:{...task,notes:'Inspect the source, evidence and next step together.',sourceUrl:'https://www.gov.uk/example',sourceCheckedAt:null,createdAt:task.updatedAt,completedAt:saved?.completed.completedAt||null,completionException:false,completionRationale:saved?.receipt.notes||'',evidence:[{id:'fictional-file',filename:'Fictional evidence.pdf',scanStatus:'CLEAN',reviewStatus:evidenceReady?'APPROVED':'PENDING_REVIEW',createdAt:task.updatedAt,reviewedAt:null}],assuranceAssessments:[],intelligenceDecisions:[]},evidenceLimited:false,history:[...(saved?[{id:saved.completed.eventId,action:'work.completed',createdAt:saved.completed.completedAt}]:[]),{id:'event',action:'obligation.created',createdAt:task.updatedAt}],historyLimited:false,planningBlocked:null,canPlan:role==='OWNER'&&task.status!=='COMPLETE',canStart:role!=='VIEWER'&&task.status==='OPEN',workflow:workflowFor(task,true)}});
  }
  const pageNumber=Number(url.searchParams.get('page')||1),q=url.searchParams.get('q')||'',view=url.searchParams.get('view')||'open',requestedOrg=url.searchParams.get('organizationId');
  const filtered=requestedOrg===other?[]:rows.filter(r=>r.title.includes(q)&&(view==='complete'?r.status==='COMPLETE':r.status!=='COMPLETE')&&(view!=='mine'||r.assigneeId===user));
  const open=rows.filter(r=>r.status!=='COMPLETE');
  return route.fulfill({json:{organizationId:requestedOrg,actorId:user,role,items:filtered.slice((pageNumber-1)*25,pageNumber*25).map(r=>({...r,canPlan:role==='OWNER'&&r.status!=='COMPLETE',workflow:workflowFor(r)})),total:filtered.length,page:pageNumber,pages:Math.max(1,Math.ceil(filtered.length/25)),pageSize:25,query:{view,q,page:pageNumber},counts:{open:open.length,mine:open.filter(r=>r.assigneeId===user).length,overdue:0,unassigned:open.filter(r=>!r.assigneeId).length,review:open.length,complete:completionRecords.size},members:[{role:'OWNER',user:{id:user,email:'owner@example.invalid'}}],membersLimited:false,generatedAt:new Date().toISOString()}});
 });
 await context.route('**/api/workspace/work/*/completion*',async route=>{
  const request=route.request(),url=new URL(request.url()),id=url.pathname.split('/').at(-2),task=rows.find(row=>row.id===id);
  assert.ok(task,'completion must reference a recorded task');
  if(request.method()==='POST'){
   completionPosts++;
   const body=request.postDataJSON();
   assert.equal(body.organizationId,org);assert.equal(body.confirm,true);assert.ok(body.notes.trim().length>=20);assert.ok(body.token);assert.ok(body.evidenceIds.length>=1&&body.evidenceIds.length<=10);
   if(completionMode==='stale')return route.fulfill({status:409,json:{error:'The reviewed evidence changed. Refresh the completion check.'}});
   if(completionMode==='held')await new Promise(resolve=>{releaseCompletion=resolve;completionSubmitted();});
   const completedAt=new Date().toISOString(),eventId='completed-'+id,proofHash='c'.repeat(64),evidence=proofFiles.filter(file=>body.evidenceIds.includes(file.id));
   const completed={eventId,completedAt,proofHash,evidenceCount:evidence.length};
   const receipt={format:'regpilot-work-completion',version:1,organizationId:org,task:{id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:task.assigneeId,dueDate:task.dueDate,statusBefore:task.status,updatedAtBefore:task.updatedAt},completedAt,completedById:user,notes:body.notes,source:null,control:null,assessment:null,evidence:evidence.map(file=>({...file,reviewerId:'reviewer-fixture',uploadedById:user})),scope:'Recorded task completion with the evidence and reviews held at that time.'};
   completionWrites++;completionRecords.set(id,{completed,receipt});rows=rows.map(row=>row.id===id?{...row,status:'COMPLETE',updatedAt:completedAt}:row);
   if(completionMode==='uncertain')return route.abort('failed');
   return route.fulfill({json:{taskId:id,status:'COMPLETE',...completed,reused:false}});
  }
  completionReads++;assert.equal(url.searchParams.get('organizationId'),org);
  const saved=completionRecords.get(id),canComplete=role!=='VIEWER'&&!saved,ready=canComplete&&evidenceReady;
  const body={organizationId:org,task:{id,title:task.title,status:task.status,updatedAt:task.updatedAt},canComplete,ready,token:ready?'d'.repeat(64):null,blockers:saved?[]:role==='VIEWER'?[{code:'role',message:'A workspace editor must record completion.',href:'',label:''}]:evidenceReady?[]:[{code:'evidence_review_required',message:'Supporting evidence needs an independent review before this task can be completed.',href:evidenceHref(id),label:'Review supporting evidence'}],evidence:evidenceReady?proofFiles:[],evidenceLimit:10,assessment:null,completed:saved?.completed||null,receipt:saved?.receipt||null,scope:'This records a task decision and its supporting evidence.'};
  if(holdReadinessTask===id){holdReadinessTask='';await new Promise(resolve=>{releaseReadiness=resolve;readinessHeld();});try{await route.fulfill({json:body});}catch{}finally{readinessFinished();}return;}
  return route.fulfill({json:body});
 });
 try{
  await page.goto(base+'/team/work',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Move the work forward.',exact:true}).waitFor();
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await page.getByText('Fictional action 30',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Previous page',exact:true}).click();
  await page.getByLabel('Search all tasks',{exact:true}).fill('action 30');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByText('Fictional action 30',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Fictional action 30/}).click();
  const detail=page.getByRole('dialog');await detail.getByText('Fictional evidence.pdf',{exact:true}).waitFor();
  await detail.getByRole('heading',{name:'Source and control context',exact:true}).waitFor();
  assert.ok((await detail.getByRole('link',{name:'Manage evidence',exact:false}).getAttribute('href')).includes('organizationId='+org));
  await detail.getByRole('button',{name:'Start task',exact:true}).click();
  await detail.getByText('In progress',{exact:true}).waitFor();assert.equal(startCount,1);
  const completion=detail.getByRole('region',{name:'Task completion',exact:true});
  await completion.getByRole('heading',{name:'Before you can finish',exact:true}).waitFor();
  const blockerLink=await completion.getByRole('link',{name:'Review supporting evidence',exact:false}).getAttribute('href');
  assert.ok(blockerLink.includes('organizationId='+org)&&blockerLink.includes('taskId='+rows[30].id),'blocker keeps the exact organisation and task');
  assert.equal(await completion.getByRole('button',{name:'Complete with verified evidence',exact:true}).count(),0,'pending review cannot be completed');
  evidenceReady=true;
  await completion.getByRole('button',{name:'Refresh completion check',exact:true}).click();
  await completion.getByRole('heading',{name:'Ready to complete',exact:true}).waitFor();
  const completeButton=completion.getByRole('button',{name:'Complete with verified evidence',exact:true});
  const confirmCompletion=completion.getByRole('checkbox',{name:'I have checked the selected evidence and confirm this work is complete.',exact:true});
  assert.equal(await completeButton.isDisabled(),true,'readiness alone does not submit');
  await completion.getByRole('checkbox',{name:/Independent review notes.pdf/}).uncheck();
  await completion.getByLabel('What was completed?',{exact:true}).fill('The updated procedure is in use and the approved evidence records the work completed.');
  await confirmCompletion.focus();await page.keyboard.press('Space');assert.equal(await confirmCompletion.isChecked(),true,'confirmation is keyboard accessible');
  const modalOverflow=await detail.evaluate(element=>Math.max(0,element.scrollWidth-element.clientWidth));assert.ok(modalOverflow<=3,'completion modal horizontal overflow '+modalOverflow);
  await completion.getByRole('heading',{name:'Ready to complete',exact:true}).scrollIntoViewIfNeeded();
  await mkdir('artifacts/usability',{recursive:true});await detail.screenshot({path:'artifacts/usability/work-completion-ready-'+name+'.png'});
  const readsBeforeStale=completionReads;
  await completeButton.click();
  await completion.getByRole('alert').filter({hasText:'The reviewed evidence changed'}).waitFor();
  assert.equal(completionPosts,1);assert.equal(completionWrites,0);assert.equal(completionReads,readsBeforeStale,'a stale write is not retried or refreshed automatically');
  assert.equal(await completeButton.count(),0,'stale proof is discarded');
  await completion.getByRole('button',{name:'Check latest task status',exact:true}).click();
  await completion.getByRole('heading',{name:'Ready to complete',exact:true}).waitFor();
  assert.equal(await confirmCompletion.isChecked(),false,'refreshed proof requires a new confirmation');
  await completion.getByRole('checkbox',{name:/Independent review notes.pdf/}).uncheck();
  await confirmCompletion.check();
  completionMode='held';const submitted=new Promise(resolve=>{completionSubmitted=resolve;});
  await completeButton.evaluate(button=>{button.click();button.click();});await submitted;
  assert.equal(completionPosts,2,'rapid activation sends one completion request');
  assert.equal(await detail.getByRole('button',{name:'Close task details',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await detail.isVisible(),true,'in-flight completion keeps its response visible');
  releaseCompletion();
  await completion.getByRole('heading',{name:'Task completed',exact:true}).waitFor();
  assert.equal(completionWrites,1);assert.equal(completionPosts,2);
  await detail.getByText('Completed',{exact:true}).waitFor();
  await completion.getByText('Inspect completion record',{exact:true}).click();
  await completion.getByText('Approved control procedure.pdf',{exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await completion.getByRole('button',{name:'Download completion record',exact:true}).click();
  const savedDownload=await downloaded,record=JSON.parse(await readFile(await savedDownload.path(),'utf8'));
  assert.equal(record.receipt.organizationId,org);assert.equal(record.receipt.task.id,rows[30].id);assert.equal(record.receipt.evidence.length,1);assert.equal(record.receipt.evidence[0].sha256,'a'.repeat(64));assert.equal(record.record.proofHash,'c'.repeat(64));
  await completion.getByText('Inspect completion record',{exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await detail.evaluate(element=>element.scrollWidth-element.clientWidth)<=3,'receipt fingerprints wrap within the modal');
  await detail.screenshot({path:'artifacts/usability/work-completion-record-'+name+'.png'});
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'No tasks match this view.',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Work views',exact:true}).getByRole('button',{name:/^Completed/}).click();
  await page.getByText('Fictional action 30',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Fictional action 30/}).click();
  await completion.getByRole('heading',{name:'Task completed',exact:true}).waitFor();
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
  await page.getByRole('navigation',{name:'Work views',exact:true}).getByRole('button',{name:/^Open work/}).click();
  await page.getByLabel('Search all tasks',{exact:true}).fill('');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Fictional action 00',exact:true}).check();
  const planner=page.getByRole('region',{name:'Bulk planning'});
  await planner.getByLabel('Assign selected work to').selectOption(user);
  await planner.getByLabel('Reason for this change').fill('Fictional workload allocation reviewed by the administrator.');
  await planner.getByRole('button',{name:'Preview changes',exact:true}).click();
  await page.getByRole('region',{name:'Change preview'}).waitFor();assert.equal(applyCount,0,'preview must not write');
  await page.getByRole('button',{name:'Apply 1 reviewed change',exact:true}).click();
  await page.getByRole('status').filter({hasText:'1 task plan updated'}).waitFor();assert.equal(applyCount,1);
  await page.getByRole('button',{name:'Board',exact:true}).click();
  await page.getByText('The board shows this results page; use pagination to continue through all matches.',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Select Fictional action 01',exact:true}).check();
  await planner.getByLabel('Assign selected work to').selectOption(user);
  await planner.getByLabel('Reason for this change').fill('Second fictional allocation used to test concurrent edits.');
  await planner.getByRole('button',{name:'Preview changes',exact:true}).click();
  await page.getByRole('region',{name:'Change preview'}).waitFor();stale=true;
  await page.getByRole('button',{name:'Apply 1 reviewed change',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'A selected task changed'}).waitFor();assert.equal(applyCount,1,'stale preview cannot apply');
  assert.equal(await page.getByRole('region',{name:'Change preview'}).count(),0);
  holdReadinessTask=rows[2].id;
  const heldReadiness=new Promise(resolve=>{readinessHeld=resolve;}),finishedReadiness=new Promise(resolve=>{readinessFinished=resolve;});
  await page.getByRole('button',{name:/Fictional action 02/}).click();await heldReadiness;
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
  await page.getByLabel('Organisation',{exact:true}).selectOption(other);
  await page.getByRole('heading',{name:'No tasks match this view.',exact:true}).waitFor();
  releaseReadiness();await finishedReadiness;
  assert.equal(await page.getByRole('region',{name:'Task completion',exact:true}).count(),0,'old completion proof stays cancelled after switching organisations');
  assert.equal(await page.getByText('Approved control procedure.pdf',{exact:true}).count(),0);
  assert.equal(await page.getByRole('region',{name:'Bulk planning'}).count(),0,'switching organisations clears selected private work');
  await page.getByLabel('Organisation',{exact:true}).selectOption(org);
  await page.getByRole('checkbox',{name:'Select Fictional action 00',exact:true}).waitFor();
  await page.getByRole('button',{name:'Create a task',exact:true}).click();
  const creator=page.getByRole('region',{name:'Create task',exact:true});
  await creator.getByLabel('Task title',{exact:true}).fill('Fictional newly created action');
  await creator.getByLabel('Task due date',{exact:true}).fill('2026-12-15');
  await creator.getByRole('button',{name:'Save assigned task',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Task created with a workspace assignee'}).waitFor();assert.equal(createCount,1);
  await page.getByLabel('Search all tasks',{exact:true}).fill('Fictional newly created');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByText('Fictional newly created action',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Fictional newly created action/}).click();
  await completion.getByRole('heading',{name:'Ready to complete',exact:true}).waitFor();
  await completion.getByLabel('What was completed?',{exact:true}).fill('The new action is finished and both independently reviewed files support the outcome.');
  await confirmCompletion.check();completionMode='uncertain';
  await completeButton.click();await completion.getByRole('alert').filter({hasText:'Check the latest task status'}).waitFor();
  assert.equal(await completion.getByRole('heading',{name:'Task completed',exact:true}).count(),0,'a lost response does not claim success');
  assert.equal(completionPosts,3);assert.equal(completionWrites,2);
  await completion.getByRole('button',{name:'Check latest task status',exact:true}).click();
  await completion.getByRole('heading',{name:'Task completed',exact:true}).waitFor();
  await detail.getByText('Completed',{exact:true}).waitFor();
  assert.equal(completionPosts,3,'read-only reconciliation never resubmits the completion');
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
  await page.getByLabel('Search all tasks',{exact:true}).fill('');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByText('Fictional action 00',{exact:true}).waitFor();
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'horizontal overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/work-hub-'+name+'.png',fullPage:true});
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Fictional action 00',{exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:/Select Fictional action/}).count(),0,'viewers have no bulk edit controls');
  await page.getByRole('button',{name:/Fictional action 00/}).click();await completion.getByText('A workspace editor must record completion.',{exact:true}).waitFor();
  assert.equal(await completeButton.count(),0,'viewers have no completion mutation control');
  role='OWNER';await page.goto(base+'/team?'+new URLSearchParams({organizationId:other,taskId:handoffTask.id}),{waitUntil:'domcontentloaded'});
  const linkedTask=page.locator('#team-task-'+handoffTask.id);
  await linkedTask.getByRole('heading',{name:handoffTask.title,exact:true}).waitFor();
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),other,'exception handoff selects its linked organisation');
  assert.equal(exactHandoffReads,1,'a linked task outside the latest 100 is retrieved explicitly');
  const linkedEvidence=await linkedTask.getByRole('link',{name:'Attach or review evidence',exact:false}).getAttribute('href');
  assert.ok(linkedEvidence.includes('organizationId='+other)&&linkedEvidence.includes('taskId='+handoffTask.id));
  holdLegacyQueue=true;
  const heldLegacy=new Promise(resolve=>{legacyQueueHeld=resolve;}),finishedLegacy=new Promise(resolve=>{legacyQueueFinished=resolve;});
  const oldQueueResponse=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/workspace/obligations'&&url.searchParams.get('organizationId')===other;});
  await page.getByRole('button',{name:'↻ Refresh',exact:true}).click();await heldLegacy;
  await page.getByLabel('Organisation',{exact:true}).selectOption(org);
  await page.getByRole('heading',{name:legacyMainTask.title,exact:true}).waitFor();
  releaseLegacyQueue();await finishedLegacy;await (await oldQueueResponse).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await linkedTask.count(),0,'a late exception-queue response cannot restore the previous organisation');
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),org);
  const readsBeforeUnavailable=legacyListReads;
  await page.goto(base+'/team?'+new URLSearchParams({organizationId:'723e4567-e89b-42d3-a456-426614174099',taskId:handoffTask.id}),{waitUntil:'domcontentloaded'});
  await page.getByRole('status').filter({hasText:'The linked organisation is unavailable for this account.'}).waitFor();
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),'');
  assert.equal(legacyListReads,readsBeforeUnavailable,'an unavailable linked organisation never falls back to another company');
  assert.deepEqual(errors,[]);results.push({name,passed:true,applyCount,startCount,createCount,completionPosts,completionWrites,completionChecks:['review blocker with scoped handoff','explicit evidence and outcome confirmation','stale proof invalidation','rapid activation sends once','completed list and inspectable record','cancelled old-organisation proof','lost-response read-only reconciliation','viewer restriction','scoped exception handoff beyond first 100 tasks','late exception-queue response ignored','unavailable linked organisation has no fallback'],overflow,modalOverflow,fixture:'Fictional auth and API responses; database enforcement tested separately'});
 }finally{await context.close();}
}
async function reviewJourney(viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',other='123e4567-e89b-42d3-a456-426614174002';
 const auth={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),auth);
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:auth.user}}));
 let role='OWNER',queueReads=0,detailReads=0,previewReads=0,followUpPosts=0,followUpWrites=0,verificationPosts=0,verificationWrites=0;
 let pendingReview=true,evidenceVersion=2,followUpMode='stale',verificationMode='success',holdQueue=false,holdDetail=false;
 let releaseFollowUp,followUpSubmitted,releaseQueue,queueHeld,queueFinished,releaseDetail,detailHeld,detailFinished;
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:user,email:auth.user.email,organisations:[{id:org,name:'Fictional review company',role},{id:other,name:'Empty review company',role}]}}));
 const tasks=Array.from({length:106},(_,index)=>({id:'823e4567-e89b-42d3-a456-'+String(index).padStart(12,'0'),title:'Completed action '+String(index).padStart(3,'0'),category:'Quality',ownerName:'owner@example.invalid',dueDate:'2026-10-31',completedAt:'2026-11-01T10:00:00.000Z'}));
 const target=tasks[105],file={id:'923e4567-e89b-42d3-a456-426614174001',filename:'Reviewed procedure.pdf',sha256:'a'.repeat(64),reviewVersion:1,reviewedAt:'2026-11-01T09:00:00.000Z',reviewerId:'123e4567-e89b-42d3-a456-426614174003',uploadedById:user};
 const followUps=new Map(),verifications=new Map();
 const originalFor=task=>({eventId:'completion-'+task.id,proofHash:'f'.repeat(64),completedAt:task.completedAt,receipt:{format:'regpilot-work-completion',version:1,organizationId:org,task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:user,dueDate:task.dueDate,statusBefore:'IN_PROGRESS',updatedAtBefore:'2026-11-01T08:00:00.000Z'},completedAt:task.completedAt,completedById:user,notes:'The procedure was implemented and independently reviewed evidence recorded the outcome.',source:null,control:null,assessment:null,evidence:[file],scope:'Recorded completion and the supporting evidence at that time.'}});
 const originalSnapshot=JSON.stringify(originalFor(target));
 function itemFor(task){
  const latest=(verifications.get(task.id)||[]).at(-1),followUp=(followUps.get(task.id)||[]).at(-1)||null;
  const state=task.id===target.id?latest?.record.proof.evidence[0].reviewVersion===evidenceVersion?'NO_RECORDED_CHANGES':'NEEDS_REVIEW':task.id===tasks[2].id?'UNAVAILABLE':task.id===tasks[3].id?'SPECIALIST':'NO_RECORDED_CHANGES';
  const findings=state==='NEEDS_REVIEW'?[{code:'EVIDENCE_CHANGED',message:'Reviewed procedure.pdf has a different review record from the saved completion basis.',href:'/team/evidence?'+new URLSearchParams({organizationId:org,taskId:task.id}),label:'Review current evidence'}]:state==='UNAVAILABLE'?[{code:'RECORD_UNAVAILABLE',message:'A verified original completion record is unavailable.',href:'',label:''}]:state==='SPECIALIST'?[{code:'SPECIALIST_WORKFLOW',message:'Review this outcome in its linked change response.',href:'/team/changes?organizationId='+org,label:'Open change response'}]:[];
  return {task,state,findings,basis:state==='UNAVAILABLE'?null:latest?.basis||{eventId:'completion-'+task.id,proofHash:'f'.repeat(64),checkedAt:task.completedAt,kind:'COMPLETION'},followUp,href:'/team/work/reviews?'+new URLSearchParams({organizationId:org,taskId:task.id})};
 }
 function detailFor(task){
  const item=itemFor(task),history=verifications.get(task.id)||[],admin=role==='OWNER',open=(followUps.get(task.id)||[]).find(value=>value.status!=='COMPLETE');
  return {organizationId:org,role,item,original:item.state==='UNAVAILABLE'?null:originalFor(task),latestVerification:history.at(-1)?.record||null,verificationHistory:[...history].reverse().map(({record,basis})=>({eventId:basis.eventId,proofHash:basis.proofHash,verifiedAt:record.verifiedAt,verifiedById:record.verifiedById,notes:record.notes})),historyLimited:false,token:'d'.repeat(64),canCreateFollowUp:admin&&item.state==='NEEDS_REVIEW'&&!open,members:[{id:user,email:'owner@example.invalid'}],membersLimited:false,verification:{canVerify:admin&&!pendingReview,token:!pendingReview?'b'.repeat(64):null,evidence:pendingReview?[]:[{...file,reviewVersion:evidenceVersion,required:false}],evidenceLimit:10,blockers:pendingReview?[{code:'INDEPENDENT_REVIEW',message:'The changed file needs independent review before a fresh verified basis can be recorded.',href:'/team/evidence?'+new URLSearchParams({organizationId:org,taskId:task.id}),label:'Review current evidence'}]:[]},scope:'Recorded changes and review decisions for this completed outcome.'};
 }
 await context.route('**/api/workspace/work/reviews*',async route=>{
  const url=new URL(route.request().url()),organizationId=url.searchParams.get('organizationId'),q=url.searchParams.get('q')||'',requestedPage=Number(url.searchParams.get('page')||1);queueReads++;
  const matches=organizationId===other?[]:tasks.filter(task=>task.title.toLowerCase().includes(q.toLowerCase())),pages=Math.max(1,Math.ceil(matches.length/25)),pageNumber=Math.min(requestedPage,pages);
  const body={organizationId,actorId:user,role,items:matches.slice((pageNumber-1)*25,pageNumber*25).map(itemFor),total:matches.length,page:pageNumber,pages,pageSize:25,query:{q,page:pageNumber},scope:'This page compares recorded metadata, not original file bytes.'};
  const held=holdQueue&&organizationId===org;if(held){holdQueue=false;await new Promise(resolve=>{releaseQueue=resolve;queueHeld();});}
  try{await route.fulfill({json:body});}catch{}finally{if(held)queueFinished();}
 });
 await context.route(url=>/^\/api\/workspace\/work\/[^/]+\/review(?:\/|$)/.test(url.pathname),async route=>{
  const request=route.request(),url=new URL(request.url()),parts=url.pathname.split('/'),task=tasks.find(value=>value.id===parts[4]);
  assert.ok(task,'review uses the exact completed task');
  if(request.method()==='GET'){
   detailReads++;assert.equal(url.searchParams.get('organizationId'),org);const body=detailFor(task);
   if(holdDetail){holdDetail=false;await new Promise(resolve=>{releaseDetail=resolve;detailHeld();});try{await route.fulfill({json:body});}catch{}finally{detailFinished();}return;}
   return route.fulfill({json:body});
  }
  const body=request.postDataJSON();assert.equal(body.organizationId,org);
  if(parts[6]==='follow-up'){
   assert.ok(body.reason.trim().length>=20);assert.equal(body.assigneeId,user);assert.ok(body.reviewToken);
   const existing=(followUps.get(task.id)||[]).find(value=>value.status!=='COMPLETE')||null;
   if(body.phase==='preview'){previewReads++;return route.fulfill({json:{token:'e'.repeat(64),sourceTaskId:task.id,title:'Review completed outcome: '+task.title,assignee:{id:user,email:'owner@example.invalid'},dueDate:body.dueDate,reason:body.reason,findings:itemFor(task).findings,existing}});}
   followUpPosts++;assert.equal(body.phase,'apply');assert.equal(body.confirm,true);assert.ok(body.token);
   if(followUpMode==='stale')return route.fulfill({status:409,json:{error:'The review findings changed. Refresh before creating this follow-up.'}});
   if(followUpMode==='held')await new Promise(resolve=>{releaseFollowUp=resolve;followUpSubmitted();});
   if(existing)return route.fulfill({json:{taskId:existing.id,sourceTaskId:task.id,eventId:'existing-follow-up',reused:true}});
   followUpWrites++;const created={id:'a23e4567-e89b-42d3-a456-'+String(followUpWrites).padStart(12,'0'),title:'Review completed outcome: '+task.title,status:'OPEN',dueDate:body.dueDate,ownerName:'owner@example.invalid'};
   followUps.set(task.id,[...(followUps.get(task.id)||[]),created]);
   return route.fulfill({json:{taskId:created.id,sourceTaskId:task.id,eventId:'follow-up-created-'+followUpWrites,reused:false}});
  }
  assert.equal(parts[6],'verify');verificationPosts++;assert.equal(body.confirm,true);assert.ok(body.notes.trim().length>=20);assert.deepEqual(body.evidenceIds,[file.id]);
  const previous=itemFor(task).basis,verifiedAt=new Date().toISOString(),eventId='fresh-review-'+(verificationWrites+1),proofHash=String(evidenceVersion).repeat(64);
  const record={format:'regpilot-work-verification',version:1,organizationId:org,originalTaskId:task.id,completionEventId:'completion-'+task.id,completionProofHash:'f'.repeat(64),previousBasisEventId:previous.eventId,previousBasisProofHash:previous.proofHash,verifiedAt,verifiedById:user,notes:body.notes,proof:{task:{id:task.id,title:task.title,category:task.category,ownerName:task.ownerName,assigneeId:user,dueDate:task.dueDate,updatedAt:'2026-11-01T10:00:00.000Z'},source:null,control:null,assessment:null,evidence:[{...file,reviewVersion:evidenceVersion}]},scope:'Freshly reviewed basis; original completion preserved.'};
  const basis={eventId,proofHash,checkedAt:verifiedAt,kind:'VERIFICATION'};verificationWrites++;verifications.set(task.id,[...(verifications.get(task.id)||[]),{record,basis}]);
  if(verificationMode==='lost')return route.abort('failed');
  return route.fulfill({json:{taskId:task.id,eventId,proofHash,verifiedAt,evidenceCount:1,reused:false,record}});
 });
 try{
  await page.goto(base+'/team/work/reviews?organizationId='+org,{waitUntil:'domcontentloaded'});
  const list=page.getByRole('region',{name:'Completed work review list',exact:true});
  await list.getByRole('heading',{name:'106 completed tasks',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Main workspace',exact:true}).getByRole('link',{name:'Tasks',exact:true}).getAttribute('aria-current'),'page','completed-work reviews remain under Tasks navigation');
  await list.getByText('On this page',{exact:true}).waitFor();
  await list.getByRole('button',{name:'Next review page',exact:true}).click();await list.getByText('Completed action 025',{exact:true}).waitFor();
  await page.getByLabel('Search completed tasks',{exact:true}).fill('105');await list.getByRole('button',{name:'Search completed work',exact:true}).click();
  await list.getByText(target.title,{exact:true}).waitFor();await list.getByRole('heading',{name:'1 completed task matching your search',exact:true}).waitFor();
  const readsBeforeDeepLink=queueReads;
  await page.goto(base+'/team/work/reviews?'+new URLSearchParams({organizationId:org,taskId:target.id}),{waitUntil:'domcontentloaded'});
  const detail=page.getByRole('region',{name:'Completed work review',exact:true}),follow=detail.getByRole('region',{name:'Owned follow-up',exact:true}),fresh=detail.getByRole('region',{name:'Fresh review',exact:true});
  await detail.getByRole('heading',{name:target.title,exact:true}).waitFor();await detail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
  assert.equal(queueReads,readsBeforeDeepLink,'direct task review does not depend on the first100 or fetch an unused list');
  const evidenceLink=await detail.getByRole('region',{name:'Current review findings',exact:true}).getByRole('link',{name:'Review current evidence',exact:false}).getAttribute('href');assert.ok(evidenceLink.includes('organizationId='+org)&&evidenceLink.includes('taskId='+target.id));
  await follow.getByLabel('Follow-up assignee',{exact:true}).selectOption(user);await follow.getByLabel('Follow-up due date',{exact:true}).fill('2026-12-01');await follow.getByLabel('Reason for follow-up',{exact:true}).fill('Review the changed procedure and obtain an independent decision before recording a new basis.');
  await follow.getByRole('button',{name:'Preview follow-up task',exact:true}).click();await follow.getByRole('region',{name:'Follow-up preview',exact:true}).waitFor();assert.equal(followUpWrites,0,'preview creates no task');
  const detailReadsBeforeStale=detailReads;
  await follow.getByRole('button',{name:'Create reviewed follow-up',exact:true}).click();await detail.getByRole('alert').filter({hasText:'The review findings changed'}).waitFor();
  assert.equal(followUpPosts,1);assert.equal(followUpWrites,0);assert.equal(detailReads,detailReadsBeforeStale,'stale creation does not auto-retry or auto-refresh');
  assert.equal(await follow.getByRole('region',{name:'Follow-up preview',exact:true}).count(),0);
  await detail.getByRole('button',{name:'Refresh review status',exact:true}).click();await detail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
  await follow.getByRole('button',{name:'Preview follow-up task',exact:true}).click();await follow.getByRole('region',{name:'Follow-up preview',exact:true}).waitFor();
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/work-review-preview-'+name+'.png',fullPage:true});
  followUpMode='held';const submitted=new Promise(resolve=>{followUpSubmitted=resolve;});
  await follow.getByRole('button',{name:'Create reviewed follow-up',exact:true}).evaluate(button=>{button.click();button.click();});await submitted;
  assert.equal(followUpPosts,2);assert.equal(await page.getByLabel('Organisation',{exact:true}).isDisabled(),true);releaseFollowUp();
  const followLink=follow.getByRole('link',{name:'Open follow-up task',exact:true});await followLink.waitFor();assert.equal(followUpWrites,1);
  const firstFollowUp=(followUps.get(target.id)||[])[0],followHref=await followLink.getAttribute('href');assert.ok(followHref.includes('organizationId='+org)&&followHref.includes('taskId='+firstFollowUp.id));
  await page.reload({waitUntil:'domcontentloaded'});await followLink.waitFor();assert.equal(await follow.getByRole('button',{name:'Create reviewed follow-up',exact:true}).count(),0,'reload shows saved follow-up without creating a duplicate');
  firstFollowUp.status='COMPLETE';await detail.getByRole('button',{name:'Refresh recorded checks',exact:true}).click();await detail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
  await follow.getByText('Completed',{exact:true}).waitFor();await follow.getByLabel('Reason for follow-up',{exact:true}).fill('The first follow-up ended without resolving the evidence finding. Assign a new explicit review cycle.');
  await follow.getByRole('button',{name:'Preview follow-up task',exact:true}).click();await follow.getByRole('button',{name:'Create reviewed follow-up',exact:true}).waitFor();
  followUpMode='success';await follow.getByRole('button',{name:'Create reviewed follow-up',exact:true}).click();await follow.getByText('Open',{exact:true}).waitFor();assert.equal(followUpWrites,2,'a completed follow-up does not block a new explicitly reviewed cycle');
  pendingReview=false;await detail.getByRole('button',{name:'Refresh recorded checks',exact:true}).click();
  const verify=fresh.getByRole('button',{name:'Verify files and record fresh review',exact:true}),confirmation=fresh.getByRole('checkbox',{name:'I have checked the current evidence and confirm this reviewed basis.',exact:true});
  await fresh.getByRole('checkbox',{name:/Reviewed procedure.pdf/}).waitFor();assert.equal(await verify.isDisabled(),true);
  await fresh.getByLabel('Fresh review outcome',{exact:true}).fill('The changed procedure has an independent approval and now supports this recorded outcome.');await confirmation.focus();await page.keyboard.press('Space');
  await verify.click();await detail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();assert.equal(verificationWrites,1);
  await followLink.waitFor();await follow.getByText('Open',{exact:true}).waitFor();assert.equal((followUps.get(target.id)||[]).filter(value=>value.status!=='COMPLETE').length,1,'fresh verification does not close the linked task');
  const downloadPromise=page.waitForEvent('download');await detail.getByRole('button',{name:'Download fresh review record',exact:true}).click();const downloaded=await downloadPromise,downloadText=await readFile(await downloaded.path(),'utf8'),downloadBody=JSON.parse(downloadText);assert.equal(downloadBody.record.organizationId,org);assert.equal(downloadBody.record.originalTaskId,target.id);assert.equal(downloadBody.basis.proofHash,'2'.repeat(64));assert.ok(!downloadText.includes('storageKey'));
  const originalDownload=page.waitForEvent('download');await detail.getByRole('button',{name:'Download original completion record',exact:true}).click();assert.deepEqual(JSON.parse(await readFile(await (await originalDownload).path(),'utf8')),JSON.parse(originalSnapshot),'fresh review preserves the original completion record');
  await page.reload({waitUntil:'domcontentloaded'});await detail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();await followLink.waitFor();
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'review workspace horizontal overflow '+overflow);
  await page.screenshot({path:'artifacts/usability/work-review-record-'+name+'.png',fullPage:true});
  evidenceVersion=3;await detail.getByRole('button',{name:'Refresh recorded checks',exact:true}).click();await detail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
  await fresh.getByLabel('Fresh review outcome',{exact:true}).fill('The later independent review was checked against the current procedure and the same completed outcome.');await confirmation.check();verificationMode='lost';
  await verify.click();await detail.getByRole('alert').filter({hasText:'Refresh the review to check what was saved'}).waitFor();assert.equal(verificationPosts,2);assert.equal(verificationWrites,2);
  await detail.getByRole('button',{name:'Refresh review status',exact:true}).click();await detail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();assert.equal(verificationPosts,2,'lost verification response is recovered by GET, never resubmitted');
  role='EDITOR';await page.reload({waitUntil:'domcontentloaded'});await detail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();assert.equal(await verify.count(),0,'editors cannot record administrative verification');
  await page.getByRole('button',{name:'Back to completed work reviews',exact:false}).click();await list.getByRole('heading',{name:'106 completed tasks',exact:true}).waitFor();
  holdQueue=true;const heldQueue=new Promise(resolve=>{queueHeld=resolve;}),finishedQueue=new Promise(resolve=>{queueFinished=resolve;});
  const oldQueueMatch=value=>{const url=new URL(value.url());return url.pathname==='/api/workspace/work/reviews'&&url.searchParams.get('organizationId')===org;};
  const oldQueueSettled=Promise.race([page.waitForResponse(oldQueueMatch).then(response=>response.finished()),page.waitForEvent('requestfailed',{predicate:oldQueueMatch})]);
  await list.getByRole('button',{name:'Refresh checks',exact:true}).click();await heldQueue;await page.getByLabel('Organisation',{exact:true}).selectOption(other);await list.getByRole('heading',{name:'No completed tasks match this search.',exact:true}).waitFor();
  releaseQueue();await finishedQueue;await oldQueueSettled;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.getByText('Completed action 000',{exact:true}).count(),0,'old-org review list cannot repopulate a new workspace');
  holdDetail=true;const heldDetail=new Promise(resolve=>{detailHeld=resolve;}),finishedDetail=new Promise(resolve=>{detailFinished=resolve;});
  await page.goto(base+'/team/work/reviews?'+new URLSearchParams({organizationId:org,taskId:target.id}),{waitUntil:'domcontentloaded'});await heldDetail;
  await page.getByLabel('Organisation',{exact:true}).selectOption(other);await list.getByRole('heading',{name:'No completed tasks match this search.',exact:true}).waitFor();releaseDetail();await finishedDetail;
  assert.equal(await detail.count(),0,'late old-org detail stays cancelled');assert.equal(await page.getByText('Reviewed procedure.pdf',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  results.push({name:name+'-completed-review',passed:true,previewReads,followUpPosts,followUpWrites,verificationPosts,verificationWrites,overflow,reviewChecks:['paginated completed task search','exact task beyond100','page-scoped counts','preview without mutation','stale preview invalidation','single creation from rapid clicks','saved follow-up after reload','new cycle after completed follow-up','fresh verified basis and immutable original export','open follow-up preserved','lost-response GET reconciliation','editor mutation restriction','old-organisation list and detail suppression'],fixture:'Fictional authenticated UI/API responses; real verification and database rules tested separately'});
 }catch(error){
  await mkdir('artifacts/usability',{recursive:true});
  await page.screenshot({path:'artifacts/usability/work-review-failure-'+name+'.png',fullPage:true}).catch(()=>{});
  await writeFile('artifacts/usability/work-review-failure-'+name+'.txt',String(error)+'\n\n'+await page.locator('body').ariaSnapshot()).catch(()=>{});
  throw error;
 }finally{await context.close();}
}

try{
 let ready=false;for(let i=0;i<80;i++){if(host.exitCode!==null)throw Error('Server exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)})).status<500){ready=true;break;}}catch{}await delay(250);}if(!ready)throw Error('Server did not start');
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 await journey({width:1440,height:1000},'desktop');await journey({width:390,height:844},'mobile');
 await reviewJourney({width:1440,height:1000},'desktop');await reviewJourney({width:390,height:844},'mobile');
 await writeFile('artifacts/usability/work-hub-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();host.kill('SIGTERM');}
