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
const supabase=createClient(api,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const errors=[];
const artifactDir='artifacts/usability/private-evidence';
const report={passed:false,stage:'local setup',checks:[],responses:[]};
let browser;
function passed(message){report.checks.push(message);console.log(message);}
async function submitEvidence(page,filename,bytes,expectedStatus){
 await page.getByLabel('Evidence document').setInputFiles({name:filename,mimeType:'application/pdf',buffer:bytes});
 const [response]=await Promise.all([
  page.waitForResponse(r=>r.url()===app+'/api/workspace/evidence'&&r.request().method()==='POST'),
  page.getByRole('button',{name:'Scan and store privately'}).click()
 ]);
 const body=await response.json();
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
  const inbox=await (await fetch(mail+'/api/v1/messages')).json();
  const item=inbox.messages?.find(m=>m.To.some(address=>address.Address===email));
  if(item){
   const message=await (await fetch(mail+'/api/v1/message/'+item.ID)).json();
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
 report.stage='email-link sign-in and exact-task selection';
 const upload=await signIn(await openContext({width:390,height:844}),vault,editor.email);
 await upload.getByRole('link',{name:'Return to task'}).waitFor();
 assert.equal(await upload.getByLabel('Task',{exact:true}).inputValue(),task.id);
 assert.equal(new URL(upload.url()).pathname,'/team/evidence');
 assert.equal(new URL(upload.url()).searchParams.has('code'),false);
 await upload.getByText('No scanned evidence has been recorded for this task.',{exact:true}).waitFor();
 passed('Email-link callback restored the requested task beyond the first 100 results and loaded its evidence.');
 report.stage='marked PDF rejection';
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
 report.stage='clean PDF upload and mobile task return';
 const file=fixturePdf([['Fictional cold-chain training record for independent review.']]);
 const stored=await submitEvidence(upload,'training-record.pdf',file,201);
 assert.equal(stored.evidence.obligationId,task.id);
 assert.equal(stored.evidence.reviewStatus,'PENDING_REVIEW');
 await upload.getByText('training-record.pdf',{exact:true}).waitFor();
 await upload.getByText(/A different owner or administrator must review evidence you uploaded/).waitFor();
 assert.equal(await upload.getByLabel('Independent review rationale').count(),0);
 assert.ok(await upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 const detail=upload.getByRole('dialog');
 await upload.getByRole('link',{name:'Return to task'}).click();
 await detail.getByText('training-record.pdf',{exact:true}).waitFor();
 await detail.getByText(/Pending review/i).first().waitFor();
 passed('Mobile uploader passed email verification, exact-task selection, private upload and return to task.');

 report.stage='independent reviewer sign-in and original download';
 const review=await signIn(await openContext({width:1440,height:1000}),app+'/team/work',reviewer.email);
 await review.getByRole('button',{name:/Evidence to review/}).click();
 await review.getByRole('article').filter({hasText:title}).getByRole('link',{name:'Review files'}).click();
 await review.getByText('training-record.pdf',{exact:true}).waitFor();
 passed('Second account opened the submitted file from its independent review queue.');
 const downloadReady=review.waitForEvent('download');
 await review.getByRole('button',{name:'Download verified original'}).click();
 const download=await downloadReady;
 assert.deepEqual(await readFile(await download.path()),file);
 const notes='Checked the dated fictional training record against the task scope.';
 report.stage='independent review persistence and task state';
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
 const audit=await db.auditEvent.findMany({where:{entityType:'Evidence',entityId:record.id}});
 assert.ok(audit.some(e=>e.action==='evidence.scanned_upload' && e.actorId===editor.id && e.details.scanEngine==='clamd'));
 assert.ok(audit.some(e=>e.action==='evidence.independent_review' && e.actorId===reviewer.id));
 assert.equal((await db.obligation.findUniqueOrThrow({where:{id:task.id}})).status,'OPEN');
 await review.getByRole('link',{name:'Return to task'}).click();
 await review.getByRole('dialog').getByText(/approved · added/i).waitFor();
 await review.getByRole('button',{name:'Close task details'}).click();
 await review.getByRole('button',{name:/Evidence to review/}).click();
 await review.getByRole('button',{name:/Evidence to review\s*0$/}).waitFor();
 report.stage='unavailable organisation isolation';
 await review.goto(app+'/team/evidence?'+new URLSearchParams({organizationId:randomUUID(),taskId:task.id}));
 await review.getByText(/belongs to an unavailable organisation/).waitFor();
 assert.equal(await review.getByLabel('Evidence document').count(),0);
 assert.deepEqual(errors,[]);
 passed('Independent reviewer verified original bytes, recorded approval, cleared the review queue and preserved the open task. Unavailable workspace offered no upload.');
 report.passed=true;
 report.stage='complete';
}catch(error){
 report.failure={name:error.name,message:error.message};
 await mkdir(artifactDir,{recursive:true});
 // Record only our fictional application pages. Auth URLs, tokens, request headers,
 // mailbox contents and local service credentials are deliberately excluded.
 for(const [index,page] of (browser?.contexts().flatMap(context=>context.pages())||[]).entries()){
  const url=new URL(page.url());
  if(url.origin===app&&!url.searchParams.has('code'))
   await page.screenshot({path:`${artifactDir}/failure-page-${index+1}.png`,fullPage:true}).catch(()=>{});
 }
 throw error;
}finally{
 await mkdir(artifactDir,{recursive:true});
 await writeFile(artifactDir+'/results.json',JSON.stringify({...report,pageErrors:errors},null,2)+'\n');
 await browser?.close();
 await db.$disconnect();
}
