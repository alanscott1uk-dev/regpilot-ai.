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
   return route.fulfill({json:{organizationId:org,task:{...task,notes:'Inspect the source, evidence and next step together.',sourceUrl:'https://www.gov.uk/example',sourceCheckedAt:null,createdAt:task.updatedAt,completedAt:saved?.completed.completedAt||null,completionException:false,completionRationale:saved?.receipt.notes||'',evidence:[{id:'fictional-file',filename:'Fictional evidence.pdf',scanStatus:'CLEAN',reviewStatus:evidenceReady?'APPROVED':'PENDING_REVIEW',createdAt:task.updatedAt,reviewedAt:null}],assuranceAssessments:[],intelligenceDecisions:[]},evidenceLimited:false,history:[...(saved?[{id:saved.completed.eventId,action:'work.completed',createdAt:saved.completed.completedAt}]:[]),{id:'event',action:'obligation.created',createdAt:task.updatedAt}],historyLimited:false,planningBlocked:null,canPlan:role==='OWNER'&&task.status!=='COMPLETE',canStart:role!=='VIEWER'&&task.status==='OPEN',workflow:task.workflow}});
  }
  const pageNumber=Number(url.searchParams.get('page')||1),q=url.searchParams.get('q')||'',view=url.searchParams.get('view')||'open',requestedOrg=url.searchParams.get('organizationId');
  const filtered=requestedOrg===other?[]:rows.filter(r=>r.title.includes(q)&&(view==='complete'?r.status==='COMPLETE':r.status!=='COMPLETE')&&(view!=='mine'||r.assigneeId===user));
  const open=rows.filter(r=>r.status!=='COMPLETE');
  return route.fulfill({json:{organizationId:requestedOrg,actorId:user,role,items:filtered.slice((pageNumber-1)*25,pageNumber*25).map(r=>({...r,canPlan:role==='OWNER'&&r.status!=='COMPLETE'})),total:filtered.length,page:pageNumber,pages:Math.max(1,Math.ceil(filtered.length/25)),pageSize:25,query:{view,q,page:pageNumber},counts:{open:open.length,mine:open.filter(r=>r.assigneeId===user).length,overdue:0,unassigned:open.filter(r=>!r.assigneeId).length,review:open.length,complete:completionRecords.size},members:[{role:'OWNER',user:{id:user,email:'owner@example.invalid'}}],membersLimited:false,generatedAt:new Date().toISOString()}});
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
  assert.ok((await detail.getByRole('link',{name:'Open evidence workspace',exact:false}).getAttribute('href')).includes('organizationId='+org));
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
try{
 let ready=false;for(let i=0;i<80;i++){if(host.exitCode!==null)throw Error('Server exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)})).status<500){ready=true;break;}}catch{}await delay(250);}if(!ready)throw Error('Server did not start');
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 await journey({width:1440,height:1000},'desktop');await journey({width:390,height:844},'mobile');
 await writeFile('artifacts/usability/work-hub-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();host.kill('SIGTERM');}
