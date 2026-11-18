// Runs on an isolated runner. The browser uses real email-link sign-in and the app's normal routes.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {PrismaClient} from '@prisma/client';
import {createClient} from '@supabase/supabase-js';
import {fixturePdf} from '../tests/helpers/pdf-fixture.mjs';

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
async function account(email,role,organizationId){
 const {data,error}=await supabase.auth.admin.createUser({email,email_confirm:true});
 if(error)throw Error('Local Auth account setup failed: '+error.status);
 return db.user.create({data:{externalId:data.user.id,email,memberships:{create:{organizationId,role}}}});
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
 const org=await db.organization.create({data:{name:'Fictional quality team'}});
 const editor=await account('editor@example.test','EDITOR',org.id);
 const reviewer=await account('reviewer@example.test','ADMIN',org.id);
 const {error}=await supabase.storage.createBucket('journey-files',{public:false});
 if(error)throw Error('Could not create the private local test bucket');
 const common={organizationId:org.id,category:'Quality',ownerName:editor.email,assigneeId:editor.id};
 await db.obligation.createMany({data:Array.from({length:101},(_,i)=>({...common,title:'Earlier deadline '+i,dueDate:new Date('2028-01-01')}))});
 const title='Check cold-chain training records';
 const task=await db.obligation.create({data:{...common,title,dueDate:new Date('2028-12-01')}});
 const params=new URLSearchParams({organizationId:org.id,taskId:task.id});
 const vault=app+'/team/evidence?'+params;
 browser=await chromium.launch();
 await checkpoint('email-link sign-in and exact-task selection');
 const upload=await signIn(await openContext({width:390,height:844}),vault,editor.email);
 await upload.getByRole('link',{name:'Return to task'}).waitFor();
 assert.equal(await upload.getByLabel('Task',{exact:true}).inputValue(),task.id);
 assert.equal(new URL(upload.url()).pathname,'/team/evidence');
 assert.equal(new URL(upload.url()).searchParams.has('code'),false);
 await upload.getByText('No scanned evidence has been recorded for this task.',{exact:true}).waitFor();
 passed('Email-link callback restored the requested task beyond the first 100 results and loaded its evidence.');
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
 const review=await signIn(await openContext({width:1440,height:1000}),app+'/team/work',reviewer.email);
 await review.getByRole('button',{name:/Evidence to review/}).click();
 await review.getByRole('article').filter({hasText:title}).getByRole('link',{name:'Review files'}).click();
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
 await review.getByRole('button',{name:/Evidence to review/}).click();
 await review.getByRole('button',{name:/Evidence to review\s*0$/}).waitFor();
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
