import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureDocx,paragraph} from '../tests/helpers/docx-fixture.mjs';

async function paneWithFixture(page,app,host,script){
 const manifest=await page.request.get(app+'/api/tools/office-manifest/'+host);
 assert.equal(manifest.status(),200);const xml=await manifest.text();
 assert.ok(xml.includes('<Permissions>'+(host==='word'?'ReadAllDocument':'ReadDocument')+'</Permissions>'));
 assert.ok(xml.includes(app+'/office/pane.html?host='+host));
 const pane=await page.context().newPage();
 await pane.route('https://appsforoffice.microsoft.com/lib/1/hosted/office.js',route=>route.fulfill({contentType:'text/javascript',
  body:"window.Office={AsyncResultStatus:{Succeeded:'ok'},HostType:{Word:'Word',Excel:'Excel'},FileType:{Compressed:'compressed'},CoercionType:{Matrix:'matrix'},ValueFormat:{Unformatted:'unformatted'},onReady:fn=>fn({host:"+JSON.stringify(host==='word'?'Word':'Excel')+"}),context:{document:{}}};"+script}));
 await pane.goto(app+'/office/pane.html?host='+host);await pane.getByRole('button',{name:'Prepare for review'}).click();
 return pane;
}
export async function wordReviewJourney({upload,review,app,org,db,editor,checkpoint,passed}){
 await checkpoint('file the exact open Word procedure for independent review');
 const task=await db.obligation.create({data:{organizationId:org.id,title:'Review fictional Word SOP pilot revision',category:'Document control',ownerName:editor.email,assigneeId:editor.id,dueDate:new Date('2001-01-01')}});
 const original=Buffer.from(fixtureDocx(paragraph('Fictional receiving procedure revision three. Check the document before accepting this delivery.')));
 const hash=createHash('sha256').update(original).digest('hex');
 const pane=await paneWithFixture(upload,app,'word',`const bytes=Uint8Array.from(atob('${original.toString('base64')}'),s=>s.charCodeAt(0)),cut=Math.ceil(bytes.length/2);
 Office.context.document.url='https://example.test/folder/pilot-receiving.docx';
 Office.context.document.getFileAsync=(kind,opts,cb)=>cb({status:'ok',value:{size:bytes.length,sliceCount:2,
 getSliceAsync:(i,done)=>done({status:'ok',value:{index:i,data:Array.from(i?bytes.slice(cut):bytes.slice(0,cut))}}),
 closeAsync:done=>{window.fileClosed=true;done({status:'ok'})}}});`);
 await pane.getByText(/pilot-receiving.docx ·/).waitFor();assert.equal(await pane.evaluate(()=>window.fileClosed),true);
 const [work]=await Promise.all([pane.waitForEvent('popup'),pane.getByRole('button',{name:'Open RegPilot',exact:true}).click()]);
 await work.goto(app+'/sop-builder?'+new URLSearchParams({organizationId:org.id}));
 await work.getByText('Review a Word SOP',{exact:true}).click();
 await work.getByRole('button',{name:'Receive from Word'}).click();
 await work.getByText(/pilot-receiving.docx ·/).waitFor();
 await work.getByLabel('Evidence task').selectOption(task.id);
 const receive=work.waitForResponse(r=>r.url()===app+'/api/workspace/evidence'&&r.request().method()==='POST');
 await work.getByRole('button',{name:'Send Word draft for review'}).click();
 const response=await receive;assert.equal(response.status(),201);
 const {evidence}=await response.json();assert.equal(evidence.sha256,hash);assert.equal(evidence.reviewStatus,'PENDING_REVIEW');
 await review.goto(app+'/team/evidence?'+new URLSearchParams({organizationId:org.id,taskId:task.id,evidenceId:evidence.id}));
 const card=review.locator('article').filter({has:review.getByText('pilot-receiving.docx',{exact:true})});
 await card.getByLabel('Independent review rationale').fill('The fictional receiving procedure and selected revision match the source provided.');
 await card.getByRole('button',{name:'Approve evidence'}).click();await card.getByText('APPROVED',{exact:true}).waitFor();
 assert.equal((await db.evidence.findUniqueOrThrow({where:{id:evidence.id}})).sha256,hash);
 await work.close();await pane.close();passed('The simulated Word host released the file handle. An editor transferred the exact DOCX bytes and a separate reviewer approved the scanned draft.');
 return {draftHash:hash,officeHost:'simulated'};
}
export async function excelSelection(upload,app){
 const headers=['Type','Time UTC','Reference','Quantity','Site','Product','Batch','Unit'];
 const rows=[headers,...[['OPEN','08','Opening',10],['OUT','09','L1',2],['COUNT','10','Sheet',7]].map(([type,h,ref,n])=>[type,'2025-06-01T'+h+':00:00Z',ref,n,'Site A','Test product','TEST-1','packs'])];
 const pane=await paneWithFixture(upload,app,'excel','Office.context.document.getSelectedDataAsync=(type,opts,cb)=>cb({status:"ok",value:'+JSON.stringify(rows)+'});');
 await pane.getByText('3 selected stock rows').waitFor();
 const [dl]=await Promise.all([pane.waitForEvent('download'),pane.getByRole('button',{name:'Download a copy'}).click()]);
 const bytes=await readFile(await dl.path());assert.deepEqual(JSON.parse(bytes).rows,rows);await pane.close();return bytes;
}
