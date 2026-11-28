// Browser -> authenticated application -> PostgreSQL/private storage -> downloaded artifacts.
// Only the test company, customer requests and supporting content are fictional.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fixtureWorkbook,inlineCell,sheetRow} from '../tests/helpers/questionnaire-workbook-fixture.mjs';
import {fixtureFillablePdf,readPdfAnswerFields} from '../tests/helpers/pdf-fixture.mjs';
import {fixtureDocx,paragraph} from '../tests/helpers/docx-fixture.mjs';
import {readZipParts} from '../tests/helpers/zip-inspection.mjs';
import {inspectQuestionnaireFile} from '../lib/server/questionnaire-workbook.mjs';

export async function runQuestionnaireFormatJourney({upload,review,app,org,editor,reviewer,db,evidenceId,artifactDir,checkpoint,passed,bounded}){
 const query='?'+new URLSearchParams({organizationId:org.id}),file=await db.evidence.findUniqueOrThrow({where:{id:evidenceId}}),question='How are fictional cold-chain training records retained?',scope='Fictional document format review',answer='The supplied fictional cold-chain training record is retained for independent review. It does not establish a broader retention schedule or verify other completed controls.';
 const match=(path,method)=>response=>new URL(response.url()).pathname===path&&response.request().method()===method;
 async function action(page,path,method,perform,status=200){const [response]=await Promise.all([page.waitForResponse(match(path,method)),perform()]);const body=await bounded(response.json(),'Questionnaire format response '+path);assert.equal(response.status(),status,body.error||path);return body;}
 async function download(button){const ready=review.waitForEvent('download'),http=review.waitForResponse(response=>{const path=new URL(response.url()).pathname;return path.startsWith('/api/workspace/questionnaires/')&&(/\/(?:export|original-export)$/).test(path)&&['GET','POST'].includes(response.request().method());});await button.click();const response=await bounded(http,'Verified streaming response');assert.equal(response.status(),200);assert.equal(response.headers()['content-length'],undefined,'verified downloads must not be buffered behind Content-Length');assert.match(response.headers()['cache-control']||'',/no-transform/);const result=await ready;return readFile(await bounded(result.path(),'Questionnaire format download'));}
 async function approve(id,reference){
  const path=app+'/team/questionnaires'+query+'&questionnaireId='+id,endpoint='/api/workspace/questionnaires/'+id;
  await upload.goto(path);await upload.getByRole('button',{name:'Open question '+reference,exact:true}).click();await upload.getByLabel('Approved response for '+reference,{exact:true}).selectOption(saved.id);await upload.getByRole('checkbox',{name:'I checked the complete response, customer instructions, scope and evidence. This answer addresses this question.',exact:true}).check();await action(upload,endpoint,'PATCH',()=>upload.getByRole('button',{name:'Confirm this response',exact:true}).click());
  await review.goto(path);const disclosure=review.getByRole('region',{name:'Disclosure review and export',exact:true});await disclosure.getByLabel('Independent disclosure review',{exact:true}).fill('Independently inspected the exact fictional customer question, original source passage, selected response, limitations, recipient and evidence bytes for this disclosure.');await disclosure.getByRole('checkbox',{name:'I independently reviewed these exact responses, evidence references, recipient and scope.',exact:true}).check();await action(review,endpoint,'PATCH',()=>disclosure.getByRole('button',{name:'Approve customer disclosure',exact:true}).click());assert.equal((await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id}})).reviewerId,reviewer.id);return disclosure;
 }
 await checkpoint('create a current independently approved answer for document-format responses');
 await upload.goto(app+'/team/answers'+query);await upload.getByRole('button',{name:'Prepare a reusable answer',exact:true}).click();await upload.getByLabel('Question',{exact:true}).fill(question);await upload.getByLabel('Applies to',{exact:true}).fill(scope);await upload.getByLabel('Answer and limitations',{exact:true}).fill(answer);await upload.getByRole('checkbox',{name:file.filename,exact:true}).check();await upload.getByRole('checkbox',{name:'I checked the current facts, response scope, product applicability, limitations and supporting evidence.',exact:true}).check();
 const saved=await action(upload,'/api/workspace/answers','POST',()=>upload.getByRole('button',{name:'Save answer for independent review',exact:true}).click(),201);
 await review.goto(app+'/team/answers'+query+'&answerId='+saved.id);await review.getByLabel('Independent review of wording, scope and evidence',{exact:true}).fill('Independently inspected the exact fictional response and current private supporting document for this bounded customer format verification.');await review.getByRole('checkbox',{name:'I independently checked the complete answer, its scope, limitations and current supporting evidence.',exact:true}).check();await action(review,'/api/workspace/answers/'+saved.id,'PATCH',()=>review.getByRole('button',{name:'Approve for reuse',exact:true}).click());

 await checkpoint('return approved answers in the digest-matching original XLSX and download its evidence ZIP');
 const original=fixtureWorkbook([{name:'Security',xml:sheetRow(1,[inlineCell('A1','Reference'),inlineCell('B1','Question'),inlineCell('C1','Answer')])+sheetRow(2,[inlineCell('A2','Q1'),inlineCell('B2',question),inlineCell('C2','Unapproved buyer placeholder')])},{name:'Buyer notes',xml:sheetRow(1,[inlineCell('A1','Fictional buyer-owned layout and notes remain unchanged.')])}]);
 await upload.goto(app+'/team/questionnaires'+query);await upload.getByRole('button',{name:'Import questionnaire',exact:true}).click();let intake=upload.getByRole('region',{name:'Import a questionnaire',exact:true});await intake.getByLabel('Questionnaire file',{exact:true}).setInputFiles({name:'buyer-original.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original});await action(upload,'/api/workspace/questionnaires/inspect','POST',()=>intake.getByRole('button',{name:'Inspect questionnaire file',exact:true}).click());await intake.getByLabel('Questionnaire name',{exact:true}).fill('Fictional original-format response');await intake.getByLabel('Prepared for',{exact:true}).fill('Fictional customer');await intake.getByLabel('Response scope',{exact:true}).fill(scope);await intake.getByLabel('Initial question owner',{exact:true}).selectOption(editor.id);await intake.getByRole('checkbox',{name:'I checked the selected questions, customer context, recipient and response scope.',exact:true}).check();const xlsx=await action(upload,'/api/workspace/questionnaires/import','POST',()=>intake.getByRole('button',{name:'Import 1 questions',exact:true}).click(),201);
 await approve(xlsx.id,'Q1');const packages=review.getByRole('region',{name:'Customer response packages',exact:true});await packages.getByText('Return answers in the original XLSX',{exact:true}).click();await packages.getByLabel('Exact original XLSX',{exact:true}).setInputFiles({name:'buyer-original.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original});await packages.getByLabel('Original answer column Security General response',{exact:true}).selectOption('3');await packages.getByRole('checkbox',{name:'I checked the customer’s answer columns and the separate product response mappings.',exact:true}).check();
 const completed=await download(packages.getByRole('button',{name:'Download completed original XLSX',exact:true})),read=await inspectQuestionnaireFile(completed,'completed.xlsx'),beforeParts=await readZipParts(original),afterParts=await readZipParts(completed);assert.equal(read.sheets[0].rows[1].cells[2],answer);for(const [name,bytes] of beforeParts)if(name!=='xl/worksheets/sheet1.xml')assert.deepEqual(afterParts.get(name),bytes,name+' remains unchanged');await writeFile(artifactDir+'/completed-original-questionnaire.xlsx',completed);
 const zipped=await download(packages.getByRole('button',{name:'Download response and evidence ZIP',exact:true})),parts=await readZipParts(zipped),manifest=JSON.parse(parts.get('manifest.json').toString());assert.equal(manifest.files.length,1);assert.equal(manifest.files[0].sha256,file.sha256);assert.equal(createHash('sha256').update(parts.get(manifest.files[0].filename)).digest('hex'),file.sha256);assert.equal(manifest.questions[0].evidence[0].archiveEntry,manifest.files[0].filename);assert.doesNotMatch(parts.get('manifest.json').toString(),/storageKey|reviewerId|uploadedById/);const response=await inspectQuestionnaireFile(parts.get('responses.xlsx'),'responses.xlsx');assert.equal(response.sheets[0].rows[1].cells[2],answer);await writeFile(artifactDir+'/questionnaire-response-evidence.zip',zipped);await review.screenshot({path:artifactDir+'/desktop-questionnaire-response-pack.png',fullPage:true});
 passed('An authenticated customer XLSX upload was independently answered and approved. Re-uploading the identical original returned the approved answer in its original cell while every untouched ZIP part remained byte-identical. A real private-file ZIP contained the approved responses, exact original evidence bytes and a verified question-to-file manifest.');

 await checkpoint('prepare independently approved answers for a buyer portal without installing a helper');
 await packages.getByText('Complete a buyer’s online questionnaire',{exact:true}).click();
 await packages.getByLabel('Buyer questionnaire URL').waitFor();
 assert.equal(await packages.getByLabel('Buyer questions, one per line').inputValue(),question);
 await packages.getByLabel('Buyer questionnaire URL').fill('https://buyer.example.invalid/security?review=fixture');
 await packages.getByLabel('Buyer questions, one per line').fill(question+'\nWhich unknown question remains blank?');
 await packages.getByRole('button',{name:'Find approved answers',exact:true}).click();
 await packages.getByRole('checkbox',{name:question,exact:true}).check();
 await packages.getByRole('checkbox',{name:'I independently checked the destination, questions, product scope, answers and citations.',exact:true}).check();
 await packages.getByRole('button',{name:'Prepare answers for manual entry',exact:true}).click();
 const copyRegion=packages.getByRole('region',{name:'Approved answers for manual entry',exact:true});
 await copyRegion.waitFor();
 assert.equal(await copyRegion.getByRole('textbox',{name:question,exact:true}).inputValue(),answer);
 await copyRegion.getByText('Copy the whole table for a spreadsheet or portal grid',{exact:true}).click();
 const table=await copyRegion.getByLabel('Questions and approved answers',{exact:true}).inputValue();
 assert.deepEqual(table.split(/\r?\n/),[question+'\t'+answer,'Which unknown question remains blank?\t']);
 assert.equal(await copyRegion.getByRole('button',{name:'Copy answer for '+question,exact:true}).count(),1);
 passed('A signed-in reviewer prepared an approved answer for a buyer portal in a browser without an extension or file transfer. The unrecognised buyer question received no answer.');

 await checkpoint('fill an independent buyer origin through the bookmark and the one-time RegPilot pairing code');
 await packages.getByText('Fill the buyer’s form with a browser bookmark',{exact:true}).click();
 const bookmark=packages.getByText('RegPilot questionnaire',{exact:true});
 await bookmark.locator('xpath=self::a[starts-with(@href,"javascript:")]').waitFor();
 const bookmarkUrl=await bookmark.getAttribute('href');
 await packages.getByRole('checkbox',{name:'I independently checked the destination, questions, product scope, answers and citations.',exact:true}).check();
 await packages.getByRole('button',{name:'Get pairing code for the buyer bookmark',exact:true}).click();
 const code=await packages.getByLabel('Buyer bookmark pairing code').inputValue();
 const buyer=await review.context().newPage(),buyerUrl='https://buyer.example.invalid/security?review=fixture';
 const buyerHTML='<html lang="en"><title>Fictional buyer</title><form><label>'+question+'<textarea></textarea></label><label>Which unknown question remains blank?<textarea></textarea></label><label for="buyer-note">Customer note</label><textarea id="buyer-note">Existing buyer text</textarea><button>Submit</button></form><script>window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++};</script></html>';
 await buyer.route('https://buyer.example.invalid/**',r=>r.fulfill({contentType:'text/html',body:buyerHTML}));
 async function openExchange(url){
  await buyer.goto(url);await buyer.evaluate(address=>{location.href=address;},bookmarkUrl);
  const opened=buyer.waitForEvent('popup');await buyer.getByRole('button',{name:'Fill reviewed answers',exact:true}).click();
  const page=await opened;await page.getByLabel('One-time pairing code').fill(code);return page;
 }
 const wrong=await openExchange(buyerUrl+'&different=yes');await wrong.getByRole('button',{name:'Fill approved fields'}).click();
 await wrong.getByText(/The code expired, the approval changed, or the buyer page does not match/).waitFor();
 assert.equal(await buyer.getByLabel(question,{exact:true}).inputValue(),'');await wrong.close();
 const exchange=await openExchange(buyerUrl);await exchange.getByRole('button',{name:'Fill approved fields'}).click();
 await exchange.getByText(/Filled 1 reviewed field/).waitFor();
 assert.equal(await buyer.getByLabel(question,{exact:true}).inputValue(),answer);
 assert.equal(await buyer.getByLabel('Which unknown question remains blank?',{exact:true}).inputValue(),'');
 assert.equal(await buyer.getByLabel('Customer note',{exact:true}).inputValue(),'Existing buyer text');assert.equal(await buyer.evaluate(()=>window.submits),0);
 await exchange.close();
 const replay=await openExchange(buyerUrl);await replay.getByRole('button',{name:'Fill approved fields'}).click();
 await replay.getByText(/The code expired, the approval changed, or the buyer page does not match/).waitFor();
 await replay.close();await buyer.close();
 passed('The bookmark filled an approved answer on the exact buyer URL without an extension or file transfer. A different page and a reused code were refused. Existing buyer text and unanswered questions were preserved, with no form submitted.');

 await checkpoint('import a buyer portal directly from pasted questions and recover the approved answer suggestion');
 await upload.goto(app+'/team/questionnaires'+query);
 await upload.getByRole('button',{name:'Import questionnaire',exact:true}).click();
 const paste=upload.getByRole('region',{name:'Import a questionnaire',exact:true});
 await paste.getByText('Start from questions copied from a buyer portal or email',{exact:true}).click();
 await paste.getByLabel('Questions, one per line',{exact:true}).fill(question+'\nHow is the fictional delivery verified?');
 await paste.getByLabel('Original buyer portal URL (optional)',{exact:true}).fill('https://buyer.example.invalid/private/one?invite=fixture');
 await paste.getByLabel('Questionnaire title',{exact:true}).fill('Pasted buyer portal');
 await paste.getByLabel('Buyer or recipient',{exact:true}).fill('Fictional buyer');
 await paste.getByLabel('Scope of the answers',{exact:true}).fill(scope);
 await paste.getByLabel('Question owner',{exact:true}).selectOption(editor.id);
 await paste.getByLabel('I checked the questions, recipient, product and scope.',{exact:true}).check();
 const pasted=await action(upload,'/api/workspace/questionnaires','POST',()=>paste.getByRole('button',{name:'Create questionnaire from 2 questions',exact:true}).click(),201);
 const savedPaste=await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:pasted.id}});
 const savedIntake=await db.auditEvent.findFirstOrThrow({where:{entityId:pasted.id,action:'customer_assurance.questionnaire_imported'}});
 assert.equal(savedIntake.details.portalDestination.origin,'https://buyer.example.invalid');
 assert.match(savedIntake.details.portalDestination.pageHash,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(savedIntake.details).includes('invite=fixture'));
 assert.deepEqual(savedPaste.questions.map(q=>q.status),['SUGGESTED','EMPTY']);
 passed('A buyer questionnaire was created from two pasted portal labels. The current approved answer was suggested for one and the unmatched row remained empty. The returned table preserved blank rows for spreadsheet entry.');
 // Drive the signed-in intake with the browser bridge contract. The installed Chrome test exercises the real extension boundary.
 const nonce=randomUUID(),captured={format:'regpilot-portal-fields-v1',origin:'https://buyer.example.invalid',pageHash:createHash('sha256').update('https://buyer.example.invalid/private/original').digest('hex'),fields:[question]};
 await checkpoint('receive buyer fields on the fresh review tab opened by the helper');
 const portalTab=await upload.context().newPage(),transfer=portalTab.getByRole('region',{name:'Import a questionnaire',exact:true});
 await portalTab.addInitScript(({nonce,captured,orgId})=>{
  if(location.hash!=='#portal-import='+nonce)return;
  Object.defineProperty(window.chrome??(window.chrome={}),'runtime',{configurable:true,value:{sendMessage:(_extension,m,reply)=>{
   if(m.nonce!==nonce||m.organizationId!==orgId)return reply({ok:false});
   if(m.action==='READ_IMPORT')return reply({ok:true,capture:captured});
   if(m.action==='IMPORT_SAVED'){sessionStorage.setItem('test-bound-questionnaire',m.questionnaireId);return reply({ok:true});}
   reply({ok:false});
  }}});
 },{nonce,captured,orgId:org.id});
 await portalTab.goto(app+'/team/questionnaires'+query+'#portal-import='+nonce);
 await transfer.getByRole('button',{name:'Use buyer questions in this workspace'}).click();
 await transfer.getByText('Captured 1 field label from '+captured.origin+'.',{exact:false}).waitFor();
 assert.equal(await transfer.getByLabel('Questions, one per line',{exact:true}).inputValue(),question);
 await transfer.getByLabel('Questionnaire title',{exact:true}).fill('Saved buyer portal');
 await transfer.getByLabel('Buyer or recipient',{exact:true}).fill('Fictional buyer');
 await transfer.getByLabel('Scope of the answers',{exact:true}).fill(scope);
 await transfer.getByLabel('Question owner',{exact:true}).selectOption(editor.id);
 await transfer.getByLabel('I checked the questions, recipient, product and scope.',{exact:true}).check();
 const single=await action(portalTab,'/api/workspace/questionnaires','POST',()=>transfer.getByRole('button',{name:'Create questionnaire from 1 question',exact:true}).click(),201);
 await portalTab.waitForFunction(id=>sessionStorage.getItem('test-bound-questionnaire')===id,single.id);
 await portalTab.close();
 const source=await db.auditEvent.findFirstOrThrow({where:{entityId:single.id,action:'customer_assurance.questionnaire_imported'}});
 assert.deepEqual(source.details.portalDestination,{origin:captured.origin,pageHash:captured.pageHash});
 passed('A buyer-tab capture created a private questionnaire directly, retained its destination and returned the new questionnaire identity to the helper.');
 await approve(single.id,'Q1');
 await packages.getByText('Complete a buyer’s online questionnaire',{exact:true}).click();
 await packages.getByRole('button',{name:'Use original buyer portal and saved questions',exact:true}).click();
 await packages.getByRole('checkbox',{name:question,exact:true}).check();
 await packages.getByRole('checkbox',{name:'I independently checked the destination, questions, product scope, answers and citations.',exact:true}).check();
 await packages.getByRole('button',{name:'Prepare answers for manual entry',exact:true}).click();
 const originalCopy=packages.getByRole('region',{name:'Approved answers for manual entry',exact:true}).getByRole('textbox',{name:question,exact:true});
 await originalCopy.waitFor();assert.equal(await originalCopy.inputValue(),answer);
 passed('The reviewer recovered the original buyer destination and question in one click and received the approved response without re-entering either.');
 const documentIds=[];
 for(const [format,filename,bytes,mimeType] of [['PDF','buyer-questions.pdf',await fixtureFillablePdf('1. '+question),'application/pdf'],['DOCX','buyer-questions.docx',fixtureDocx(paragraph('1. '+question)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]){
  await checkpoint('review exact '+format+' question source and import it through the mobile interface');await upload.goto(app+'/team/questionnaires'+query);await upload.getByRole('button',{name:'Import questionnaire',exact:true}).click();intake=upload.getByRole('region',{name:'Import a questionnaire',exact:true});await intake.getByLabel('Questionnaire file',{exact:true}).setInputFiles({name:filename,mimeType,buffer:bytes});const inspected=await action(upload,'/api/workspace/questionnaires/inspect','POST',()=>intake.getByRole('button',{name:'Inspect questionnaire file',exact:true}).click());assert.equal(inspected.version,'questionnaire-document-v1');assert.equal(inspected.canImport,true);assert.equal(inspected.candidates.length,1);const selection=intake.getByRole('region',{name:'Review document questions',exact:true});await selection.getByRole('checkbox',{name:'Select document question '+inspected.candidates[0].reference,exact:true}).check();await selection.getByLabel('Question reference 1',{exact:true}).fill('Q1');await selection.getByLabel('Questionnaire name',{exact:true}).fill('Fictional '+format+' response');await selection.getByLabel('Customer / recipient',{exact:true}).fill('Fictional customer');await selection.getByLabel('Response scope',{exact:true}).fill(scope);await selection.getByLabel('Initial question owner',{exact:true}).selectOption(editor.id);await selection.getByRole('checkbox',{name:'I checked every selected source passage, question wording, customer instructions, recipient and product scope.',exact:true}).check();await upload.screenshot({path:artifactDir+'/mobile-questionnaire-'+format.toLowerCase()+'-selection.png',fullPage:true});assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile document intake layout'));
  const imported=await action(upload,'/api/workspace/questionnaires/import','POST',()=>selection.getByRole('button',{name:'Import 1 reviewed document questions',exact:true}).click(),201),record=await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:imported.id}}),source=record.questions[0].source;assert.equal(source.format,format);assert.equal(source.unitKind,format==='PDF'?'page':'block');assert.equal(source.unit,1);assert.equal(source.quote,'1. '+question);assert.equal(inspected.units[0].text.slice(source.start,source.end),source.quote);documentIds.push(imported.id);
  const disclosure=await approve(imported.id,'Q1'),workbook=await download(disclosure.getByRole('button',{name:'Download approved XLSX',exact:true})),exported=await inspectQuestionnaireFile(workbook,'document-response.xlsx'),headers=exported.sheets[1].rows[0].cells,values=exported.sheets[1].rows[1].cells;assert.equal(values[headers.indexOf('Source quotation')],source.quote);assert.equal(values[headers.indexOf('Source unit kind')],source.unitKind);assert.equal(exported.sheets[0].rows[1].cells[2],answer);await writeFile(artifactDir+'/questionnaire-'+format.toLowerCase()+'-response.xlsx',workbook);
  if(format==='PDF'){
    await packages.getByText('Return answers in the original PDF',{exact:true}).click();
    await packages.getByLabel('Exact original PDF',{exact:true}).setInputFiles({name:filename,mimeType,buffer:bytes});
    await packages.getByRole('button',{name:'Inspect PDF fields',exact:true}).click();
    await packages.getByLabel('PDF answer field Q1',{exact:true}).selectOption('Buyer response');
    await packages.getByLabel('I checked the PDF fields against the questions and product scope.',{exact:true}).check();
    const returned=await download(packages.getByRole('button',{name:'Download completed original PDF',exact:true}));
    assert.deepEqual(await readPdfAnswerFields(returned),[{name:'Buyer response',value:answer}]);
    await writeFile(artifactDir+'/completed-original-questionnaire.pdf',returned);
  }
  if(format==='DOCX'){
    await packages.getByText('Return answers in the original DOCX',{exact:true}).click();
    await packages.getByLabel('Exact original DOCX',{exact:true}).setInputFiles({name:filename,mimeType,buffer:bytes});
    await packages.getByLabel('I checked the Word question locations and product scope.',{exact:true}).check();
    const returned=await download(packages.getByRole('button',{name:'Download completed original DOCX',exact:true}));
    const {parseDocx}=await import('../lib/server/docx-parser.mjs');
    assert.deepEqual((await parseDocx(returned)).pages.map(p=>p.text),[source.quote,answer]);
  }

 }
 passed('A real text PDF and DOCX were independently extracted by the application workers, explicitly selected and reviewed in the mobile UI, then persisted with exact page/block and character quotations. Independently approved response workbooks carried the original document provenance and current approved response. The approved answers were also returned in the buyer’s original PDF and Word documents.');
 return {xlsxQuestionnaireId:xlsx.id,documentQuestionnaireIds:documentIds,answerId:saved.id,originalWorkbookPreserved:true,evidenceManifestVerified:true,formats:['XLSX','PDF','DOCX'],paidCalls:0};
}
