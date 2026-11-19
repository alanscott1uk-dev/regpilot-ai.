// Runs on an isolated runner. The browser uses real email-link sign-in and the app's normal routes.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {PrismaClient} from '@prisma/client';
import {createClient} from '@supabase/supabase-js';
import {fixturePdf} from '../tests/helpers/pdf-fixture.mjs';
import {createCustomerWorkspace,sourceToReportJourney} from './customer-journey.mjs';
import {starterProgrammeCustomerJourney,riskCustomerJourney} from './starter-risk-customer-journey.mjs';

const app='http://127.0.0.1:3000', api='http://127.0.0.1:54321', mail='http://127.0.0.1:54324';
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,api);
const database=new URL(process.env.DATABASE_URL);
assert.equal(database.host,'127.0.0.1:54322');
assert.equal(database.pathname,'/regpilot_journey');
assert.equal(process.env.REGPILOT_EVIDENCE_BUCKET,'journey-files');
const db=new PrismaClient();
const localFetch=(input,options={})=>fetch(input,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000)});
const supabase=createClient(api,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}});
const errors=[];
const artifactDir='artifacts/usability/private-evidence';
const report={passed:false,stage:'local setup',checks:[],responses:[]};
let browser;
function passed(message){report.checks.push(message);console.log(message);}
async function saveReport(){
 await mkdir(artifactDir,{recursive:true});
 await writeFile(artifactDir+'/results.json',JSON.stringify({...report,pageErrors:errors},null,2)+'\n');
}
async function checkpoint(stage){report.stage=stage;await saveReport();}
async function bounded(operation,label,timeoutMs=15_000){
 let timer;
 try{
  return await Promise.race([operation,new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error(label+' exceeded '+timeoutMs+'ms')),timeoutMs);
  })]);
 }finally{clearTimeout(timer);}
}
async function submitEvidence(page,filename,bytes,expectedStatus){
 await checkpoint('selecting '+filename);
 await page.getByLabel('Evidence document').setInputFiles({name:filename,mimeType:'application/pdf',buffer:bytes});
 await checkpoint('posting '+filename);
 const [response]=await Promise.all([
  page.waitForResponse(r=>r.url()===app+'/api/workspace/evidence'&&r.request().method()==='POST'),
  page.getByRole('button',{name:'Scan and store privately'}).click()
 ]);
 report.uploads||=[];
 const result={filename,status:response.status()};report.uploads.push(result);
 await checkpoint('reading upload response for '+filename);
 const body=await bounded(response.json(),'Evidence upload response body');
 if(typeof body.error==='string')result.error=body.error;
 await checkpoint('received upload body for '+filename);
 assert.equal(response.status(),expectedStatus,`Evidence upload returned ${response.status()}: ${body.error||'unexpected success'}`);
 return body;
}
async function account(email){
 const {data,error}=await supabase.auth.admin.createUser({email,email_confirm:true});
 if(error)throw Error('Local Auth account setup failed: '+error.status);
 return data.user;
}
async function signIn(page,url,email){
 await page.goto(url);
 const form=page.getByRole('form',{name:'Email sign-in'});
 await form.getByLabel('Email sign-in').fill(email);
 await form.getByRole('button',{name:'Send secure link'}).click();
 await form.getByText(/Sign-in link requested/).waitFor();
 const link=await emailLink(email);
 // Opening a message in the same browser commonly creates a second tab.
 const destination=await page.context().newPage();
 await destination.goto(link);
 return destination;
}
async function emailLink(email){
 for(let i=0;i<40;i++){
  const inbox=await (await localFetch(mail+'/api/v1/messages')).json();
  const item=inbox.messages?.find(m=>m.To.some(address=>address.Address===email));
  if(item){
   const message=await (await localFetch(mail+'/api/v1/message/'+item.ID)).json();
   for(const [,href] of message.HTML.matchAll(/href="([^"]+)"/gi)){
    const url=new URL(href.replaceAll('&amp;','&'));
    if(url.origin===api && url.pathname==='/auth/v1/verify')return url.href;
   }
   throw Error('The local message contained no verification link for the local Auth service');
  }
  await delay(250);
 }
 throw Error('The local sign-in message did not arrive');
}
async function openContext(viewport){
 const context=await browser.newContext({viewport});
 context.setDefaultTimeout(30_000);
 context.on('page',page=>{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{
   const url=new URL(response.url());
   if(url.origin===app&&url.pathname.startsWith('/api/'))
    report.responses.push({method:response.request().method(),path:url.pathname,status:response.status()});
  });
 });
 return context.newPage();
}
try{
 await checkpoint('local setup');
 const reviewerEmail='reviewer@example.test';
 const reviewerIdentity=await supabase.auth.admin.createUser({email:reviewerEmail,email_confirm:true});
 if(reviewerIdentity.error)throw Error('Local Auth account setup failed: '+reviewerIdentity.error.status);
 browser=await chromium.launch();
 const review=await signIn(await openContext({width:1440,height:1000}),app+'/team/setup',reviewerEmail);
 const {org,reviewer}=await createCustomerWorkspace({page:review,db,app,email:reviewerEmail,checkpoint,passed,artifactDir});
 const editorEmail='editor@example.test';
 await account(editorEmail);
 await checkpoint('invited colleague already owns another organisation');
 const upload=await signIn(await openContext({width:390,height:844}),app+'/team/setup',editorEmail);
 await upload.getByRole('heading',{name:'Create your organisation',exact:true}).waitFor();
 await upload.getByLabel('Company name',{exact:true}).fill('Fictional colleague existing company');
 const [otherCreatedResponse]=await Promise.all([
  upload.waitForResponse(response=>response.url()===app+'/api/ai/context'&&response.request().method()==='POST'),
  upload.getByRole('button',{name:'Create workspace',exact:true}).click()
 ]);
 const otherCreated=await bounded(otherCreatedResponse.json(),'Existing colleague company response');
 assert.equal(otherCreatedResponse.status(),200,otherCreated.error||'colleague company creation failed');
 const otherOrgId=otherCreated.organisation.id;
 assert.notEqual(otherOrgId,org.id);
 const editor=await db.user.findUniqueOrThrow({where:{email:editorEmail}});
 assert.equal(await db.membership.count({where:{organizationId:org.id,userId:editor.id}}),0,'the colleague must not be seeded into the invited organisation');
 await upload.getByRole('heading',{name:'What does your organisation do?',exact:true}).waitFor();
 assert.equal(new URL(upload.url()).searchParams.get('organizationId'),otherOrgId);
 const {error}=await supabase.storage.createBucket('journey-files',{public:false});
 if(error)throw Error('Could not create the private local test bucket');
 // Controlled task population exercises exact-task handoffs beyond the first
 // page. Every seeded task belongs to a current member, before the invite joins.
 const common={organizationId:org.id,category:'Quality',ownerName:reviewer.email,assigneeId:reviewer.id};
 await db.obligation.createMany({data:Array.from({length:101},(_,i)=>({...common,title:'Earlier deadline '+i,dueDate:new Date('2028-01-01')}))});
 const title='Check cold-chain training records';
 const task=await db.obligation.create({data:{...common,title,dueDate:new Date('2028-12-01')}});
 const params=new URLSearchParams({organizationId:org.id,taskId:task.id});
 const vault=app+'/team/evidence?'+params;
 await checkpoint('owner invites colleague into the exact company and task');
 await review.goto(app+'/team/settings?'+params);
 await review.getByRole('heading',{name:'Invite a colleague',exact:true}).waitFor();
 assert.equal(await review.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),org.id);
 await review.getByLabel('Colleague’s email',{exact:true}).fill(editor.email);
 await review.getByRole('combobox',{name:/^Role/}).selectOption('EDITOR');
 const [invitedResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===app+'/api/workspace/team'&&response.request().method()==='POST'),
  review.getByRole('button',{name:'Create invitation',exact:true}).click()
 ]);
 const invited=await bounded(invitedResponse.json(),'Created invitation response');
 assert.equal(invitedResponse.status(),200,invited.error||'colleague invitation failed');
 await review.getByRole('button',{name:'Copy invitation link',exact:true}).waitFor();
 const invitationUrl=await review.getByLabel('Invitation link',{exact:true}).inputValue();
 const invitationLink=new URL(invitationUrl);
 assert.equal(invitationLink.origin,app);assert.equal(invitationLink.pathname,'/team/settings');
 assert.equal(invitationLink.searchParams.get('organizationId'),org.id);
 assert.equal(invitationLink.searchParams.get('taskId'),task.id);
 assert.equal(invitationLink.searchParams.get('invitationId'),invited.id);
 assert.equal(await db.membership.count({where:{organizationId:org.id,userId:editor.id}}),0,'inviting cannot grant membership');
 await upload.goto(invitationUrl);
 const invitation=upload.getByRole('article').filter({hasText:org.name});
 await invitation.getByRole('button',{name:'Join workspace',exact:true}).waitFor();
 const [joinedResponse]=await Promise.all([
  upload.waitForResponse(response=>response.url()===app+'/api/workspace/invitations'&&response.request().method()==='POST'),
  invitation.getByRole('button',{name:'Join workspace',exact:true}).click()
 ]);
 const joined=await bounded(joinedResponse.json(),'Joined invitation response');
 assert.equal(joinedResponse.status(),200,joined.error||'joining the invited company failed');
 assert.equal(joined.organizationId,org.id);assert.equal(joined.status,'ACCEPTED');
 const invitedTask=upload.getByRole('link',{name:/^Open invited task/});
 await invitedTask.waitFor();
 assert.equal(await upload.getByRole('combobox',{name:'Organisation',exact:true}).inputValue(),org.id,'joining must select the invited company instead of the prior membership');
 const joinedMembership=await db.membership.findUniqueOrThrow({where:{organizationId_userId:{organizationId:org.id,userId:editor.id}}});
 assert.equal(joinedMembership.role,'EDITOR');
 assert.equal(await db.membership.count({where:{userId:editor.id}}),2);
 const acceptedInvitation=await db.workspaceInvitation.findUniqueOrThrow({where:{id:invited.id}});
 assert.equal(acceptedInvitation.status,'ACCEPTED');assert.equal(acceptedInvitation.invitedById,reviewer.id);assert.equal(acceptedInvitation.email,editor.email);
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,entityId:invited.id,action:'team.invitation_accepted',actorId:editor.id}}),1);
 report.collaboration={organizationId:org.id,previousOrganizationId:otherOrgId,invitationId:invited.id,memberId:editor.id,role:joinedMembership.role,status:acceptedInvitation.status,acceptanceEvents:1,mainCompanyMembershipSeeded:false,taskHandoff:task.id};
 const invitationOverflow=await bounded(upload.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),'Mobile invitation layout');
 assert.ok(invitationOverflow<=3,'mobile invitation must fit the viewport');
 await upload.screenshot({path:artifactDir+'/mobile-joined-workspace.png',fullPage:true});
 await invitedTask.click();
 await upload.getByRole('dialog').getByRole('heading',{name:title,exact:true}).waitFor();
 assert.equal(new URL(upload.url()).searchParams.get('organizationId'),org.id);
 assert.equal(new URL(upload.url()).searchParams.get('taskId'),task.id);
 await upload.getByRole('dialog').getByRole('link',{name:'Manage evidence',exact:false}).click();
 await upload.getByRole('link',{name:'Return to task'}).waitFor();
 assert.equal(await upload.getByLabel('Task',{exact:true}).inputValue(),task.id);
 assert.equal(new URL(upload.url()).pathname,'/team/evidence');
 assert.equal(new URL(upload.url()).searchParams.has('code'),false);
 await upload.getByText('No scanned evidence has been recorded for this task.',{exact:true}).waitFor();
 passed('A colleague signed in by a real email link, created another company through Setup, then joined the owner’s exact task invitation through normal application endpoints. The saved membership and one acceptance event selected the invited company, opened the task beyond the first 100 results and retained scope into Evidence; no main-company membership was seeded.');
 await checkpoint('marked PDF rejection');
 const marked=fixturePdf([['REGPILOT_SCAN_FIXTURE']]);
 const rejected=await submitEvidence(upload,'scanner-fixture.pdf',marked,422);
 assert.equal(rejected.error,'Virus scan could not verify a clean result');
 await upload.getByText('Virus scan could not verify a clean result').waitFor();
 assert.equal(await db.evidence.count({where:{organizationId:org.id}}),0);
 const quota=await db.organization.findUniqueOrThrow({where:{id:org.id}});
 assert.equal(quota.evidenceCount,0);
 assert.equal(quota.evidenceBytes,0n);
 const rejectedObjects=await supabase.storage.from('journey-files').list(org.id);
 assert.equal(rejectedObjects.error,null);
 assert.deepEqual(rejectedObjects.data,[],'rejected PDF must never enter private storage');
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,action:'evidence.scanned_upload'}}),0);
 passed('ClamAV rejected the marked PDF through the upload form without a stored file, quota reservation or success audit.');
 await checkpoint('clean PDF upload and mobile task return');
 const file=fixturePdf([['Fictional cold-chain training record for independent review.']]);
 const stored=await submitEvidence(upload,'training-record.pdf',file,201);
 assert.equal(stored.evidence.obligationId,task.id);
 assert.equal(stored.evidence.reviewStatus,'PENDING_REVIEW');
 await upload.getByText('training-record.pdf',{exact:true}).waitFor();
 await checkpoint('clean file rendered');
 await upload.getByText(/A different owner or administrator must review evidence you uploaded/).waitFor();
 assert.equal(await upload.getByLabel('Independent review rationale').count(),0);
 assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile layout inspection'));
 await checkpoint('returning to uploaded task');
 const detail=upload.getByRole('dialog');
 await upload.getByRole('link',{name:'Return to task'}).click();
 await detail.getByText('training-record.pdf',{exact:true}).waitFor();
 await detail.getByText(/Pending review/i).first().waitFor();
 const pendingCompletion=detail.getByRole('region',{name:'Task completion',exact:true});
 await pendingCompletion.getByRole('heading',{name:'Before you can finish',exact:true}).waitFor();
 await pendingCompletion.getByText(/Supporting files are awaiting independent administrator review/).waitFor();
 assert.equal(await pendingCompletion.getByRole('button',{name:'Complete with verified evidence',exact:true}).count(),0);
 await mkdir(artifactDir,{recursive:true});
 await upload.screenshot({path:artifactDir+'/mobile-pending-review.png',fullPage:true});
 passed('Mobile uploader returned to the exact task; pending evidence prevented completion.');

 await checkpoint('independent reviewer sign-in and original download');
 await review.goto(app+'/team/work?'+new URLSearchParams({organizationId:org.id}));
 await review.getByRole('button',{name:/Reviews to finish/}).click();
 await review.getByRole('article').filter({hasText:title}).getByRole('link',{name:'Review supporting evidence',exact:false}).click();
 await review.getByText('training-record.pdf',{exact:true}).waitFor();
 passed('Second account opened the submitted file from its independent review queue.');
 const downloadReady=review.waitForEvent('download');
 await review.getByRole('button',{name:'Download verified original'}).click();
 const download=await downloadReady;
 assert.deepEqual(await readFile(await bounded(download.path(),'Original download completion')),file);
 const notes='Checked the dated fictional training record against the task scope.';
 await checkpoint('independent review persistence and task state');
 await review.getByLabel('Independent review rationale').fill(notes);
 await review.getByRole('button',{name:'Approve evidence'}).click();
 await review.getByText('APPROVED',{exact:true}).waitFor();
 const record=await db.evidence.findFirstOrThrow({where:{organizationId:org.id,obligationId:task.id}});
 assert.equal(record.uploadedById,editor.id);
 assert.equal(record.reviewerId,reviewer.id);
 assert.equal(record.reviewStatus,'APPROVED');
 assert.equal(record.reviewVersion,2);
 assert.equal(record.scanStatus,'CLEAN');
 assert.equal(record.sha256,createHash('sha256').update(file).digest('hex'));
 const privateUrl=supabase.storage.from('journey-files').getPublicUrl(record.storageKey).data.publicUrl;
 const publicRead=await localFetch(privateUrl);
 assert.ok([400,401,403,404].includes(publicRead.status),'private evidence must not be publicly retrievable');
 const anonymousDownload=await localFetch(app+'/api/workspace/evidence/'+record.id+'?'+new URLSearchParams({organizationId:org.id}));
 assert.equal(anonymousDownload.status,401,'the original requires verified workspace identity');
 const audit=await db.auditEvent.findMany({where:{entityType:'Evidence',entityId:record.id}});
 assert.ok(audit.some(e=>e.action==='evidence.scanned_upload' && e.actorId===editor.id && e.details.scanEngine==='clamd'));
 assert.ok(audit.some(e=>e.action==='evidence.independent_review' && e.actorId===reviewer.id));
 assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,'OPEN');
 assert.equal(await db.auditEvent.count({where:{entityType:'Obligation',entityId:task.id,action:'work.completed'}}),0);
 await review.getByRole('link',{name:'Return to task'}).click();
 await review.getByRole('dialog').getByText(/approved · added/i).waitFor();
 passed('The independent approval preserved the open task; public and unauthenticated file downloads remained blocked.');

 await checkpoint('explicit task completion with verified private bytes');
 const completion=review.getByRole('dialog').getByRole('region',{name:'Task completion',exact:true});
 await completion.getByRole('heading',{name:'Ready to complete',exact:true}).waitFor();
 const completeButton=completion.getByRole('button',{name:'Complete with verified evidence',exact:true});
 assert.equal(await completeButton.isDisabled(),true,'completion needs an explicit outcome and confirmation');
 const outcome='Completed the fictional cold-chain training check against the independently reviewed training record.';
 await completion.getByLabel('What was completed?',{exact:true}).fill(outcome);
 assert.equal(await completeButton.isDisabled(),true,'outcome text alone must not complete work');
 await completion.getByLabel('I have checked the selected evidence and confirm this work is complete.',{exact:true}).check();
 const completionEndpoint=app+'/api/workspace/work/'+task.id+'/completion';
 const [completedResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===completionEndpoint&&response.request().method()==='POST'),
  completeButton.click()
 ]);
 const completed=await bounded(completedResponse.json(),'Task completion response body');
 assert.equal(completedResponse.status(),200,`Completion returned ${completedResponse.status()}: ${completed.error||'unexpected result'}`);
 assert.equal(completed.taskId,task.id);
 assert.equal(completed.status,'COMPLETE');
 assert.equal(completed.reused,false);
 assert.equal(completed.evidenceCount,1);
 await completion.getByRole('heading',{name:'Task completed',exact:true}).waitFor();
 const finished=await db.obligation.findUniqueOrThrow({where:{id:task.id}});
 assert.equal(finished.status,'COMPLETE');
 assert.equal(finished.completedAt.toISOString(),completed.completedAt);
 assert.equal(finished.completionException,false);
 const completionEvents=await db.auditEvent.findMany({where:{organizationId:org.id,entityType:'Obligation',entityId:task.id,action:'work.completed'}});
 assert.equal(completionEvents.length,1);
 const saved=completionEvents[0];
 assert.equal(saved.id,completed.eventId);
 assert.equal(saved.actorId,reviewer.id);
 assert.equal(saved.details.proofHash,completed.proofHash);
 assert.match(completed.proofHash,/^[a-f0-9]{64}$/);
 const receipt=saved.details.receipt;
 assert.equal(receipt.organizationId,org.id);
 assert.equal(receipt.task.id,task.id);
 assert.equal(receipt.task.statusBefore,'OPEN');
 assert.equal(receipt.completedById,reviewer.id);
 assert.equal(receipt.notes,outcome);
 assert.equal(receipt.evidence.length,1);
 assert.deepEqual(receipt.evidence[0],{
  id:record.id,filename:record.filename,sha256:record.sha256,reviewVersion:2,
  reviewedAt:record.reviewedAt.toISOString(),reviewerId:reviewer.id,uploadedById:editor.id
 });
 assert.equal(JSON.stringify(receipt).includes(record.storageKey),false,'completion exports must not disclose private storage keys');
 const receiptReady=review.waitForEvent('download');
 await completion.getByRole('button',{name:'Download completion record',exact:true}).click();
 const receiptDownload=await receiptReady;
 const downloaded=JSON.parse(await readFile(await bounded(receiptDownload.path(),'Completion record download'),'utf8'));
 assert.deepEqual(downloaded.receipt,receipt,'the exported receipt must match the persisted completion decision');
 assert.equal(downloaded.record.eventId,saved.id);
 assert.equal(downloaded.record.proofHash,saved.details.proofHash);
 await writeFile(artifactDir+'/completion-record.json',JSON.stringify(downloaded,null,2)+'\n');
 await review.reload();
 await review.getByRole('dialog').getByRole('region',{name:'Task completion',exact:true}).getByRole('heading',{name:'Task completed',exact:true}).waitFor();
 await review.screenshot({path:artifactDir+'/desktop-completed-task.png',fullPage:true});
 passed('Explicit completion verified stored bytes, saved one attributed completion decision, exported its exact receipt and survived reload.');

 await review.getByRole('button',{name:'Close task details'}).click();
 await review.getByRole('button',{name:/Reviews to finish/}).click();
 await review.getByRole('button',{name:/Reviews to finish\s*0$/}).waitFor();
 await checkpoint('completed-work proof change fixture');
 // Controlled fault injection in this disposable database: a previously approved
 // file now requires another independent review. All recovery below uses the UI
 // and normal authenticated application routes, not direct database updates.
 await db.evidence.update({where:{id:record.id},data:{reviewStatus:'PENDING_REVIEW',reviewVersion:{increment:1},reviewerId:null,reviewedAt:null,reviewerNotes:''}});
 await review.goto(app+'/team/work?'+params);
 await review.getByRole('link',{name:'Review this completed task',exact:true}).click();
 const reviewDetail=review.getByRole('region',{name:'Completed work review',exact:true});
 await reviewDetail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
 assert.equal(new URL(review.url()).searchParams.get('taskId'),task.id);
 assert.equal(new URL(review.url()).searchParams.get('organizationId'),org.id);
 assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,'COMPLETE');
 assert.deepEqual((await db.auditEvent.findUniqueOrThrow({where:{id:saved.id}})).details,saved.details);
 passed('A controlled evidence-review change appeared on the exact completed task without rewriting its completion or historical receipt.');

 await checkpoint('preview and confirm owned review follow-up');
 const followUp=reviewDetail.getByRole('region',{name:'Owned follow-up',exact:true});
 const reason='Arrange a fresh independent check of the training record and confirm the evidence still supports the completed task.';
 await followUp.getByLabel('Follow-up assignee',{exact:true}).selectOption(editor.id);
 await followUp.getByLabel('Follow-up due date',{exact:true}).fill(new Date(Date.now()+7*86400000).toISOString().slice(0,10));
 await followUp.getByLabel('Reason for follow-up',{exact:true}).fill(reason);
 const followEndpoint=app+'/api/workspace/work/'+task.id+'/review/follow-up';
 const beforePreview={tasks:await db.obligation.count({where:{organizationId:org.id}}),events:await db.auditEvent.count({where:{organizationId:org.id}})};
 const [previewResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===followEndpoint&&response.request().method()==='POST'),
  followUp.getByRole('button',{name:'Preview follow-up task',exact:true}).click()
 ]);
 const previewed=await bounded(previewResponse.json(),'Follow-up preview body');
 assert.equal(previewResponse.status(),200,previewed.error||'follow-up preview failed');
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforePreview.tasks,'preview must not create work');
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id}}),beforePreview.events,'preview must not write an audit event');
 const [followResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===followEndpoint&&response.request().method()==='POST'),
  followUp.getByRole('button',{name:'Create reviewed follow-up',exact:true}).click()
 ]);
 const followed=await bounded(followResponse.json(),'Confirmed follow-up body');
 assert.equal(followResponse.status(),200,followed.error||'follow-up creation failed');
 const assigned=await db.obligation.findUniqueOrThrow({where:{id:followed.taskId}});
 assert.equal(assigned.organizationId,org.id);
 assert.equal(assigned.assigneeId,editor.id);
 assert.equal(assigned.status,'OPEN');
 assert.equal(assigned.originKey,null);
 assert.equal(assigned.controlId,null);
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforePreview.tasks+1);
 const originalFollowRequest=followResponse.request(),authorization=(await originalFollowRequest.allHeaders()).authorization;
 assert.ok(authorization,'the repeated confirmation uses the same local authenticated identity');
 // Credentials remain local and are never copied into logs or artifacts.
 const repeatedFollow=await review.request.post(followEndpoint,{headers:{authorization,'content-type':'application/json'},data:originalFollowRequest.postDataJSON(),timeout:15_000});
 const repeated=await bounded(repeatedFollow.json(),'Repeated follow-up confirmation');
 assert.equal(repeatedFollow.status(),200,repeated.error||'repeat follow-up failed');
 assert.equal(repeated.reused,true);
 assert.equal(repeated.taskId,assigned.id);
 assert.equal(repeated.eventId,followed.eventId);
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforePreview.tasks+1,'a repeated confirmation must not duplicate follow-up work');
 const followLink=followUp.getByRole('link',{name:'Open follow-up task',exact:true});
 await followLink.waitFor();
 assert.equal(new URL(await followLink.getAttribute('href'),app).searchParams.get('taskId'),assigned.id);
 const followLocation=await followLink.getAttribute('href');
 await review.screenshot({path:artifactDir+'/desktop-review-follow-up.png',fullPage:true});
 passed('The manager preview wrote nothing; explicit confirmation assigned one linked follow-up and a repeated confirmation reused it.');

 await checkpoint('fresh independent evidence review after completion');
 await review.goto(vault);
 await review.getByLabel('Independent review rationale').fill('Rechecked the fictional training record after the requested review; its dates, scope and implementation still support this task.');
 await review.getByRole('button',{name:'Approve evidence',exact:true}).click();
 await review.getByText('APPROVED',{exact:true}).waitFor();
 const rereviewed=await db.evidence.findUniqueOrThrow({where:{id:record.id}});
 assert.equal(rereviewed.reviewVersion,4);
 assert.equal(rereviewed.reviewerId,reviewer.id);
 assert.equal(rereviewed.sha256,record.sha256);
 await review.getByRole('link',{name:'Return to task',exact:true}).click();
 await review.getByRole('link',{name:'Review this completed task',exact:true}).click();
 await reviewDetail.getByRole('heading',{name:'Needs another review',exact:true}).waitFor();
 const freshReview=reviewDetail.getByRole('region',{name:'Fresh review',exact:true});
 const freshOutcome='Independently rechecked the current training evidence and its scope; it continues to support the completed training check.';
 await freshReview.getByLabel('Fresh review outcome',{exact:true}).fill(freshOutcome);
 await freshReview.getByRole('checkbox',{name:/training-record\.pdf/}).check();
 const verifyButton=freshReview.getByRole('button',{name:'Verify files and record fresh review',exact:true});
 assert.equal(await verifyButton.isDisabled(),true,'fresh verification needs explicit confirmation');
 await freshReview.getByLabel('I have checked the current evidence and confirm this reviewed basis.',{exact:true}).check();
 const verifyEndpoint=app+'/api/workspace/work/'+task.id+'/review/verify';
 const [verifiedResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===verifyEndpoint&&response.request().method()==='POST'),
  verifyButton.click()
 ]);
 const verified=await bounded(verifiedResponse.json(),'Fresh work verification body');
 assert.equal(verifiedResponse.status(),200,verified.error||'fresh verification failed');
 assert.equal(verified.taskId,task.id);
 assert.equal(verified.reused,false);
 assert.equal(verified.evidenceCount,1);
 await reviewDetail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();
 const reviewEvent=await db.auditEvent.findUniqueOrThrow({where:{id:verified.eventId}});
 assert.equal(reviewEvent.organizationId,org.id);
 assert.equal(reviewEvent.entityId,task.id);
 assert.equal(reviewEvent.actorId,reviewer.id);
 assert.equal(reviewEvent.action,'work.review_verified');
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,entityId:task.id,action:'work.review_verified'}}),1);
 assert.deepEqual((await db.auditEvent.findUniqueOrThrow({where:{id:saved.id}})).details,saved.details,'the fresh basis must preserve the original completion receipt');
 const afterReview=await db.obligation.findUniqueOrThrow({where:{id:task.id}});
 assert.equal(afterReview.status,'COMPLETE');
 assert.equal(afterReview.completedAt.toISOString(),finished.completedAt.toISOString());
 assert.equal((await db.obligation.findUniqueOrThrow({where:{id:assigned.id}})).status,'OPEN','verification must not silently close assigned follow-up work');
 const freshDownloadReady=review.waitForEvent('download');
 await reviewDetail.getByRole('button',{name:'Download fresh review record',exact:true}).click();
 const freshDownload=await freshDownloadReady;
 const freshRecord=JSON.parse(await readFile(await bounded(freshDownload.path(),'Fresh review record download'),'utf8'));
 assert.equal(JSON.stringify(freshRecord).includes(record.storageKey),false,'review export must not disclose private storage keys');
 assert.deepEqual(freshRecord.record,reviewEvent.details.record,'the exported fresh record must match the persisted reviewed decision');
 assert.equal(freshRecord.basis.eventId,verified.eventId);
 assert.equal(freshRecord.basis.proofHash,verified.proofHash,'fresh export must identify the persisted reviewed basis');
 await writeFile(artifactDir+'/fresh-review-record.json',JSON.stringify(freshRecord,null,2)+'\n');
 await review.reload();
 await reviewDetail.getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();
 await reviewDetail.getByRole('link',{name:'Open follow-up task',exact:true}).waitFor();
 await review.screenshot({path:artifactDir+'/desktop-fresh-review.png',fullPage:true});
 await upload.goto(app+'/team/work/reviews?'+params);
 await upload.getByRole('region',{name:'Completed work review',exact:true}).getByRole('heading',{name:'No recorded changes detected',exact:true}).waitFor();
 assert.equal(await upload.getByRole('button',{name:'Verify files and record fresh review',exact:true}).count(),0,'an editor cannot perform administrator review');
 assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile fresh-review layout inspection'));
 await upload.screenshot({path:artifactDir+'/mobile-fresh-review.png',fullPage:true});
 await review.goto(new URL(followLocation,app).href);
 await review.getByRole('dialog').getByRole('heading',{name:assigned.title,exact:true}).waitFor();
 passed('A fresh review verified private bytes, persisted a new basis and cleared the change alert after reload; the original completion and open follow-up remained intact on desktop and mobile.');

 const storageSnapshot=async()=>{
  const {data,error}=await supabase.storage.from('journey-files').list(org.id,{limit:1000,sortBy:{column:'name',order:'asc'}});
  if(error)throw Error('Unable to inspect isolated evidence object population');
  return (data||[]).map(object=>({name:object.name,id:object.id,size:object.metadata?.size??null})).sort((a,b)=>a.name.localeCompare(b.name));
 };
 report.customerJourney=await sourceToReportJourney({upload,review,db,app,org,editor,reviewer,submitEvidence,checkpoint,passed,bounded,artifactDir,reuseEvidence:rereviewed,reusedBytes:file,storageSnapshot});
 report.starterProgrammeJourney=await starterProgrammeCustomerJourney({upload,review,db,app,org,editor,reviewer,checkpoint,passed,bounded,artifactDir});
 report.riskJourney=await riskCustomerJourney({upload,review,db,app,org,editor,reviewer,checkpoint,passed,bounded,artifactDir,completedSource:report.customerJourney,evidenceId:rereviewed.id,storageSnapshot});

 await checkpoint('unavailable organisation isolation');
 await review.goto(app+'/team/evidence?'+new URLSearchParams({organizationId:randomUUID(),taskId:task.id}));
 await review.getByText(/belongs to an unavailable organisation/).waitFor();
 assert.equal(await review.getByLabel('Evidence document').count(),0);
 assert.deepEqual(errors,[]);
 passed('The review queue cleared and an unavailable workspace offered no upload.');
 report.passed=true;
 report.stage='complete';
}catch(error){
 report.failure={name:error.name,message:error.message};
 await saveReport();
 // Record only our fictional application pages. Auth URLs, tokens, request headers,
 // mailbox contents and local service credentials are deliberately excluded.
 for(const [index,page] of (browser?.contexts().flatMap(context=>context.pages())||[]).entries()){
  const url=new URL(page.url());
  if(url.origin===app&&!url.searchParams.has('code'))
   await bounded(page.screenshot({path:`${artifactDir}/failure-page-${index+1}.png`,fullPage:true,timeout:5_000}),'Failure screenshot',7_500).catch(()=>{});
 }
 throw error;
}finally{
 report.assertionsPassed=report.passed;report.passed=false;report.cleanup={state:'running'};
 await saveReport();
 const cleanup=await Promise.allSettled([
  bounded(browser?.close()||Promise.resolve(),'Browser cleanup'),
  bounded(db.$disconnect(),'Database cleanup')
 ]);
 report.cleanup={browser:cleanup[0].status,database:cleanup[1].status};
 const failures=cleanup.filter(result=>result.status==='rejected');
 report.passed=report.assertionsPassed&&!failures.length;
 await saveReport();
 if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Journey cleanup did not complete');
}
