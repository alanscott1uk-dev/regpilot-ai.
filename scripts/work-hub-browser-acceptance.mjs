/** Fictional authenticated UI fixtures. Real PostgreSQL policy/transaction tests run separately. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
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
 await context.route('**/api/ai/context',route=>route.fulfill({json:{userId:user,email:auth.user.email,organisations:[{id:org,name:'Fictional work company',role},{id:other,name:'Empty second company',role}]}}));
 let rows=Array.from({length:31},(_,i)=>({id:'223e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),title:'Fictional action '+String(i).padStart(2,'0'),category:'Quality',ownerName:'Unassigned',assigneeId:null,dueDate:'2026-12-01T00:00:00.000Z',status:'OPEN',updatedAt:'2026-11-18T00:00:00.000Z',originKey:null,controlId:null,connectorId:null,assignee:null,managedControl:null,changeAction:null,auditRequest:null,accessItem:null,_count:{evidence:1},evidenceToReview:true,planningBlocked:null,canPlan:true,workflow:{label:'Review supporting evidence',href:'/team/evidence?organizationId='+org}}));
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
   const task=rows.find(r=>r.id===url.searchParams.get('taskId'));
   return route.fulfill({json:{organizationId:org,task:{...task,notes:'Inspect the source, evidence and next step together.',sourceUrl:'https://www.gov.uk/example',sourceCheckedAt:null,createdAt:task.updatedAt,completedAt:null,completionException:false,completionRationale:'',evidence:[{id:'fictional-file',filename:'Fictional evidence.pdf',scanStatus:'CLEAN',reviewStatus:'PENDING_REVIEW',createdAt:task.updatedAt,reviewedAt:null}],assuranceAssessments:[],intelligenceDecisions:[]},evidenceLimited:false,history:[{id:'event',action:'obligation.created',createdAt:task.updatedAt}],historyLimited:false,planningBlocked:null,canPlan:role==='OWNER',canStart:role!=='VIEWER'&&task.status==='OPEN',workflow:task.workflow}});
  }
  const pageNumber=Number(url.searchParams.get('page')||1),q=url.searchParams.get('q')||'',view=url.searchParams.get('view')||'open',requestedOrg=url.searchParams.get('organizationId');
  const filtered=requestedOrg===other?[]:rows.filter(r=>r.title.includes(q)&&(view!=='mine'||r.assigneeId===user));
  return route.fulfill({json:{organizationId:requestedOrg,actorId:user,role,items:filtered.slice((pageNumber-1)*25,pageNumber*25).map(r=>({...r,canPlan:role==='OWNER'})),total:filtered.length,page:pageNumber,pages:Math.max(1,Math.ceil(filtered.length/25)),pageSize:25,query:{view,q,page:pageNumber},counts:{open:31,mine:0,overdue:0,unassigned:31,review:31,complete:0},members:[{role:'OWNER',user:{id:user,email:'owner@example.invalid'}}],membersLimited:false,generatedAt:new Date().toISOString()}});
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
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
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
  await page.getByLabel('Organisation',{exact:true}).selectOption(other);
  await page.getByRole('heading',{name:'No tasks match this view.',exact:true}).waitFor();
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
  await page.getByLabel('Search all tasks',{exact:true}).fill('');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByText('Fictional action 00',{exact:true}).waitFor();
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'horizontal overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/work-hub-'+name+'.png',fullPage:true});
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Fictional action 00',{exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:/Select Fictional action/}).count(),0,'viewers have no bulk edit controls');
  assert.deepEqual(errors,[]);results.push({name,passed:true,applyCount,startCount,createCount,overflow,fixture:'Fictional auth and API responses; database enforcement tested separately'});
 }finally{await context.close();}
}
try{
 let ready=false;for(let i=0;i<80;i++){if(host.exitCode!==null)throw Error('Server exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)})).status<500){ready=true;break;}}catch{}await delay(250);}if(!ready)throw Error('Server did not start');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await journey({width:1440,height:1000},'desktop');await journey({width:390,height:844},'mobile');
 await writeFile('artifacts/usability/work-hub-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();host.kill('SIGTERM');}
