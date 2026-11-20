// Actual application requests, email-authenticated desktop/mobile contexts, private
// object storage and database. The company, workbook and evidence are fictional.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fixtureWorkbook,inlineCell,sheetRow} from '../tests/helpers/questionnaire-workbook-fixture.mjs';
import {inspectQuestionnaireFile} from '../lib/server/questionnaire-workbook.mjs';

export async function questionnaireCustomerJourney({upload,review,db,app,org,editor,reviewer,evidenceId,checkpoint,passed,bounded,artifactDir}){
 const question='How are fictional cold-chain training records retained?',title='Fictional customer assurance response',scope='Fictional quality team',filename='customer-questions.xlsx';
 // This isolated fixture grants the already authenticated colleague administration
 // responsibility for questionnaire creation. Independent review stays with the
 // original owner, who did not create the questionnaire or upload the evidence.
 await db.membership.update({where:{organizationId_userId:{organizationId:org.id,userId:editor.id}},data:{role:'ADMIN'}});
 const file=await db.evidence.findUniqueOrThrow({where:{id:evidenceId}}),query='?'+new URLSearchParams({organizationId:org.id});
 const match=(path,method)=>response=>new URL(response.url()).pathname===path&&response.request().method()===method;
 async function action(page,path,method,fn,status=200){const [response]=await Promise.all([page.waitForResponse(match(path,method)),fn()]);const body=await bounded(response.json(),'Questionnaire response '+path);assert.equal(response.status(),status,body.error||path);return body;}
 const table=sheetRow(1,[inlineCell('A1','Reference'),inlineCell('B1','Question'),inlineCell('C1','Instructions')])+[2,3].map((row,i)=>sheetRow(row,[inlineCell('A'+row,'Q'+(i+1)),inlineCell('B'+row,question),inlineCell('C'+row,'Describe only what the supplied fictional training record establishes; state limitations.')])).join('');
 const workbook=fixtureWorkbook([{name:'Security',xml:table}]);
 await checkpoint('customer imports a real XLSX questionnaire with mapped instructions');
 await upload.goto(app+'/team/questionnaires'+query);
 await upload.getByRole('button',{name:'Import questionnaire',exact:true}).click();
 const intake=upload.getByRole('region',{name:'Import a questionnaire',exact:true});
 await intake.getByLabel('Questionnaire file',{exact:true}).setInputFiles({name:filename,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook});
 const inspected=await action(upload,'/api/workspace/questionnaires/inspect','POST',()=>intake.getByRole('button',{name:'Inspect questionnaire file',exact:true}).click());assert.equal(inspected.format,'XLSX');assert.equal(inspected.sheets.length,1);
 await intake.getByText('Include instructions or context columns · Security',{exact:true}).click();
 await intake.getByRole('checkbox',{name:'C · Instructions',exact:true}).check();
 await intake.getByLabel('Questionnaire name',{exact:true}).fill(title);await intake.getByLabel('Prepared for',{exact:true}).fill('Fictional customer');await intake.getByLabel('Response scope',{exact:true}).fill(scope);await intake.getByLabel('Initial question owner',{exact:true}).selectOption(editor.id);
 await intake.getByRole('checkbox',{name:'I checked the selected questions, customer context, recipient and response scope.',exact:true}).check();
 const imported=await action(upload,'/api/workspace/questionnaires/import','POST',()=>intake.getByRole('button',{name:'Import 2 questions',exact:true}).click(),201);
 const row=await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:imported.id}}),questions=row.questions;assert.equal(row.createdById,editor.id);assert.equal(questions.length,2);assert.equal(questions[0].source.row,2);assert.equal(questions[1].source.row,3);assert.match(questions[0].instructions,/state limitations/);assert.equal(questions[0].status,'EMPTY');
 const recordPath=app+'/team/questionnaires'+query+'&questionnaireId='+row.id,endpoint='/api/workspace/questionnaires/'+row.id;
 await upload.getByRole('button',{name:'Open question Q1',exact:true}).click();
 await upload.screenshot({path:artifactDir+'/mobile-questionnaire-import.png',fullPage:true});
 passed('A real XLSX upload was inspected, mapped and imported through the authenticated mobile interface. Selected questions retained original sheet/row coordinates and customer instructions, with no invented approved answer.');

 await checkpoint('question owner prepares a source-quoted response from actual private evidence');
 await upload.getByRole('button',{name:'Prepare a new response from evidence',exact:true}).click();
 const preparation=upload.getByRole('region',{name:'Evidence-backed response preparation',exact:true});
 await preparation.getByRole('checkbox',{name:file.filename,exact:true}).check();await preparation.getByRole('checkbox',{name:'I have selected the relevant documents and agree to process them and save quoted support for this response.',exact:true}).check();
 const prepared=await action(upload,endpoint+'/drafts','POST',()=>preparation.getByRole('button',{name:'Find supporting passages',exact:true}).click());
 const run=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:prepared.id}});assert.equal(run.status,'DRAFT');assert.equal(run.method,'CONTENT_SEARCH');assert.equal(run.result.answer,'');assert.ok(run.result.citations.some(c=>c.evidenceId===evidenceId&&/cold-chain training/.test(c.quote)));assert.equal(await preparation.getByRole('button',{name:'Draft with AI',exact:true}).isDisabled(),true);
 const answer='The supplied fictional cold-chain training record is retained for independent review. It does not establish a wider retention schedule or additional completed controls.';
 await preparation.getByLabel('Response draft',{exact:true}).fill(answer);await preparation.getByRole('checkbox',{name:'I checked the response against the quoted support, resolved its gaps and stated any limitations.',exact:true}).check();
 const saved=await action(upload,endpoint+'/drafts/'+run.id,'PATCH',()=>preparation.getByRole('button',{name:'Save answer for independent review',exact:true}).click());
 const savedAnswer=await db.assuranceAnswer.findUniqueOrThrow({where:{id:saved.answerId}});assert.equal(savedAnswer.status,'DRAFT');assert.equal(savedAnswer.createdById,editor.id);assert.equal(savedAnswer.answer,answer);assert.equal((await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:row.id}})).questions[0].status,'EMPTY');
 const answerLink=preparation.getByRole('link',{name:'Open this answer for independent review →',exact:true});await answerLink.waitFor();const answerUrl=new URL(await answerLink.getAttribute('href'),app);assert.equal(answerUrl.searchParams.get('answerId'),saved.answerId);assert.equal(answerUrl.searchParams.get('questionnaireId'),row.id);assert.equal(answerUrl.searchParams.get('questionId'),questions[0].id);
 await preparation.screenshot({path:artifactDir+'/mobile-evidence-response.png'});
 passed('The owner searched actual approved private PDF bytes and inspected exact supporting quotations. A manually composed, explicitly limited response was saved once as a reusable DRAFT, linked to its preparation; the questionnaire remained unconfirmed and paid AI remained inactive.');

 await checkpoint('independent reviewer approves the exact generated-library answer and owner confirms its use');
 await review.goto(answerUrl.href);
 await review.getByLabel('Independent review of wording, scope and evidence',{exact:true}).fill('Independently checked the exact response, its fictional customer scope, the private training record and the stated limits before authorising reuse.');
 await review.getByRole('checkbox',{name:'I independently checked the complete answer, its scope, limitations and current supporting evidence.',exact:true}).check();
 await action(review,'/api/workspace/answers/'+saved.answerId,'PATCH',()=>review.getByRole('button',{name:'Approve for reuse',exact:true}).click());
 assert.equal((await db.assuranceAnswer.findUniqueOrThrow({where:{id:saved.answerId}})).reviewerId,reviewer.id);
 await upload.goto(recordPath+'&questionId='+questions[0].id);await upload.getByLabel('Approved response for Q1',{exact:true}).selectOption(saved.answerId);
 const confirm='I checked the complete response, customer instructions, scope and evidence. This answer addresses this question.';
 await upload.getByRole('checkbox',{name:confirm,exact:true}).check();await action(upload,endpoint,'PATCH',()=>upload.getByRole('button',{name:'Confirm this response',exact:true}).click());
 assert.equal((await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:row.id}})).questions[0].status,'READY');
 passed('A different administrator opened the exact saved answer from its company/question link and approved it. The assigned owner then separately confirmed the response against the first customer question and its instructions.');

 await checkpoint('batch answer reuse survives an interrupted acknowledgement without repeating a write');
 await upload.getByRole('button',{name:'Select unfinished questions',exact:true}).click();
 await upload.getByRole('button',{name:'Preview 1 answer suggestions',exact:true}).click();
 const preview=upload.getByRole('region',{name:'Answer suggestion preview',exact:true});
 await preview.getByLabel('Suggested answer for Q2',{exact:true}).selectOption(saved.answerId);await preview.getByRole('checkbox',{name:'I reviewed the selected response wording, scope, evidence and any conflicting alternatives.',exact:true}).check();
 let intercepted=0,suggestionRequest;const pattern='**'+endpoint+'/automation?*';
 await upload.route(pattern,async route=>{if(route.request().method()!=='POST'){await route.continue();return;}intercepted++;suggestionRequest=route.request().postDataJSON();const actual=await route.fetch();assert.equal(actual.status(),200);await route.abort('failed');},{times:1});
 await preview.getByRole('button',{name:'Save 1 selected suggestions',exact:true}).click();
 const uncertain=upload.getByRole('region',{name:'Unconfirmed saved result',exact:true});await uncertain.waitFor();await uncertain.getByRole('button',{name:'Check saved result',exact:true}).click();await uncertain.waitFor({state:'hidden'});assert.equal(intercepted,1);assert.ok(suggestionRequest.requestKey);
 const suggested=(await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:row.id}})).questions[1];assert.equal(suggested.status,'SUGGESTED');assert.equal(suggested.answerId,saved.answerId);
 await upload.getByRole('button',{name:'Open question Q2',exact:true}).click();await upload.getByRole('checkbox',{name:confirm,exact:true}).check();await action(upload,endpoint,'PATCH',()=>upload.getByRole('button',{name:'Confirm this response',exact:true}).click());
 passed('The administrator previewed complete answer wording and applied one reusable response. A deliberately lost acknowledgement recovered the exact saved operation by GET without repeating it; the second owner confirmation remained a separate action.');

 await checkpoint('independent disclosure approval exports a real current XLSX response pack');
 await review.goto(recordPath);const disclosure=review.getByRole('region',{name:'Disclosure review and export',exact:true});
 await disclosure.getByLabel('Independent disclosure review',{exact:true}).fill('Independently reviewed both exact responses, selected file references, fictional customer identity, source instructions and scope before approving this disclosure.');await disclosure.getByRole('checkbox',{name:'I independently reviewed these exact responses, evidence references, recipient and scope.',exact:true}).check();
 await action(review,endpoint,'PATCH',()=>disclosure.getByRole('button',{name:'Approve customer disclosure',exact:true}).click());
 const downloadReady=review.waitForEvent('download');await disclosure.getByRole('button',{name:'Download approved XLSX',exact:true}).click();const downloaded=await downloadReady,bytes=await readFile(await bounded(downloaded.path(),'Approved questionnaire workbook download'));
 const pack=await inspectQuestionnaireFile(bytes,'approved-response.xlsx');assert.ok(pack.sheets.some(s=>s.name==='Responses'));assert.ok(pack.sheets.some(s=>s.name==='Provenance'));
 const cells=pack.sheets.flatMap(s=>s.rows.flatMap(r=>r.cells));assert.ok(cells.includes(answer));assert.ok(cells.includes('Q1')&&cells.includes('Q2'));assert.ok(cells.some(c=>c.includes(file.filename)));assert.equal(cells.some(c=>c.includes(file.storageKey)),false);assert.equal((await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:row.id}})).reviewerId,reviewer.id);
 await writeFile(artifactDir+'/customer-questionnaire-response.xlsx',bytes);await review.screenshot({path:artifactDir+'/desktop-questionnaire-approved.png',fullPage:true});await upload.goto(recordPath);await upload.getByRole('region',{name:'Disclosure review and export',exact:true}).waitFor();assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile questionnaire layout'));await upload.screenshot({path:artifactDir+'/mobile-questionnaire-approved.png',fullPage:true});
 passed('Independent disclosure approval produced a real values-only XLSX response/provenance pack, reparsed from the downloaded bytes. The pack retained both ordered answers, evidence filenames and source provenance without storage keys; desktop and mobile displayed the same saved disclosure.');
 return {questionnaireId:row.id,questionIds:questions.map(q=>q.id),draftRunId:run.id,answerId:saved.answerId,evidenceId,method:'CONTENT_SEARCH',independentReviewerId:reviewer.id,interruptedWriteRecovered:true,format:'XLSX'};
}
