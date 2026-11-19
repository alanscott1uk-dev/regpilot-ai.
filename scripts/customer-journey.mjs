// Full customer path inside the disposable private-services acceptance runner.
// Application requests are real. Explicitly fictional publication content and a
// controlled paused-check fault are inserted only into the isolated database;
// this does not test publisher delivery or an activated hosted scheduler.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {sourceTextHash} from '../lib/regulatory/source-fingerprint.mjs';
import {fixturePdf} from '../tests/helpers/pdf-fixture.mjs';

const company='Fictional quality team';
const sourceId='uk-data-protection';
const sourceTitle='Fictional widget training requirement — acceptance fixture';
const requirement='Fictional widget staff must complete documented training before working alone. Widget operators must retain completed training records for review.';
const trainingRecord='Widget staff completed documented training on 4 November 2026 with a supervisor.';
const reviewNotes='Independently checked the fictional requirement, original files, business scope, dated implementation record and remaining limitations.';

export async function createCustomerWorkspace({page,db,app,email,checkpoint,passed,artifactDir}){
 await checkpoint('first customer creates an organisation');
 await page.getByRole('heading',{name:'Create your organisation',exact:true}).waitFor();
 assert.equal(await db.membership.count(),0,'first-use acceptance begins without an application organisation or membership');
 await page.getByLabel('Company name',{exact:true}).fill(company);
 const [createdResponse]=await Promise.all([
  page.waitForResponse(response=>response.url()===app+'/api/ai/context'&&response.request().method()==='POST'),
  page.getByRole('button',{name:'Create workspace',exact:true}).click()
 ]);
 const created=await createdResponse.json();
 assert.equal(createdResponse.status(),200,created.error||'organisation creation failed');
 const org=await db.organization.findUniqueOrThrow({where:{id:created.organisation.id}});
 const reviewer=await db.user.findUniqueOrThrow({where:{email}});
 const membership=await db.membership.findUniqueOrThrow({where:{organizationId_userId:{organizationId:org.id,userId:reviewer.id}}});
 assert.equal(org.name,company);assert.equal(membership.role,'OWNER');
 await page.getByRole('heading',{name:'What does your organisation do?',exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('organizationId'),org.id);
 passed('A new verified email account created its first organisation through the application, with one persisted owner membership and an exact workspace URL.');

 await checkpoint('first customer saves business scope and source schedule');
 await page.getByRole('checkbox',{name:'Handling personal data',exact:true}).check();
 await page.getByRole('checkbox',{name:'Scotland',exact:true}).check();
 await page.getByLabel('Search publications',{exact:true}).fill('Data protection and your business');
 await page.getByRole('region',{name:'Publication choices',exact:true}).getByRole('checkbox',{name:'Data protection and your business',exact:true}).check();
 const save=page.getByRole('button',{name:'Save profile and schedules',exact:true});
 assert.equal(await save.isDisabled(),true,'review acknowledgement is required before saving');
 await page.getByRole('checkbox',{name:/I have reviewed this profile and source selection/}).check();
 const [savedResponse]=await Promise.all([
  page.waitForResponse(response=>response.url()===app+'/api/workspace/setup'&&response.request().method()==='POST'),
  save.click()
 ]);
 const saved=await savedResponse.json();assert.equal(savedResponse.status(),200,saved.error||'setup save failed');
 await page.getByRole('status').filter({hasText:'Setup saved.'}).waitFor();
 const profile=await db.businessProfile.findUniqueOrThrow({where:{organizationId:org.id}});
 assert.deepEqual(profile.activities,['personal-data']);assert.deepEqual(profile.jurisdictions,['Scotland']);
 const watch=await db.watchSchedule.findFirstOrThrow({where:{organizationId:org.id,sourceId}});
 assert.equal(watch.enabled,true);assert.equal(watch.intervalHours,24);assert.equal(watch.configuredById,reviewer.id);
 assert.equal(watch.lastSuccessAt,null,'saving a schedule must not pretend that a capture ran');
 await page.getByText('Background monitoring awaiting activation',{exact:true}).waitFor();
 await page.reload();
 await page.getByRole('checkbox',{name:'Handling personal data',exact:true}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Handling personal data',exact:true}).isChecked(),true);
 assert.equal(await page.getByRole('checkbox',{name:'Scotland',exact:true}).isChecked(),true);
 await page.screenshot({path:artifactDir+'/desktop-new-customer-setup.png',fullPage:true});
 passed('Business activities, UK scope and an explicitly reviewed source schedule were saved through the UI and survived reload; inactive monitoring remained clearly labelled.');

 await checkpoint('customer reconciles a failed source schedule without inventing collection');
 // Controlled failure input. Recovery uses the actual signed-in UI, HTTP route,
 // permission checks and database transaction, not intercepted application APIs.
 const faultAt=new Date();
 await db.watchSchedule.update({where:{id:watch.id},data:{enabled:false,attempts:3,failureCode:'FETCH_FAILED',lastOutcome:'FAILED',lastAttemptAt:faultAt,nextCheckAt:new Date(faultAt.getTime()-3600000)}});
 await db.auditEvent.create({data:{organizationId:org.id,actorId:reviewer.id,action:'monitoring.check_failed',entityType:'WatchSchedule',entityId:watch.id,details:{sourceId,outcome:'FAILED',failureCode:'FETCH_FAILED',attempt:3,paused:true,fixture:'Explicitly fictional paused-check fault for acceptance'}}});
 const capturesBefore=await db.regulatorySnapshot.count({where:{organizationId:org.id}});
 await page.goto(app+'/team/coverage?'+new URLSearchParams({organizationId:org.id}));
 await page.getByRole('region',{name:'Monitoring runtime',exact:true}).getByRole('heading',{name:'Monitoring awaits activation',exact:true}).waitFor();
 const publication=page.getByRole('article',{name:'Data protection and your business',exact:true});
 await publication.getByText('Collection failed',{exact:true}).waitFor();
 await publication.getByText('Last recorded issue: fetch failed.',{exact:true}).waitFor();
 const [retryResponse]=await Promise.all([
  page.waitForResponse(response=>response.url()===app+'/api/workspace/monitoring/retry'&&response.request().method()==='POST'),
  publication.getByRole('button',{name:'Request recovery',exact:true}).click()
 ]);
 const retry=await retryResponse.json();assert.equal(retryResponse.status(),200,retry.error||'monitoring recovery request failed');
 assert.equal(retry.monitoringConfigured,false,'requesting recovery does not activate an unconfigured worker');
 await publication.getByText(/Recovery requested — waiting for a completed check/).waitFor();
 const queued=await db.watchSchedule.findUniqueOrThrow({where:{id:watch.id}});
 assert.equal(queued.enabled,true);assert.equal(queued.version,watch.version+1);assert.equal(queued.failureCode,'FETCH_FAILED');
 assert.equal(queued.lastOutcome,'RECOVERY_QUEUED');assert.equal(queued.lastSuccessAt,null,'a queued retry cannot invent a successful collection');
 assert.equal(await db.regulatorySnapshot.count({where:{organizationId:org.id}}),capturesBefore);
 const retryEvents=()=>db.auditEvent.count({where:{organizationId:org.id,entityId:watch.id,action:'monitoring.retry_requested'}});
 assert.equal(await retryEvents(),1);
 await page.getByRole('button',{name:'Refresh monitoring status',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Latest saved monitoring status loaded.'}).waitFor();
 assert.equal(await retryEvents(),1,'reading saved status must not enqueue another recovery');
 assert.equal(await publication.getByRole('button',{name:'Request recovery',exact:true}).count(),0,'the queued attempt cannot be submitted again');
 await page.reload();
 await publication.getByText(/Recovery requested — waiting for a completed check/).waitFor();
 await publication.getByText('Last recorded issue: fetch failed.',{exact:true}).waitFor();
 await page.screenshot({path:artifactDir+'/desktop-customer-monitoring-recovery.png',fullPage:true});
 passed('The customer requested recovery of an explicitly injected paused-source fault through real authenticated application endpoints. One retry was persisted, prior failure remained visible after refresh/reload, no snapshot or successful check was invented, and inactive runtime stayed explicit.');
 return {org,reviewer};
}

export async function sourceToReportJourney({upload,review,db,app,org,editor,reviewer,submitEvidence,checkpoint,passed,bounded,artifactDir}){
 const progressStages=[];
 async function openTaskProgress(page,taskId,expectedStage){
  const [response]=await Promise.all([
   page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/workspace/work'&&url.searchParams.get('organizationId')===org.id&&url.searchParams.get('taskId')===taskId&&response.request().method()==='GET';}),
   page.goto(app+'/team/work?'+new URLSearchParams({organizationId:org.id,taskId}))
  ]);
  const body=await bounded(response.json(),'Authoritative task progress response');
  assert.equal(response.status(),200,body.error||'task progress unavailable');
  assert.equal(body.organizationId,org.id);assert.equal(body.task.id,taskId);
  assert.equal(body.workflow.stage,expectedStage);
  const progress=page.getByRole('dialog').getByRole('region',{name:'Task progress',exact:true});
  await progress.getByRole('heading',{name:body.workflow.title,exact:true}).waitFor();
  progressStages.push(expectedStage);
  return {body,progress};
 }
 await checkpoint('fictional source fixture for connected customer journey');
 const snapshot=await db.regulatorySnapshot.create({data:{organizationId:org.id,sourceId,title:sourceTitle,
  url:'https://www.gov.uk/data-protection-your-business',bodyText:requirement,contentHash:sourceTextHash(requirement),
  capturedById:editor.id,reviewStatus:'NEEDS_REVIEW',addedSnippets:[requirement],removedSnippets:[]}});
 // Fault-controlled input is labelled in the UI and report. No source API or
 // signed-in application endpoint is intercepted or substituted in this test.
 await review.goto(app+'/team/sources?'+new URLSearchParams({organizationId:org.id,sourceId}));
 await review.getByLabel('Review notes',{exact:true}).fill(reviewNotes);
 const [sourceReviewResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===app+'/api/workspace/sources/'+snapshot.id&&response.request().method()==='PATCH'),
  review.getByRole('button',{name:'Save human review',exact:true}).click()
 ]);
 const sourceReviewBody=await sourceReviewResponse.json();assert.equal(sourceReviewResponse.status(),200,sourceReviewBody.error||'independent source review failed');
 await review.getByText(/Human source review recorded/).waitFor();
 const reviewedSource=await db.regulatorySnapshot.findUniqueOrThrow({where:{id:snapshot.id}});
 assert.equal(reviewedSource.reviewStatus,'REVIEWED');assert.equal(reviewedSource.reviewerId,reviewer.id);assert.equal(reviewedSource.capturedById,editor.id);
 const applicableLink=review.getByRole('link',{name:/Assess business applicability/});
 const applicableUrl=new URL(await applicableLink.getAttribute('href'),app);
 assert.equal(applicableUrl.searchParams.get('organizationId'),org.id,'source handoff retains the active organisation');
 await applicableLink.click();
 await review.getByRole('heading',{name:'Turn a publication into review work',exact:true}).waitFor();

 await checkpoint('editor prepares actual rule analysis');
 await upload.goto(app+'/team/intelligence?'+new URLSearchParams({organizationId:org.id}));
 const [analysisResponse]=await Promise.all([
  upload.waitForResponse(response=>response.url()===app+'/api/workspace/intelligence'&&response.request().method()==='POST'),
  upload.getByRole('button',{name:'Rule analysis ↗',exact:true}).click()
 ]);
 const analysed=await bounded(analysisResponse.json(),'Rule analysis response');
 assert.equal(analysisResponse.status(),201,analysed.error||'rule analysis failed');
 const run=await db.intelligenceRun.findUniqueOrThrow({where:{id:analysed.id}});
 assert.equal(run.createdById,editor.id);assert.equal(run.snapshotId,snapshot.id);
 assert.ok(run.result.candidates.length>0,'the actual rule engine must produce grounded candidate work');
 assert.equal(await upload.getByRole('button',{name:'Accept and create task',exact:true}).count(),0,'an editor cannot approve its own analysis');

 await checkpoint('owner accepts applicability and assigns a linked task');
 await review.reload();
 await review.getByRole('heading',{name:'Your review decision',exact:true}).waitFor();
 const title='Demonstrate fictional widget staff training';
 await review.getByLabel('Explain applicability, conditions and your decision',{exact:true}).fill(reviewNotes);
 await review.getByLabel('Follow-up task title',{exact:true}).fill(title);
 await review.getByLabel('Owner',{exact:true}).selectOption(editor.id);
 await review.getByLabel('Task target date',{exact:true}).fill(new Date(Date.now()+3*86400000).toISOString().slice(0,10));
 const decisionEndpoint=app+'/api/workspace/intelligence/'+run.id;
 const [decisionResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===decisionEndpoint&&response.request().method()==='POST'),
  review.getByRole('button',{name:'Accept and create task',exact:true}).click()
 ]);
 const decision=await bounded(decisionResponse.json(),'Applicability decision response');
 assert.equal(decisionResponse.status(),200,decision.error||'applicability decision failed');
 const accepted=await db.intelligenceDecision.findUniqueOrThrow({where:{id:decision.decision.id}});
 const task=await db.obligation.findUniqueOrThrow({where:{id:accepted.obligationId}});
 assert.equal(task.organizationId,org.id);assert.equal(task.assigneeId,editor.id);assert.equal(task.ownerName,editor.email);
 assert.equal(task.originKey,accepted.candidateKey);assert.equal(accepted.reviewerId,reviewer.id);
 // The POST is persisted before the client has reconciled its follow-up GET.
 // Wait for the saved decision UI before switching to another candidate.
 await review.getByRole('status').filter({hasText:'Review saved and one linked task created in your team queue.'}).waitFor();
 await review.getByRole('link',{name:'Open task',exact:true}).waitFor();
 await checkpoint('independent dismissal without an owner or task');
 const beforeDismiss=await db.obligation.count({where:{organizationId:org.id}});
 await review.getByRole('combobox',{name:/^Show/}).selectOption('pending');
 await review.getByRole('heading',{name:'Your review decision',exact:true}).waitFor();
 assert.equal(await review.getByLabel('Owner',{exact:true}).inputValue(),'');
 await review.getByLabel('Explain applicability, conditions and your decision',{exact:true}).fill('The second fictional candidate is not a separate work item for this scoped training exercise; its treatment is recorded explicitly.');
 const [dismissalResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===decisionEndpoint&&response.request().method()==='POST'),
  review.getByRole('button',{name:'Dismiss with rationale',exact:true}).click()
 ]);
 const dismissed=await bounded(dismissalResponse.json(),'Dismissed recommendation response');
 assert.equal(dismissalResponse.status(),200,dismissed.error||'dismissal without owner failed');
 assert.equal(dismissed.decision.decision,'DISMISSED');assert.equal(dismissed.decision.obligationId,null);
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),beforeDismiss,'dismissal records a decision without creating unowned work');
 await review.getByRole('combobox',{name:/^Show/}).selectOption('accepted');
 passed('A second source candidate was dismissed with a recorded rationale and no owner requirement, task or empty-ID error.');
 const taskLink=review.getByRole('link',{name:'Open task',exact:true});
 await taskLink.waitFor();const taskUrl=new URL(await taskLink.getAttribute('href'),app);
 assert.equal(taskUrl.pathname,'/team/work');assert.equal(taskUrl.searchParams.get('organizationId'),org.id);assert.equal(taskUrl.searchParams.get('taskId'),task.id);
 await taskLink.click();
 await review.getByRole('dialog').getByRole('heading',{name:title,exact:true}).waitFor();
 await review.getByRole('dialog').getByRole('region',{name:'Task completion',exact:true}).getByRole('heading',{name:'Before you can finish',exact:true}).waitFor();
 passed('A real rule analysis and independent applicability decision created one source-linked task with a current member assignee; the exact task handoff retained source and organisation.');
 await openTaskProgress(upload,task.id,'EVIDENCE_REQUIRED');

 await checkpoint('source task gets scanned independently reviewed evidence');
 const params=new URLSearchParams({organizationId:org.id,taskId:task.id}),vault=app+'/team/evidence?'+params;
 const file=fixturePdf([['FICTIONAL WIDGET TRAINING RECORD',trainingRecord],['Retention review completed for widget staff training records.']]);
 await upload.goto(vault);
 const stored=await submitEvidence(upload,'widget-training.pdf',file,201);
 assert.equal(stored.evidence.obligationId,task.id);
 await review.goto(vault);
 await review.getByLabel('Independent review rationale',{exact:true}).fill(reviewNotes);
 await review.getByRole('button',{name:'Approve evidence',exact:true}).click();
 await review.getByText('APPROVED',{exact:true}).waitFor();
 const evidence=await db.evidence.findUniqueOrThrow({where:{id:stored.evidence.id}});
 assert.equal(evidence.reviewerId,reviewer.id);assert.equal(evidence.uploadedById,editor.id);assert.equal(evidence.sha256,createHash('sha256').update(file).digest('hex'));
 const preparing=await openTaskProgress(upload,task.id,'ASSESSMENT_REQUIRED');
 const nextAssessment=new URL(preparing.body.workflow.href,app);
 assert.equal(nextAssessment.pathname,'/team/assurance');assert.equal(nextAssessment.searchParams.get('organizationId'),org.id);assert.equal(nextAssessment.searchParams.get('taskId'),task.id);
 await preparing.progress.getByRole('link',{name:preparing.body.workflow.label,exact:false}).click();

 await checkpoint('editor extracts actual private evidence passages');
 await upload.getByRole('checkbox',{name:/widget-training\.pdf/}).check();
 await upload.getByRole('checkbox',{name:/I agree to process these fictional or non-sensitive files/}).check();
 const [preparedResponse]=await Promise.all([
  upload.waitForResponse(response=>response.url()===app+'/api/workspace/assurance'&&response.request().method()==='POST'),
  upload.getByRole('button',{name:'Find evidence passages',exact:true}).click()
 ]);
 const prepared=await bounded(preparedResponse.json(),'Actual content search response');
 assert.equal(preparedResponse.status(),201,prepared.error||'private evidence content search failed');
 const draft=await db.assuranceAssessment.findUniqueOrThrow({where:{id:prepared.id}});
 assert.equal(draft.method,'CONTENT_SEARCH');assert.equal(draft.createdById,editor.id);assert.equal(draft.status,'DRAFT');
 assert.equal(draft.snapshotId,snapshot.id);assert.equal(draft.obligationId,task.id);
 assert.ok(draft.result.passages.some(p=>p.quote.includes(trainingRecord)),'actual PDF extraction must retain the dated training record');
 assert.equal(await upload.getByRole('button',{name:'Record evidence adequate for this task',exact:true}).count(),0);

 await checkpoint('independent source-scoped assessment and original verification');
 const pending=await openTaskProgress(review,task.id,'ASSESSMENT_REVIEW');
 assert.equal(pending.body.workflow.assessmentId,draft.id);
 await review.getByRole('button',{name:'Close task details',exact:true}).click();
 await review.getByRole('button',{name:/Reviews to finish/}).click();
 const pendingTask=review.getByRole('article').filter({hasText:title});
 const pendingLink=pendingTask.getByRole('link',{name:pending.body.workflow.label,exact:false});
 await pendingLink.waitFor();
 const pendingHref=new URL(await pendingLink.getAttribute('href'),app);
 assert.equal(pendingHref.pathname,'/team/assurance');assert.equal(pendingHref.searchParams.get('organizationId'),org.id);
 assert.equal(pendingHref.searchParams.get('taskId'),task.id);assert.equal(pendingHref.searchParams.get('assessmentId'),draft.id);
 await review.screenshot({path:artifactDir+'/desktop-pending-content-review.png',fullPage:true});
 await pendingLink.click();
 assert.equal(new URL(review.url()).searchParams.get('assessmentId'),draft.id,'the review queue opens the exact saved assessment');
 const passage=review.getByRole('article').filter({hasText:trainingRecord}).filter({has:review.getByRole('button',{name:'Original document ↗',exact:true})}).first();
 // Read the actual private original before confirming the evidence decision.
 const originalReady=review.waitForEvent('download');
 await passage.getByRole('button',{name:'Original document ↗',exact:true}).click();
 const original=await originalReady;
 assert.deepEqual(await readFile(await bounded(original.path(),'Source-task original download')),file);
 await passage.getByLabel('Use this passage in my evidence decision',{exact:true}).check();
 await review.getByLabel('Explain what is demonstrated, the scope, dates and remaining limitations',{exact:true}).fill(reviewNotes);
 await review.getByLabel('Review this evidence again by',{exact:true}).fill(new Date(Date.now()+30*86400000).toISOString().slice(0,10));
 const confirm=review.getByRole('button',{name:'Record evidence adequate for this task',exact:true});
 assert.equal(await confirm.isDisabled(),true,'a rationale and passage do not imply confirmation of scope or originals');
 await review.getByLabel('I checked the full requirement, its conditions and exceptions, and the business scope covered by these files.',{exact:true}).check();
 await review.getByLabel('I inspected the original documents, including dates, signatures, tables and evidence of implementation.',{exact:true}).check();
 const [assessmentResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===app+'/api/workspace/assurance/'+draft.id&&response.request().method()==='PATCH'),
  confirm.click()
 ]);
 const reviewed=await bounded(assessmentResponse.json(),'Independent scoped assessment response');
 assert.equal(assessmentResponse.status(),200,reviewed.error||'independent assessment failed');
 await review.getByText('Evidence accepted for this task',{exact:true}).first().waitFor();
 const assessment=await db.assuranceAssessment.findUniqueOrThrow({where:{id:draft.id}});
 assert.equal(assessment.status,'ACCEPTED');assert.equal(assessment.reviewerId,reviewer.id);assert.ok(assessment.selectedPassages.length);
 await review.screenshot({path:artifactDir+'/desktop-source-evidence-decision.png',fullPage:true});
 passed('The source-linked task used scanned private PDF bytes, independent file review, actual document extraction and an explicit independent assessment of original passages and business scope.');

 await checkpoint('complete source-linked task with frozen traceability');
 await openTaskProgress(review,task.id,'READY_TO_COMPLETE');
 const completion=review.getByRole('dialog').getByRole('region',{name:'Task completion',exact:true});
 await completion.getByRole('heading',{name:'Ready to complete',exact:true}).waitFor();
 await completion.getByLabel('What was completed?',{exact:true}).fill('Completed the fictional widget staff training review using the independently accepted source-scoped training record.');
 await completion.getByLabel('I have checked the selected evidence and confirm this work is complete.',{exact:true}).check();
 const [completionResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===app+'/api/workspace/work/'+task.id+'/completion'&&response.request().method()==='POST'),
  completion.getByRole('button',{name:'Complete with verified evidence',exact:true}).click()
 ]);
 const completed=await bounded(completionResponse.json(),'Source-linked completion response');
 assert.equal(completionResponse.status(),200,completed.error||'source-linked completion failed');
 await completion.getByRole('heading',{name:'Task completed',exact:true}).waitFor();
 const saved=await db.auditEvent.findUniqueOrThrow({where:{id:completed.eventId}}),receipt=saved.details.receipt;
 assert.equal(saved.organizationId,org.id);assert.equal(saved.entityId,task.id);assert.equal(saved.actorId,reviewer.id);
 assert.equal(receipt.source.id,snapshot.id);assert.equal(receipt.source.contentHash,snapshot.contentHash);
 assert.equal(receipt.assessment.id,assessment.id);assert.equal(receipt.assessment.version,assessment.version);
 assert.equal(receipt.task.assigneeId,editor.id);assert.equal(receipt.evidence[0].id,evidence.id);assert.equal(receipt.evidence[0].sha256,evidence.sha256);
 const completedTask=await db.obligation.findUniqueOrThrow({where:{id:task.id}});
 assert.equal(completedTask.status,'COMPLETE');assert.equal(completedTask.completionException,false);
 await openTaskProgress(review,task.id,'COMPLETED');
 passed('The task’s saved progress advanced from evidence needed to assessment preparation, independent assessment review and explicit completion. A file approval did not hide its draft content assessment: the review queue opened the exact company, task and assessment until that decision was recorded.');
 passed('Explicit task completion froze the exact source version, independent assessment, assigned owner and verified evidence in one persisted receipt.');

 await checkpoint('customer exports scoped operational report');
 await review.getByRole('button',{name:'Close task details',exact:true}).click();
 await review.getByRole('link',{name:'Reports',exact:true}).click();
 assert.equal(new URL(review.url()).searchParams.get('organizationId'),org.id,'Reports navigation retains the active workspace');
 const completedRow=review.getByRole('article').filter({hasText:title});
 await completedRow.waitFor();
 const reportReady=review.waitForEvent('download');
 await review.getByRole('button',{name:'Download report JSON',exact:true}).click();
 const reportDownload=await reportReady;
 const report=JSON.parse(await readFile(await bounded(reportDownload.path(),'Customer report JSON download'),'utf8'));
 assert.equal(report.organizationId,org.id);
 const completionInReport=report.completedWork.find(row=>row.taskId===task.id);
 assert.ok(completionInReport,'source-linked completed work is included in the actual customer report');
 assert.equal(completionInReport.eventId,saved.id);assert.equal(completionInReport.proofHash,saved.details.proofHash);
 assert.deepEqual(completionInReport.receipt,receipt,'customer report must reproduce the persisted completion decision exactly');
 const sourceCollection=report.collections.find(row=>row.sourceId===sourceId);
 assert.ok(sourceCollection,'report retains the unresolved monitoring incident');
 assert.equal(sourceCollection.status,'failed');assert.equal(sourceCollection.failureCode,'FETCH_FAILED');
 assert.equal(sourceCollection.monitoringConfigured,false,'report distinguishes a queued schedule from running monitoring');
 assert.equal(sourceCollection.recoveryPending,true,'report preserves the queued recovery without inventing success');
 for(const row of [...report.changes,...report.pending,...report.collections,...report.connectors,...report.tasks,...report.completedWork]){
  assert.equal(new URL(row.href,app).searchParams.get('organizationId'),org.id,'all report handoffs retain the exact organisation');
 }
 assert.equal(JSON.stringify(report).includes(evidence.storageKey),false,'customer exports never disclose private storage object keys');
 const csvReady=review.waitForEvent('download');
 await review.getByRole('button',{name:'Download briefing CSV',exact:true}).click();
 const csvDownload=await csvReady,csv=await readFile(await bounded(csvDownload.path(),'Customer report CSV download'),'utf8');
 assert.ok(csv.includes(title));assert.ok(csv.includes(saved.id));assert.ok(csv.includes(saved.details.proofHash));
 await writeFile(artifactDir+'/customer-report.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(artifactDir+'/customer-report.csv',csv);
 await review.screenshot({path:artifactDir+'/desktop-customer-report.png',fullPage:true});
 await review.emulateMedia({media:'print'});
 await review.pdf({path:artifactDir+'/customer-report.pdf',format:'A4',printBackground:true});
 await review.emulateMedia({media:'screen'});
 await upload.goto(app+'/team/briefing?'+new URLSearchParams({organizationId:org.id}));
 await upload.getByRole('article').filter({hasText:title}).waitFor();
 assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile customer report layout'));
 await upload.screenshot({path:artifactDir+'/mobile-customer-report.png',fullPage:true});
 passed('The customer followed Reports navigation and downloaded JSON, CSV and a printable report containing the exact persisted source-to-task-to-evidence decision, current open work and the unresolved source failure with queued recovery and inactive monitoring; the same report fit mobile.');
 return {taskId:task.id,snapshotId:snapshot.id,assessmentId:assessment.id,eventId:saved.id,progressStages};
}
