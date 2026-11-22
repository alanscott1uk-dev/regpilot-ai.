import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixturePdf} from '../tests/helpers/pdf-fixture.mjs';

export async function outlookCaseJourney({upload,review,db,app,org,otherOrgId,editor,checkpoint,passed}){
 await checkpoint('transfer a selected Outlook message to an authenticated quality case');
 const row=await db.qualityCase.create({data:{organizationId:org.id,ownerId:editor.id,createdById:editor.id,createKey:randomUUID(),
  title:'Simulated supplier delivery query',kind:'DEVIATION',classification:'MINOR',occurredAt:new Date('2026-01-05'),
  description:'Supplier reported a delivery discrepancy on a fictional order.',impact:'One delivery record needs an independent check.',containment:'Keep the delivery on hold while checking the documents.'}});
 const task=await db.obligation.create({data:{organizationId:org.id,title:'Review supplier delivery note',category:'Supplier evidence',ownerName:editor.email,assigneeId:editor.id,dueDate:new Date()}});
 await db.qualityAction.create({data:{organizationId:org.id,caseId:row.id,cycle:1,obligationId:task.id,requestKey:randomUUID(),kind:'CORRECTIVE',
  purpose:'Check the supplier delivery note against the incoming receipt.',createdById:editor.id}});
 const manifest=await upload.request.get(app+'/api/tools/outlook-manifest');
 assert.equal(manifest.status(),200);
 const xml=await manifest.text();assert.ok(xml.includes('<Permissions>ReadItem</Permissions>')&&xml.includes(app+'/outlook/pane.html'));
 for(const size of [16,32,64,80,128])assert.equal((await upload.request.get(app+'/outlook/icon-'+size+'.png')).status(),200);
 const pdf=Buffer.from(fixturePdf([['FICTIONAL DELIVERY RECORD','Delivery reference A-19.']]));
 const pane=await upload.context().newPage();
 await pane.route('https://appsforoffice.microsoft.com/lib/1/hosted/office.js',async route=>{
  const data=JSON.stringify({file:pdf.toString('base64'),size:pdf.length});
  await route.fulfill({contentType:'text/javascript',body:`const example=${data};
   window.Office={HostType:{Outlook:'Outlook'},onReady:fn=>fn({host:'Outlook'}),AsyncResultStatus:{Succeeded:'succeeded'},
   CoercionType:{Text:'text'},MailboxEnums:{AttachmentContentFormat:{Base64:'base64'}},context:{mailbox:{item:{
   internetMessageId:'<example-A19@supplier.example>',from:{emailAddress:'dispatch@supplier.example'},subject:'Fictional delivery query A-19',dateTimeCreated:new Date('2026-01-05T10:00:00Z'),
   body:{getAsync:(type,done)=>done({status:'succeeded',value:'Please check delivery A-19. Internal footer to omit.'})},
   attachments:[{id:'doc',name:'delivery-note.pdf',attachmentType:'file',isInline:false,size:example.size},{id:'other',name:'unused.pdf',attachmentType:'file',isInline:false,size:100}],
   getAttachmentContentAsync:(id,done)=>{if(id!=='doc')throw Error('An unselected attachment was requested');done({status:'succeeded',value:{format:'base64',content:example.file}});}
   }}}};`});
 });
 await pane.goto(app+'/outlook/pane.html');await pane.getByRole('button',{name:'Read selected message'}).click();
 await pane.getByLabel('Message text to include').fill('Please check delivery A-19.');
 await pane.getByLabel('delivery-note.pdf',{exact:true}).check();
 await pane.getByRole('button',{name:'Prepare selected content'}).click();
 const [download]=await Promise.all([pane.waitForEvent('download'),pane.getByRole('button',{name:'Download transfer file'}).click()]);
 const file=await readFile(await download.path());
 const packet=JSON.parse(file.toString());assert.equal(packet.files.length,1);assert.equal(packet.source.excerpt,'Please check delivery A-19.');
 const [work]=await Promise.all([pane.waitForEvent('popup'),pane.getByRole('button',{name:'Open RegPilot workspace'}).click()]);
 const url=app+'/team/quality?'+new URLSearchParams({organizationId:org.id,caseId:row.id});
 await work.goto(url);
 const correspondence=work.locator('#quality-correspondence');
 await work.locator('#quality-correspondence > summary').click();
 await correspondence.getByRole('button',{name:'Receive from Outlook'}).click();
 await correspondence.getByRole('heading',{name:'Review email before saving'}).waitFor();
 await correspondence.getByLabel('Case action for attachments',{exact:true}).selectOption(task.id);
 const save=correspondence.getByRole('button',{name:'Save email to this case'});
 assert.equal(await save.isDisabled(),true);
 assert.equal(await db.evidence.count({where:{organizationId:org.id,obligationId:task.id}}),0);
 await correspondence.getByLabel('Save this selection to '+row.title).check();
 let submitted,token;
 await work.route('**/api/workspace/quality',async route=>{
  const req=route.request();
  if(req.method()!=='POST'||req.postDataJSON()?.action!=='RECORD_EMAIL')return route.continue();
  submitted=req.postDataJSON();token=(await req.allHeaders()).authorization;
  const saved=await route.fetch();assert.equal(saved.status(),200);await route.abort('failed');
 },{times:1});
 await save.click();
 await correspondence.getByRole('status').filter({hasText:'Retrying the same files reuses them'}).waitFor();
 await save.click();await work.getByText('Email saved to this case.',{exact:false}).waitFor();
 assert.equal(await db.qualityOperation.count({where:{organizationId:org.id,caseId:row.id,action:'RECORD_EMAIL'}}),1);
 const stored=await db.evidence.findMany({where:{organizationId:org.id,obligationId:task.id}});
 assert.equal(stored.length,1);assert.equal(stored[0].reviewStatus,'PENDING_REVIEW');
 assert.equal(stored[0].sha256,createHash('sha256').update(pdf).digest('hex'));
 const headers={authorization:token,'content-type':'application/json'};
 for(const [overrides,status] of [[{organizationId:otherOrgId},404],[{requestKey:randomUUID(),taskId:randomUUID(),source:{...packet.source,messageId:'<changed@example>'},version:2},409]]){
  const invalid=await work.request.post(app+'/api/workspace/quality',{headers,data:{...submitted,...overrides}});
  assert.equal(invalid.status(),status);
 }
 await review.goto(url);await review.locator('#quality-correspondence > summary').click();
 await review.getByRole('heading',{name:packet.source.subject}).waitFor();
 assert.equal(await review.getByText('Please check delivery A-19.',{exact:true}).count(),1);
 const link=await review.getByRole('link',{name:'delivery-note.pdf',exact:true}).getAttribute('href');
 assert.equal(new URL(link,app).searchParams.get('evidenceId'),stored[0].id);
 const [inspection]=await Promise.all([review.waitForEvent('download'),review.getByRole('button',{name:'Download inspection summary',exact:true}).click()]);
 const report=await readFile(await inspection.path(),'utf8');assert.ok(report.includes(packet.source.messageId)&&report.includes(stored[0].sha256)&&!report.includes('Internal footer'));
 await work.locator('#quality-correspondence > summary').click();
 await correspondence.getByLabel('Outlook transfer file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await correspondence.getByText(/Choose a RegPilot Outlook transfer with a valid message/).waitFor();
 await correspondence.getByLabel('Outlook transfer file').setInputFiles({name:'mail.regpilot-mail.json',mimeType:'application/json',buffer:file});
 await correspondence.getByRole('heading',{name:'Review email before saving'}).waitFor();
 await work.close();await pane.close();
 passed('A simulated Outlook host transferred only the selected text and PDF to a signed-in case. A lost response recovered one email and one scanned file. Wrong-organisation and unrelated-task saves were refused; an independent account retrieved the exact evidence hash.');
 return {caseId:row.id,selected:1,scannedFiles:stored.length,customerMailbox:false};
}
