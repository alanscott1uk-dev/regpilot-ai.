// Real authenticated HTTP and database operations in the disposable private runner.
// Templates are operational starting points, and fictional work is labelled as such.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export async function starterProgrammeCustomerJourney({review,upload,db,app,org,editor,reviewer,checkpoint,passed,bounded,artifactDir}){
 await checkpoint('customer tailors and explicitly creates a starter programme');
 const endpoint=app+'/api/workspace/programmes';
 const [listResponse]=await Promise.all([
  review.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/programmes'&&response.request().method()==='GET'),
  review.goto(app+'/team/programmes?'+new URLSearchParams({organizationId:org.id}))
 ]);
 const list=await bounded(listResponse.json(),'Starter programme choices');assert.equal(listResponse.status(),200,list.error||'starter choices unavailable');
 assert.equal(list.organizationId,org.id);assert.equal(list.canCreate,true);assert.equal(list.programmesLimited,false);
 const pack=list.packs.find(pack=>pack.id==='business-foundations');assert.ok(pack);assert.equal(pack.items.length,6);
 const before={tasks:await db.obligation.count({where:{organizationId:org.id}}),events:await db.auditEvent.count({where:{organizationId:org.id,action:'starter_programme.created'}}),evidence:await db.evidence.count({where:{organizationId:org.id}})};
 await review.getByRole('button',{name:'Choose '+pack.title,exact:true}).click();
 await review.getByLabel('Programme name',{exact:true}).fill('Fictional quality team starting programme');
 await review.getByLabel('Why this programme fits',{exact:true}).fill('This fictional quality team needs an agreed business scope and reviewed publication choices. Other working arrangements will be considered separately rather than assumed to apply.');
 for(const item of pack.items.slice(2))await review.getByRole('checkbox',{name:'Include '+item.title,exact:true}).uncheck();
 const title='Confirm fictional starter responsibilities';
 await review.getByLabel('Task title 1',{exact:true}).fill(title);
 await review.getByLabel('Why this task applies 1',{exact:true}).fill('The fictional team needs a clear record of its activities and decision responsibilities before it assigns further operational work.');
 await review.getByLabel('Assign selected tasks to',{exact:true}).selectOption(editor.id);
 await review.getByRole('button',{name:'Apply owner to selected tasks',exact:true}).click();
 const targetDate=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 await review.getByLabel('Target date 1',{exact:true}).fill(targetDate);await review.getByLabel('Target date 2',{exact:true}).fill(targetDate);
 const [previewResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===endpoint&&response.request().method()==='POST'&&response.request().postDataJSON().operation==='preview'),
  review.getByRole('button',{name:'Preview programme',exact:true}).click()
 ]);
 const preview=await bounded(previewResponse.json(),'Actual starter programme preview');assert.equal(previewResponse.status(),200,preview.error||'programme preview failed');
 assert.equal(preview.organizationId,org.id);assert.equal(preview.total,2);assert.equal(preview.existingProgrammeId,null);assert.ok(preview.token);
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),before.tasks,'programme preview writes no tasks');
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,action:'starter_programme.created'}}),before.events,'preview records no creation');
 const proposed=review.getByRole('region',{name:'Programme preview',exact:true});await proposed.waitFor();
 assert.equal(await proposed.getByRole('button',{name:'Create 2 tasks',exact:true}).isDisabled(),true);
 await proposed.screenshot({path:artifactDir+'/desktop-starter-programme-preview.png'});
 await proposed.getByRole('checkbox',{name:'I have reviewed these tasks, owners and dates.',exact:true}).check();
 const [applyResponse]=await Promise.all([
  review.waitForResponse(response=>response.url()===endpoint&&response.request().method()==='POST'&&response.request().postDataJSON().operation==='apply'),
  proposed.getByRole('button',{name:'Create 2 tasks',exact:true}).evaluate(button=>{button.click();button.click();})
 ]);
 const applied=await bounded(applyResponse.json(),'Actual starter programme creation');assert.equal(applyResponse.status(),200,applied.error||'programme creation failed');
 assert.equal(applied.organizationId,org.id);assert.equal(applied.reused,false);assert.equal(applied.taskIds.length,2);assert.equal(new Set(applied.taskIds).size,2);
 const saved=review.getByRole('region',{name:'Saved programme',exact:true});await saved.getByRole('heading',{name:'Fictional quality team starting programme',exact:true}).waitFor();
 const event=await db.auditEvent.findUniqueOrThrow({where:{id:applied.id}});
 assert.equal(event.organizationId,org.id);assert.equal(event.actorId,reviewer.id);assert.equal(event.action,'starter_programme.created');assert.equal(event.entityType,'StarterProgramme');
 const record=event.details.record;
 assert.equal(record.packId,pack.id);assert.equal(record.packVersion,pack.version);assert.equal(record.createdById,reviewer.id);assert.equal(record.items.length,2);
 assert.deepEqual(record.items.map(item=>item.key),pack.items.slice(0,2).map(item=>item.key));
 assert.deepEqual(record.items.map(item=>item.taskId),applied.taskIds);
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),before.tasks+2);
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,action:'starter_programme.created'}}),before.events+1,'one explicit action creates one attributed programme');
 for(const item of record.items){
  const task=await db.obligation.findUniqueOrThrow({where:{id:item.taskId}});
  assert.equal(task.organizationId,org.id);assert.equal(task.assigneeId,editor.id);assert.equal(task.ownerName,editor.email);assert.equal(task.status,'OPEN');assert.equal(task.category,'Starter programme');
  assert.equal(task.dueDate.toISOString().slice(0,10),targetDate);assert.equal(task.automationKey,item.automationKey);assert.equal(task.title,item.title);
  assert.ok(task.notes.includes(item.description)&&task.notes.includes(item.why)&&task.notes.includes(item.evidenceHint));
  assert.equal(await db.auditEvent.count({where:{organizationId:org.id,entityId:task.id,action:'obligation.created'}}),1);
 }
 assert.equal(record.items[0].title,title);assert.equal(await db.evidence.count({where:{organizationId:org.id}}),before.evidence,'adopting a plan neither uploads nor invents supporting evidence');
 await review.reload();await saved.getByRole('heading',{name:'Fictional quality team starting programme',exact:true}).waitFor();
 assert.equal(new URL(review.url()).searchParams.get('programmeId'),applied.id);
 await saved.getByText('0 / 2 recorded complete',{exact:true}).waitFor();
 await saved.screenshot({path:artifactDir+'/desktop-starter-programme-saved.png'});
 const taskLink=saved.getByRole('link',{name:/^Open task/}).first(),taskUrl=new URL(await taskLink.getAttribute('href'),app);
 assert.equal(taskUrl.searchParams.get('organizationId'),org.id);assert.equal(taskUrl.searchParams.get('taskId'),record.items[0].taskId);
 const [taskResponse]=await Promise.all([
  review.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/workspace/work'&&url.searchParams.get('taskId')===record.items[0].taskId&&response.request().method()==='GET';}),
  taskLink.click()
 ]);
 const taskBody=await bounded(taskResponse.json(),'Starter task workflow');assert.equal(taskResponse.status(),200,taskBody.error||'starter task handoff failed');
 assert.equal(taskBody.task.id,record.items[0].taskId);assert.equal(taskBody.workflow.stage,'EVIDENCE_REQUIRED');
 await review.getByRole('dialog').getByRole('heading',{name:title,exact:true}).waitFor();
 const programmeUrl=app+'/team/programmes?'+new URLSearchParams({organizationId:org.id,programmeId:applied.id});
 await upload.goto(programmeUrl);
 const mobile=upload.getByRole('region',{name:'Saved programme',exact:true});await mobile.getByRole('heading',{name:'Fictional quality team starting programme',exact:true}).waitFor();
 await upload.getByText('You can inspect these starting points and saved work. An owner or administrator must create a programme.',{exact:true}).waitFor();
 assert.equal(await mobile.getByRole('link',{name:/^Open task/}).count(),2);
 assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile starter programme layout'));
 await mobile.screenshot({path:artifactDir+'/mobile-starter-programme-saved.png'});
 assert.equal(await db.obligation.count({where:{organizationId:org.id}}),before.tasks+2,'refresh and other members read the same canonical task set');
 passed('The owner adapted a starter programme, selected two tasks, assigned an existing colleague and previewed without writes. One explicit confirmation created two open, owned tasks and a frozen programme record; reload and a mobile colleague retained the exact task handoff into the ordinary evidence workflow.');
 await checkpoint('review one Annex A applicability decision and export the complete statement');
 await review.goto(app+'/team/programmes?'+new URLSearchParams({organizationId:org.id}));
 const iso=list.packs.find(p=>p.id==='iso27001-annex-a');
 await review.getByRole('button',{name:'Choose '+iso.title,exact:true}).click();
 await review.getByLabel('Why this programme fits',{exact:true}).fill('The fictional site needs to assess information security control scope against its own activities.');
 for(const item of iso.items.slice(2))await review.getByRole('checkbox',{name:'Include '+item.title,exact:true}).uncheck();
 await review.getByLabel('Assign selected tasks to',{exact:true}).selectOption(editor.id);
 await review.getByRole('button',{name:'Apply owner to selected tasks',exact:true}).click();
 await review.getByRole('button',{name:'Preview programme',exact:true}).click();
 await review.getByRole('checkbox',{name:'I have reviewed these tasks, owners and dates.',exact:true}).check();
 await review.getByRole('button',{name:'Create 2 tasks',exact:true}).click();
 const statement=review.getByRole('region',{name:'Saved programme',exact:true});
 const [referenceResponse]=await Promise.all([
  review.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/references')&&response.request().method()==='GET'),
  statement.getByText('Statement of applicability by framework reference',{exact:true}).click()
 ]);
 const scope=await bounded(referenceResponse.json(),'Annex A reference statement');
 assert.equal(referenceResponse.status(),200,scope.error);
 assert.equal(scope.rows.length,93);
 await statement.getByLabel('Framework reference',{exact:true}).selectOption({index:0});
 await statement.getByLabel('Applicability',{exact:true}).selectOption('APPLIES');
 await statement.getByLabel('Reason for this decision',{exact:true}).fill('The fictional site assigns responsibility for information security through its approved local policy.');
 await statement.getByRole('button',{name:'Save scope decision',exact:true}).click();
 await statement.getByText('Decisions recorded for 1 of 93 references.',{exact:true}).waitFor();
 await statement.getByRole('button',{name:'Review next unassessed reference',exact:true}).click();
 assert.equal(await statement.getByLabel('Framework reference',{exact:true}).inputValue(),scope.rows[1].reference);
 const downloadReady=review.waitForEvent('download');
 await statement.getByRole('button',{name:'Download statement of applicability',exact:true}).click();
 const csv=await readFile(await (await downloadReady).path(),'utf8');
 assert.equal(csv.split('\r\n').length,94);assert.match(csv,/APPLIES/);assert.match(csv,/UNASSESSED/);
 await writeFile(artifactDir+'/statement-of-applicability.csv',csv);
 passed('A reviewer decided one ISO Annex A reference and downloaded all 93 references, including unassessed controls without linked tasks.');
 return {programmeId:applied.id,packId:pack.id,taskIds:applied.taskIds,createdTasks:2,previewReadOnly:true,preservedExistingEvidence:true};
}

export async function riskCustomerJourney({review,upload,db,app,org,editor,reviewer,checkpoint,passed,bounded,artifactDir,completedSource,evidenceId,storageSnapshot}){
 const endpoint=app+'/api/workspace/risks',title='Fictional widget training assurance risk';
 const description='A fictional widget operator may work without current training being demonstrated. The exercise records the observed treatment work and the remaining human judgement, without asserting that harm is impossible.';
 const note='Independently checked the fictional risk, the exact completed training task, its frozen receipt, original supporting records and the limits of the proposed remaining risk rating.';
 const until=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 const residual=page=>page.getByRole('region',{name:'Selected risk',exact:true}).getByText('Independently accepted residual rating',{exact:true}).locator('..');
 const evidenceBefore=await db.evidence.count({where:{organizationId:org.id}}),objectsBefore=await storageSnapshot();
 const sourceTask=await db.obligation.findUniqueOrThrow({where:{id:completedSource.taskId}});assert.equal(sourceTask.status,'COMPLETE');
 async function post(page,action,run){
  const [response]=await Promise.all([page.waitForResponse(response=>response.url()===endpoint&&response.request().method()==='POST'&&response.request().postDataJSON().action===action),run()]);
  const body=await bounded(response.json(),'Actual risk '+action+' response');assert.equal(response.status(),action==='CREATE'?201:200,body.error||action+' failed');return body;
 }
 async function open(page,id){
  const [response]=await Promise.all([
   page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/workspace/risks'&&url.searchParams.get('riskId')===id&&response.request().method()==='GET';}),
   page.goto(app+'/team/risks?'+new URLSearchParams({organizationId:org.id,riskId:id}))
  ]);
  const body=await bounded(response.json(),'Actual selected risk response');assert.equal(response.status(),200,body.error||'risk read failed');assert.equal(body.organizationId,org.id);assert.equal(body.selected.risk.id,id);
  await page.getByRole('region',{name:'Selected risk',exact:true}).getByRole('heading',{name:title,exact:true}).waitFor();return body;
 }
 async function expand(page,text){const summary=page.locator('summary').filter({hasText:text}).first();if(!await summary.evaluate(element=>element.parentElement.open))await summary.click();}
 await checkpoint('editor creates an owned risk and links the actual completed source task');
 await upload.goto(app+'/team/risks?'+new URLSearchParams({organizationId:org.id}));
 await upload.getByRole('button',{name:'New risk',exact:true}).click();
 await upload.getByLabel('Risk title',{exact:true}).fill(title);await upload.getByLabel('Risk description',{exact:true}).fill(description);
 await upload.getByLabel('Category',{exact:true}).selectOption('QUALITY');await upload.getByLabel('Risk owner',{exact:true}).selectOption(editor.id);
 await upload.getByLabel('Likelihood',{exact:true}).selectOption('4');await upload.getByLabel('Impact',{exact:true}).selectOption('4');
 await upload.getByLabel('Why these ratings',{exact:true}).fill('For this fictional exercise, the team judges that unproven training can occur and could materially affect the quality of the widget activity. These are recorded human ratings, not incident probabilities.');
 await upload.getByLabel('Treatment approach',{exact:true}).selectOption('MITIGATE');await upload.getByLabel('Review date',{exact:true}).fill(until);
 const created=await post(upload,'CREATE',()=>upload.getByRole('button',{name:'Save risk',exact:true}).evaluate(button=>{button.click();button.click();}));
 const id=created.riskId;assert.equal(created.id,id);
 await upload.getByRole('region',{name:'Selected risk',exact:true}).getByRole('heading',{name:title,exact:true}).waitFor();
 const initial=await db.riskRecord.findUniqueOrThrow({where:{id}});assert.equal(initial.organizationId,org.id);assert.equal(initial.ownerId,editor.id);assert.equal(initial.createdById,editor.id);assert.equal(initial.status,'OPEN');assert.equal(initial.likelihood*initial.impact,16);
 assert.equal(await db.riskRecord.count({where:{organizationId:org.id,title}}),1,'rapid creation is one attributed risk');
 await open(upload,id);await expand(upload,'Add treatment');
 await upload.getByLabel('Find a treatment task',{exact:true}).fill(sourceTask.title);await upload.getByRole('button',{name:'Find tasks',exact:true}).click();
 await upload.getByRole('region',{name:'Selected risk',exact:true}).getByRole('heading',{name:title,exact:true}).waitFor();
 await expand(upload,'Add treatment');await upload.getByLabel('Treatment task',{exact:true}).selectOption(sourceTask.id);
 await upload.getByLabel('Why this task treats the risk',{exact:true}).fill('The completed fictional source task records the staff training evidence and independent decision that address this risk; its limits must still be considered in the separate residual assessment.');
 const linked=await post(upload,'TREATMENT',()=>upload.getByRole('button',{name:'Link treatment task',exact:true}).evaluate(button=>{button.click();button.click();}));
 assert.equal(linked.riskId,id);assert.equal(linked.taskId,sourceTask.id);
 await upload.getByRole('link',{name:'Open treatment task →',exact:true}).waitFor();
 assert.equal(await db.riskTreatment.count({where:{organizationId:org.id,riskId:id,obligationId:sourceTask.id}}),1);
 const treated=await open(upload,id);assert.equal(treated.selected.treatments.length,1);assert.equal(treated.selected.treatments[0].completion.current,true);assert.equal(treated.selected.treatments[0].completion.eventId,completedSource.eventId);
 assert.deepEqual(treated.selected.blockers,[]);assert.equal(treated.selected.risk.score,16);assert.equal(treated.selected.reviews.length,0);
 const treatmentLink=new URL(await upload.getByRole('link',{name:'Open treatment task →',exact:true}).getAttribute('href'),app);
 assert.equal(treatmentLink.searchParams.get('organizationId'),org.id);assert.equal(treatmentLink.searchParams.get('taskId'),sourceTask.id);
 await residual(upload).getByText('Not recorded',{exact:true}).waitFor();
 const [treatmentResponse]=await Promise.all([
  upload.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/workspace/work'&&url.searchParams.get('taskId')===sourceTask.id&&response.request().method()==='GET';}),
  upload.getByRole('link',{name:'Open treatment task →',exact:true}).click()
 ]);
 const treatmentBody=await bounded(treatmentResponse.json(),'Connected treatment task response');assert.equal(treatmentResponse.status(),200,treatmentBody.error||'treatment task unavailable');
 assert.equal(treatmentBody.task.id,sourceTask.id);assert.equal(treatmentBody.task.status,'COMPLETE');assert.equal(treatmentBody.workflow.stage,'COMPLETED');
 const taskDialog=upload.getByRole('dialog');await taskDialog.getByRole('heading',{name:sourceTask.title,exact:true}).waitFor();
 const returnLink=taskDialog.getByRole('region',{name:'Related risks',exact:true}).getByRole('link',{name:'Open related risk: '+title,exact:true});
 const returnUrl=new URL(await returnLink.getAttribute('href'),app);assert.equal(returnUrl.pathname,'/team/risks');assert.equal(returnUrl.searchParams.get('organizationId'),org.id);assert.equal(returnUrl.searchParams.get('riskId'),id);
 await returnLink.click();await upload.getByRole('region',{name:'Selected risk',exact:true}).getByRole('heading',{name:title,exact:true}).waitFor();
 assert.equal(new URL(upload.url()).searchParams.get('riskId'),id);
 passed('An editor created an owned risk and linked the existing completed source task with its exact verified receipt. The customer opened the completed treatment and followed its related-risk link back to the same risk, while the inherent rating remained 16/25 and no residual decision was invented.');

 await checkpoint('editor prepares a residual risk proposal using the existing approved original');
 await expand(upload,'Prepare a residual risk review');
 await upload.getByLabel('Residual likelihood',{exact:true}).selectOption('2');await upload.getByLabel('Residual impact',{exact:true}).selectOption('3');
 await upload.getByLabel('Review rationale',{exact:true}).fill('The independently completed fictional training task and retained original records support a lower remaining likelihood for this bounded exercise. The human assessment retains material impact and explicitly requires another independent decision.');
 await upload.getByLabel('Review valid until',{exact:true}).fill(until);
 const original=await db.evidence.findUniqueOrThrow({where:{id:evidenceId}});
 await upload.getByRole('checkbox',{name:original.filename,exact:true}).check();
 assert.equal(await upload.getByRole('button',{name:'Prepare risk review',exact:true}).isDisabled(),true);
 await upload.getByRole('checkbox',{name:'I have reviewed the treatment work, supporting evidence and proposed residual rating.',exact:true}).check();
 const proposed=await post(upload,'PREPARE_REVIEW',()=>upload.getByRole('button',{name:'Prepare risk review',exact:true}).evaluate(button=>{button.click();button.click();}));
 assert.equal(proposed.riskId,id);assert.equal(proposed.status,'PENDING');
 await upload.getByText('This proposal needs an independent eligible administrator. Its author cannot approve it.',{exact:true}).waitFor();
 const draft=await db.riskReview.findUniqueOrThrow({where:{id:proposed.id}});
 assert.equal(draft.authorId,editor.id);assert.equal(draft.reviewerId,null);assert.equal(draft.residualLikelihood*draft.residualImpact,6);
 assert.deepEqual(draft.evidenceManifest.map(file=>file.id),[evidenceId]);assert.equal(draft.context.treatments[0].task.id,sourceTask.id);assert.equal(draft.context.treatments[0].completion.eventId,completedSource.eventId);
 assert.match(draft.context.treatments[0].completion.proofHash,/^[a-f0-9]{64}$/);
 const pending=await open(upload,id);assert.equal(pending.selected.risk.status,'UNDER_REVIEW');assert.equal(pending.selected.risk.score,16);assert.equal(pending.selected.reviews[0].status,'PENDING');assert.equal(pending.selected.canReview,false);
 assert.equal(await upload.getByRole('button',{name:'Accept residual risk decision',exact:true}).count(),0);
 await residual(upload).getByText('Not recorded',{exact:true}).waitFor();
 assert.equal(await db.riskReview.count({where:{organizationId:org.id,riskId:id}}),1);
 await upload.getByRole('region',{name:'Selected risk',exact:true}).screenshot({path:artifactDir+'/mobile-risk-independent-review-needed.png'});

 await checkpoint('different administrator independently accepts the proposed residual risk');
 const decisionView=await open(review,id);assert.equal(decisionView.selected.canReview,true);
 await review.getByLabel('Independent review notes '+proposed.id,{exact:true}).fill(note);
 assert.equal(await review.getByRole('button',{name:'Accept residual risk decision',exact:true}).isDisabled(),true);
 await review.getByRole('checkbox',{name:'I independently reviewed this proposal, its treatment records and supporting evidence.',exact:true}).check();
 const decided=await post(review,'DECIDE_REVIEW',()=>review.getByRole('button',{name:'Accept residual risk decision',exact:true}).evaluate(button=>{button.click();button.click();}));
 assert.equal(decided.id,proposed.id);assert.equal(decided.status,'ACCEPTED');
 await residual(review).getByText('6 / 25',{exact:true}).waitFor();
 const accepted=await db.riskReview.findUniqueOrThrow({where:{id:proposed.id}});
 assert.equal(accepted.reviewerId,reviewer.id);assert.equal(accepted.authorId,editor.id);assert.equal(accepted.status,'ACCEPTED');assert.equal(accepted.reviewNotes,note);assert.equal(accepted.version,draft.version+1);assert.match(accepted.decisionHash,/^[a-f0-9]{64}$/);
 assert.equal(accepted.contextHash,draft.contextHash);assert.deepEqual(accepted.context,draft.context,'approval preserves the proposed treatment and file basis');
 assert.equal(await db.auditEvent.count({where:{organizationId:org.id,entityId:id,action:'risk.review_decided'}}),1);
 const current=await open(review,id);assert.equal(current.selected.risk.status,'ACCEPTED');assert.equal(current.selected.risk.score,16);assert.equal(current.selected.reviews[0].current,true);assert.equal(current.selected.reviews[0].score,6);
 const selected=review.getByRole('region',{name:'Selected risk',exact:true});await residual(review).getByText('6 / 25',{exact:true}).waitFor();
 assert.equal(await residual(review).getByText('Not recorded',{exact:true}).count(),0);
 const originalLink=new URL(await selected.getByRole('link',{name:original.filename+' →',exact:true}).getAttribute('href'),app);
 assert.equal(originalLink.pathname,'/team/evidence');assert.equal(originalLink.searchParams.get('organizationId'),org.id);assert.equal(originalLink.searchParams.get('evidenceId'),evidenceId);
 const download=review.waitForEvent('download');await selected.getByRole('button',{name:'Download risk record',exact:true}).click();
 const exported=JSON.parse(await readFile(await (await download).path(),'utf8'));assert.equal(exported.format,'regpilot-risk-record');assert.equal(exported.organizationId,org.id);assert.equal(exported.risk.id,id);assert.equal(exported.reviews[0].id,accepted.id);assert.equal(exported.reviews[0].current,true);assert.equal(exported.treatments[0].completion.eventId,completedSource.eventId);
 await writeFile(artifactDir+'/customer-risk-record.json',JSON.stringify(exported,null,2)+'\n');
 assert.equal(await db.evidence.count({where:{organizationId:org.id}}),evidenceBefore);assert.deepEqual(await storageSnapshot(),objectsBefore);
 assert.equal((await db.obligation.findUniqueOrThrow({where:{id:sourceTask.id}})).updatedAt.toISOString(),sourceTask.updatedAt.toISOString(),'risk review does not rewrite its completed treatment task');
 await selected.screenshot({path:artifactDir+'/desktop-risk-accepted.png'});
 await open(upload,id);assert.ok(await bounded(upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile connected risk layout'));
 await upload.getByRole('region',{name:'Selected risk',exact:true}).screenshot({path:artifactDir+'/mobile-risk-accepted.png'});
 passed('The editor proposed a 6/25 residual rating using the same approved private file and exact treatment receipt. A different administrator verified and accepted it; reload and the downloaded risk record preserved the separate 16/25 inherent rating, attributed 6/25 decision and canonical evidence links, with no new files or rewritten treatment completion.');

 await checkpoint('controlled evidence revision invalidates current risk reliance without rewriting history');
 // Deliberate isolated fixture change proves that a historical acceptance cannot
 // silently stand in for a current assessment after its evidence basis changes.
 await db.evidence.update({where:{id:evidenceId},data:{reviewVersion:{increment:1},reviewerNotes:'Controlled fictional evidence review revision for the connected risk currentness acceptance check.'}});
 const stale=await open(review,id);assert.equal(stale.selected.reviews[0].id,accepted.id);assert.equal(stale.selected.reviews[0].status,'ACCEPTED');assert.equal(stale.selected.reviews[0].current,false);assert.ok(stale.selected.reviews[0].reason);
 await residual(review).getByText('Not recorded',{exact:true}).waitFor();
 const frozen=await db.riskReview.findUniqueOrThrow({where:{id:accepted.id}});assert.deepEqual(frozen,accepted,'the original accepted review remains immutable when its basis changes');
 assert.equal(await db.riskReview.count({where:{organizationId:org.id,riskId:id}}),1);assert.equal(stale.selected.risk.score,16);
 await review.getByRole('region',{name:'Selected risk',exact:true}).screenshot({path:artifactDir+'/desktop-risk-changed-evidence.png'});
 passed('A controlled revision to the reviewed evidence removed reliance on the earlier residual rating and showed the changed basis. The original accepted risk decision, its hashes and treatment receipt were retained unchanged as history.');
 await checkpoint('inspect a risk through the live assurance report');
 await review.goto(app+'/team/briefing?'+new URLSearchParams({organizationId:org.id,areas:'risks'}));
 const coverage=review.getByRole('region',{name:'Assurance coverage'});
 await coverage.getByRole('button',{name:/risks, likelihood 4, impact 4,/}).click();
 const riskLink=coverage.getByRole('link',{name:title,exact:true});
 assert.equal(new URL(await riskLink.getAttribute('href'),app).searchParams.get('riskId'),id);
 await riskLink.click();await review.getByRole('region',{name:'Selected risk'}).getByRole('heading',{name:title,exact:true}).waitFor();
 passed('The bookmarked risk report recomputed the inherent risk matrix and opened the exact underlying risk after its supporting evidence changed.');
 return {riskId:id,treatmentId:linked.id,taskId:sourceTask.id,completionEventId:completedSource.eventId,reviewId:proposed.id,inherentScore:16,residualScore:6,independentReviewerId:reviewer.id,evidenceId,filesUnchanged:true,staleReviewDetected:true,historyPreserved:true};
}
