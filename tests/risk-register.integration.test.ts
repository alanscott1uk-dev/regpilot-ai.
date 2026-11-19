import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import type {AuthorizedContext} from '../lib/server/authorization';
import {createRisk,updateRisk,addRiskTreatment,prepareRiskReview,decideRiskReview,archiveRisk,riskWorkspace,exportRisk} from '../lib/server/risk-service';
import {createEvidence,reviewEvidence} from '../lib/server/evidence-service';
import {workCompletion,completeWork} from '../lib/server/work-completion-service';
import type {EvidenceObjectStore} from '../lib/server/evidence-storage';
import {fixturePdf} from './helpers/pdf-fixture.mjs';

const date=(days=14)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const notes='The fictional recovery evidence and its recorded result were checked against the stated treatment scope.';
const status=(expected:number)=>(error:unknown)=>!!error&&typeof error==='object'&&'status' in error&&error.status===expected;

async function setup(){
 const suffix=randomUUID(),users=await Promise.all(['owner','reviewer','editor','uploader','viewer','foreign'].map(name=>db.user.create({data:{externalId:name+suffix,email:name+suffix+'@example.invalid'}}))),orgs=await Promise.all(['A','B'].map(name=>db.organization.create({data:{name:'Fictional risk register '+name+suffix}})));
 const owner:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:'OWNER'},reviewer:AuthorizedContext={...owner,userId:users[1].id,role:'ADMIN'},editor:AuthorizedContext={...owner,userId:users[2].id,role:'EDITOR'},uploader:AuthorizedContext={...owner,userId:users[3].id,role:'ADMIN'},viewer:AuthorizedContext={...owner,userId:users[4].id,role:'VIEWER'},foreign:AuthorizedContext={organizationId:orgs[1].id,userId:users[5].id,role:'OWNER'};
 await db.membership.createMany({data:[owner,reviewer,editor,uploader,viewer,foreign]});const previous=process.env.REGPILOT_AI_ALLOWED_EMAILS;process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(user=>user.email).join(',');
 const objects=new Map<string,Uint8Array>(),storage:EvidenceObjectStore={async put(key,bytes){objects.set(key,Uint8Array.from(bytes));},async get(key){const bytes=objects.get(key);if(!bytes)throw new Error('Missing fictional risk proof');return Uint8Array.from(bytes);},async remove(key){objects.delete(key);}};
 const clean=async()=>{if(previous===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=previous;for(const model of [db.riskReview,db.riskTreatment,db.riskControl,db.riskRecord,db.auditEvent,db.evidence,db.obligation,db.managedControl,db.programmeImport,db.membership] as any[])await model.deleteMany({where:{organizationId:{in:orgs.map(org=>org.id)}}});await db.organization.deleteMany({where:{id:{in:orgs.map(org=>org.id)}}});await db.user.deleteMany({where:{id:{in:users.map(user=>user.id)}}});};
 return {owner,reviewer,editor,uploader,viewer,foreign,objects,storage,clean};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
const fields=(ownerId:string)=>({title:'Fictional customer records recovery',description:'Losing the fictional customer records would interrupt service until the company can recover a usable copy.',category:'OPERATIONAL',ownerId,likelihood:3,impact:4,ratingRationale:'A representative recovery has not yet been exercised and the customer service depends on these working records.',strategy:'MITIGATE',reviewDueAt:date(),controlIds:[]});
const proposal=(version:number,evidenceIds:string[],requestKey=randomUUID())=>({version,requestKey,residualLikelihood:2,residualImpact:3,rationale:'The fictional recovery exercise produced a usable record and independently reviewed evidence supports this bounded remaining risk judgement.',validUntil:date(30),evidenceIds,confirm:true});
const decision=(version:number,riskVersion:number)=>({version,riskVersion,decision:'ACCEPTED',notes,confirm:true});
async function task(f:Fixture,owner=f.editor){return db.obligation.create({data:{organizationId:owner.organizationId,title:'Fictional independently reviewed supporting work',category:'Risk fixture',ownerName:owner.userId,assigneeId:owner.userId,dueDate:new Date(date())}});}
async function approvedFile(f:Fixture,taskId:string,author=f.editor){const file=await createEvidence(author,taskId,'fictional-risk-record.pdf',fixturePdf([['FICTIONAL RECOVERY RECORD','A fictional recovery exercise produced a usable working copy and recorded the people involved.']]),{storage:f.storage,scan:async()=>({status:'CLEAN',engine:'fictional-test'})});await reviewEvidence(f.reviewer,file.id,{decision:'APPROVED',version:1,notes},f.storage);return file;}
async function complete(f:Fixture,taskId:string,actor=f.editor){const ready=await workCompletion(actor,taskId);assert.equal(ready.ready,true);return completeWork(actor,taskId,{token:ready.token!,evidenceIds:ready.evidence.map(file=>file.id),notes,confirm:true},{storage:f.storage});}
async function treatedRisk(f:Fixture,author=f.editor){const risk=await createRisk(author,{...fields(author.userId),requestKey:randomUUID()}),treatment=await addRiskTreatment(author,risk.id,{version:risk.version,requestKey:randomUUID(),title:'Exercise the fictional record recovery',ownerId:author.userId,dueDate:date(),purpose:'Produce a usable restored record and review the outcome of the recovery exercise.'}),file=await approvedFile(f,treatment.taskId,author);await complete(f,treatment.taskId,author);return {risk,treatment,file};}
after(async()=>{await db.$disconnect();});

test('risk and owned treatment creation are tenant scoped, replayable and protected by current roles and versions',async()=>{
 const f=await setup();
 try{
  const input={...fields(f.editor.userId),requestKey:randomUUID()};
  await assert.rejects(()=>createRisk(f.viewer,input),status(403));
  await assert.rejects(()=>createRisk(f.editor,{...input,ownerId:f.foreign.userId}),status(409));
  await assert.rejects(()=>createRisk(f.editor,{...input,ownerId:f.viewer.userId}),status(409));
  await assert.rejects(()=>createRisk(f.editor,{...input,controlIds:[randomUUID()]}),status(409));
  const results=await Promise.all([createRisk(f.editor,input),createRisk(f.editor,input)]),risk=results[0];assert.equal(new Set(results.map(row=>row.id)).size,1);assert.equal(results.filter(row=>!row.reused).length,1);assert.equal(await db.riskRecord.count({where:{organizationId:f.editor.organizationId}}),1);
  await assert.rejects(()=>createRisk(f.editor,{...input,title:'A different risk with the same request key'}),status(409));
  await assert.rejects(()=>riskWorkspace(f.foreign,{riskId:risk.id}),status(404));
  await assert.rejects(()=>riskWorkspace({...f.foreign,organizationId:f.editor.organizationId},{riskId:risk.id}),status(403));
  assert.equal((await riskWorkspace(f.viewer,{riskId:risk.id})).selected?.canEdit,false);
  const lookup=await riskWorkspace(f.editor,{requestKey:input.requestKey});assert.equal(lookup.creationLookup?.riskId,risk.id);assert.equal(lookup.selected?.risk.id,risk.id);
  const other=await createRisk(f.owner,{...fields(f.owner.userId),requestKey:randomUUID()});await assert.rejects(()=>riskWorkspace(f.editor,{riskId:other.id,requestKey:input.requestKey}),status(409));
  await assert.rejects(()=>updateRisk(f.editor,other.id,{...fields(f.owner.userId),version:other.version}),status(403));
  const updates=await Promise.allSettled([updateRisk(f.editor,risk.id,{...fields(f.editor.userId),title:'First concurrent risk edit',version:1}),updateRisk(f.editor,risk.id,{...fields(f.editor.userId),title:'Second concurrent risk edit',version:1})]);assert.equal(updates.filter(row=>row.status==='fulfilled').length,1);assert.equal(updates.filter(row=>row.status==='rejected'&&status(409)(row.reason)).length,1);
  const saved=await db.riskRecord.findUniqueOrThrow({where:{id:risk.id}}),request={version:saved.version,requestKey:randomUUID(),title:'Exercise the fictional recovery',ownerId:f.editor.userId,dueDate:date(),purpose:'Prove the company can restore a usable fictional record with a reviewed result.'};
  const treatments=await Promise.all([addRiskTreatment(f.editor,risk.id,request),addRiskTreatment(f.editor,risk.id,request)]),treatment=treatments[0];assert.equal(new Set(treatments.map(row=>row.taskId)).size,1);assert.equal(treatments.filter(row=>!row.reused).length,1);
  const created=await db.obligation.findUniqueOrThrow({where:{id:treatment.taskId}});assert.equal(created.assigneeId,f.editor.userId);assert.equal(created.status,'OPEN');assert.equal(created.originKey,null);assert.equal(created.controlId,null);assert.equal(created.category,'Risk treatment');assert.equal(await db.riskTreatment.count({where:{riskId:risk.id}}),1);
  await assert.rejects(()=>addRiskTreatment(f.editor,risk.id,{...request,purpose:'Different work must not replace a treatment with the same request key.'}),status(409));
  const foreignTask=await task(f,f.foreign);await assert.rejects(()=>addRiskTreatment(f.editor,risk.id,{version:treatment.version,requestKey:randomUUID(),purpose:request.purpose,taskId:foreignTask.id}),status(404));
  await assert.rejects(()=>addRiskTreatment(f.editor,risk.id,{version:treatment.version,requestKey:randomUUID(),purpose:request.purpose,taskId:treatment.taskId}),status(409));
  const workspace=await riskWorkspace(f.viewer,{riskId:risk.id});assert.equal(workspace.summary.all,2);assert.equal(workspace.selected?.treatments[0].task.id,treatment.taskId);assert.equal(new URL(workspace.selected!.treatments[0].task.href,'https://example.invalid').searchParams.get('taskId'),treatment.taskId);assert.match(workspace.selected!.blockers.join(' '),/Complete this treatment task/);assert.doesNotMatch(JSON.stringify(workspace),/storageKey|evidenceManifest|contextHash|proposalHash/);
  await db.membership.update({where:{organizationId_userId:{organizationId:f.editor.organizationId,userId:f.editor.userId}},data:{role:'VIEWER'}});
  await assert.rejects(()=>addRiskTreatment(f.editor,risk.id,request),status(403),'fresh membership overrides an earlier writer context, including replay');
 }finally{await f.clean();}
});

test('risk acceptance follows actual treatment completion, byte verification and an independent decision; changes and archive retain history',async()=>{
 const f=await setup();
 try{
  const risk=await createRisk(f.editor,{...fields(f.editor.userId),requestKey:randomUUID()}),treatment=await addRiskTreatment(f.editor,risk.id,{version:risk.version,requestKey:randomUUID(),title:'Exercise fictional record recovery',ownerId:f.editor.userId,dueDate:date(),purpose:'Record a usable recovery outcome supported by independently approved evidence.'}),file=await approvedFile(f,treatment.taskId),input=proposal(treatment.version,[file.id]);
  await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage:f.storage}),status(409));assert.equal(await db.riskReview.count({where:{riskId:risk.id}}),0);
  await db.obligation.update({where:{id:treatment.taskId},data:{status:'COMPLETE',completedAt:new Date()}});
  await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage:f.storage}),status(409),'a COMPLETE flag without a real completion receipt is insufficient');
  await db.obligation.update({where:{id:treatment.taskId},data:{status:'OPEN',completedAt:null}});const receipt=await complete(f,treatment.taskId);
  const fileRow=await db.evidence.findUniqueOrThrow({where:{id:file.id}}),original=f.objects.get(fileRow.storageKey)!;f.objects.set(fileRow.storageKey,Uint8Array.from([0,1,2]));
  await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage:f.storage}),status(409));assert.equal(await db.riskReview.count({where:{riskId:risk.id}}),0,'tampered storage cannot create a risk review');f.objects.set(fileRow.storageKey,original);
  const prepared=await prepareRiskReview(f.editor,risk.id,input,{storage:f.storage});assert.equal(prepared.status,'PENDING');assert.equal((await prepareRiskReview(f.editor,risk.id,input,{storage:f.storage})).reused,true);assert.equal((await riskWorkspace(f.editor,{riskId:risk.id})).selected?.latestReview?.current,true);
  await assert.rejects(()=>decideRiskReview(f.editor,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(403));
  await assert.rejects(()=>decideRiskReview(f.foreign,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(404));
  f.objects.set(fileRow.storageKey,Uint8Array.from([9,8,7]));await assert.rejects(()=>decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(409));assert.equal((await db.riskReview.findUniqueOrThrow({where:{id:prepared.id}})).status,'PENDING');f.objects.set(fileRow.storageKey,original);
  const accepted=await decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage});assert.equal(accepted.status,'ACCEPTED');assert.equal((await decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage})).reused,true);
  let workspace=await riskWorkspace(f.owner,{riskId:risk.id});assert.equal(workspace.selected?.latestReview?.current,true);assert.equal(workspace.selected?.risk.status,'ACCEPTED');assert.equal(workspace.selected?.treatments[0].completion.eventId,receipt.eventId);assert.equal(workspace.selected?.treatments[0].completion.current,true);
  const exported=await exportRisk(f.viewer,risk.id);assert.equal(exported.format,'regpilot-risk-record');assert.equal(exported.latestReview?.status,'ACCEPTED');assert.doesNotMatch(JSON.stringify(exported),/storageKey|evidenceManifest|contextHash|proposalHash/);
  await db.membership.update({where:{organizationId_userId:{organizationId:f.reviewer.organizationId,userId:f.reviewer.userId}},data:{role:'VIEWER'}});assert.equal((await riskWorkspace(f.owner,{riskId:risk.id})).selected?.latestReview?.current,false,'demoting the independent decision maker invalidates current reliance');await db.membership.update({where:{organizationId_userId:{organizationId:f.reviewer.organizationId,userId:f.reviewer.userId}},data:{role:'ADMIN'}});
  const updated=await updateRisk(f.editor,risk.id,{...fields(f.editor.userId),reviewDueAt:date(40),version:accepted.riskVersion});workspace=await riskWorkspace(f.owner,{riskId:risk.id});assert.equal(workspace.selected?.latestReview?.current,false,'even a changed review schedule requires a new decision');assert.equal(workspace.selected?.reviews[0].status,'ACCEPTED','the prior decision remains recorded as history');
  const renewed=await prepareRiskReview(f.editor,risk.id,proposal(updated.version,[file.id]),{storage:f.storage}),second=await decideRiskReview(f.reviewer,renewed.id,decision(renewed.version,renewed.riskVersion),{storage:f.storage});
  const before=await db.obligation.findUniqueOrThrow({where:{id:treatment.taskId}}),archived=await archiveRisk(f.owner,risk.id,{version:second.riskVersion,notes:'This fictional risk has left the active operating scope and is retained for history.'});assert.equal(archived.status,'ARCHIVED');workspace=await riskWorkspace(f.owner,{riskId:risk.id});assert.equal(workspace.selected?.latestReview?.current,false);assert.equal(workspace.selected?.reviews.length,2);
  await assert.rejects(()=>archiveRisk(f.editor,risk.id,{version:archived.version,notes},true),status(403));
  await archiveRisk(f.owner,risk.id,{version:archived.version,notes:'The fictional operation resumed, so this risk needs a fresh independent assessment.'},true);workspace=await riskWorkspace(f.owner,{riskId:risk.id});assert.equal(workspace.selected?.risk.status,'OPEN');assert.equal(workspace.selected?.latestReview?.current,false,'reopening never revives an earlier accepted decision');
  const afterTask=await db.obligation.findUniqueOrThrow({where:{id:treatment.taskId}});assert.equal(afterTask.status,before.status);assert.equal(afterTask.updatedAt.toISOString(),before.updatedAt.toISOString());assert.equal(await db.auditEvent.count({where:{organizationId:f.owner.organizationId,entityId:risk.id,action:{in:['risk.archived','risk.reopened']}}}),2);
 }finally{await f.clean();}
});

test('concurrent review preparation with one request key cannot silently adopt different proposed judgements',async()=>{
 const f=await setup();
 try{
  const {risk,treatment,file}=await treatedRisk(f),first=proposal(treatment.version,[file.id]),second={...first,residualImpact:4,rationale:'A competing reviewer preparation reaches a different fictional residual risk judgement using the same records.'};
  let arrivals=0,release!:()=>void;const bothVerifying=new Promise<void>(resolve=>{release=resolve;}),storage:EvidenceObjectStore={...f.storage,async get(key){if(++arrivals===2)release();await bothVerifying;return f.storage.get(key);}};
  const results=await Promise.allSettled([prepareRiskReview(f.editor,risk.id,first,{storage}),prepareRiskReview(f.editor,risk.id,second,{storage})]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&status(409)(row.reason)).length,1);assert.equal(await db.riskReview.count({where:{riskId:risk.id}}),1);assert.equal(await db.auditEvent.count({where:{organizationId:f.editor.organizationId,entityId:risk.id,action:'risk.review_prepared'}}),1);
 }finally{await f.clean();}
});

test('treatment evidence uploaders cannot independently accept their own relied-on proof',async()=>{
 const f=await setup();
 try{
  const risk=await createRisk(f.editor,{...fields(f.editor.userId),requestKey:randomUUID()}),treatment=await addRiskTreatment(f.editor,risk.id,{version:1,requestKey:randomUUID(),title:'Exercise the fictional recovery',ownerId:f.editor.userId,dueDate:date(),purpose:'Prove the fictional recovery works using separately reviewed treatment evidence.'});
  const treatmentFile=await approvedFile(f,treatment.taskId,f.uploader);await complete(f,treatment.taskId);
  const supportingTask=await task(f),reviewFile=await approvedFile(f,supportingTask.id),prepared=await prepareRiskReview(f.editor,risk.id,proposal(treatment.version,[reviewFile.id]),{storage:f.storage});assert.notEqual(treatmentFile.id,reviewFile.id);
  const uploaderView=await riskWorkspace(f.uploader,{riskId:risk.id});assert.equal(uploaderView.selected?.canReview,false,'the UI must not offer acceptance to a relied-on treatment uploader');
  await assert.rejects(()=>decideRiskReview(f.uploader,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(403));
  assert.equal((await decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage})).status,'ACCEPTED');
 }finally{await f.clean();}
});

test('changed completed work, receipt integrity, permissions and concurrent context invalidate a risk proposal',async()=>{
 const f=await setup();
 try{
  const {risk,treatment,file}=await treatedRisk(f),input=proposal(treatment.version,[file.id]),originalTask=await db.obligation.findUniqueOrThrow({where:{id:treatment.taskId}});
  await db.obligation.update({where:{id:treatment.taskId},data:{title:'A different treatment outcome after completion'}});await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage:f.storage}),status(409),'renaming completed work must not turn an old receipt into proof of a different outcome');await db.obligation.update({where:{id:treatment.taskId},data:{title:originalTask.title}});
  const completion=await db.auditEvent.findFirstOrThrow({where:{organizationId:f.editor.organizationId,entityId:treatment.taskId,action:'work.completed'}}),saved=completion.details as Record<string,any>;await db.auditEvent.update({where:{id:completion.id},data:{details:{...saved,proofHash:'0'.repeat(64)}}});await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage:f.storage}),status(409));await db.auditEvent.update({where:{id:completion.id},data:{details:completion.details!}});
  let changed=false;const storage:EvidenceObjectStore={...f.storage,async get(key){const bytes=await f.storage.get(key);if(!changed){changed=true;await db.obligation.update({where:{id:treatment.taskId},data:{notes:'A changed treatment context while its saved bytes were being verified.'}});}return bytes;}};
  await assert.rejects(()=>prepareRiskReview(f.editor,risk.id,input,{storage}),status(409),'a context change during external storage verification cannot commit a proposal');assert.equal(await db.riskReview.count({where:{riskId:risk.id}}),0);
  const prepared=await prepareRiskReview(f.editor,risk.id,input,{storage:f.storage});await db.membership.update({where:{organizationId_userId:{organizationId:f.editor.organizationId,userId:f.editor.userId}},data:{role:'ADMIN'}});
  await assert.rejects(()=>decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(409),'a role change invalidates the bound permission context even when the owner remains eligible');assert.equal((await riskWorkspace(f.owner,{riskId:risk.id})).selected?.latestReview?.current,false);await db.membership.update({where:{organizationId_userId:{organizationId:f.editor.organizationId,userId:f.editor.userId}},data:{role:'EDITOR'}});
  const savedReview=await db.riskReview.findUniqueOrThrow({where:{id:prepared.id}});await db.riskReview.update({where:{id:prepared.id},data:{contextHash:'0'.repeat(64)}});assert.equal((await riskWorkspace(f.owner,{riskId:risk.id})).selected?.latestReview?.current,false);await assert.rejects(()=>decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(409));await db.riskReview.update({where:{id:prepared.id},data:{contextHash:savedReview.contextHash}});
 }finally{await f.clean();}
});

test('linked managed controls are tenant constrained and their changed or disabled state invalidates risk reliance',async()=>{
 const f=await setup();
 try{
  const control=async(ctx:AuthorizedContext)=>{const programme=await db.programmeImport.create({data:{organizationId:ctx.organizationId,createdById:ctx.userId,inputHash:randomUUID(),method:'FIXTURE',status:'ACCEPTED',evidenceManifest:[]}});return db.managedControl.create({data:{organizationId:ctx.organizationId,importId:programme.id,proposalKey:'fictional-recovery-control',title:'Fictional record recovery control',description:'Maintain and exercise a recoverable copy of the fictional customer records.',testProcedure:'Inspect a dated recovery exercise and its independent review.',theme:'continuity',ownerId:ctx.userId,scheduledById:ctx.userId,intervalDays:30,nextReviewAt:new Date(date(30))}});};
  const [localControl,foreignControl]=await Promise.all([control(f.editor),control(f.foreign)]),{risk,treatment,file}=await treatedRisk(f);
  await assert.rejects(()=>updateRisk(f.editor,risk.id,{...fields(f.editor.userId),version:treatment.version,controlIds:[foreignControl.id]}),status(409));
  await assert.rejects(()=>db.riskControl.create({data:{organizationId:f.editor.organizationId,riskId:risk.id,controlId:foreignControl.id}}),(error:any)=>error.code==='P2003','the composite database foreign key also prevents a direct cross-company control link');
  const linked=await updateRisk(f.editor,risk.id,{...fields(f.editor.userId),version:treatment.version,controlIds:[localControl.id]});assert.equal((await riskWorkspace(f.viewer,{riskId:risk.id})).selected?.controls[0].id,localControl.id);
  const prepared=await prepareRiskReview(f.editor,risk.id,proposal(linked.version,[file.id]),{storage:f.storage});await db.managedControl.update({where:{id:localControl.id},data:{title:'Revised fictional recovery scope',version:{increment:1}}});
  assert.equal((await riskWorkspace(f.owner,{riskId:risk.id})).selected?.latestReview?.current,false);await assert.rejects(()=>decideRiskReview(f.reviewer,prepared.id,decision(prepared.version,prepared.riskVersion),{storage:f.storage}),status(409),'a changed linked control invalidates an otherwise complete pending assessment');
  const fresh=await prepareRiskReview(f.editor,risk.id,proposal(prepared.riskVersion,[file.id]),{storage:f.storage});await decideRiskReview(f.reviewer,fresh.id,decision(fresh.version,fresh.riskVersion),{storage:f.storage});assert.equal((await riskWorkspace(f.owner,{riskId:risk.id})).selected?.latestReview?.current,true);
  await db.managedControl.update({where:{id:localControl.id},data:{enabled:false,version:{increment:1}}});const stale=await riskWorkspace(f.owner,{riskId:risk.id});assert.equal(stale.selected?.latestReview?.current,false);assert.match(stale.selected!.blockers.join(' '),/active control/);assert.equal(stale.selected?.latestReview?.status,'ACCEPTED','the human decision stays in history while its current reliance is invalidated');
 }finally{await f.clean();}
});
