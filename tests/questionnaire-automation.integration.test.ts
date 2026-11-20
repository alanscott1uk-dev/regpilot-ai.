import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {db} from '../lib/server/db';
import {hashValue} from '../lib/regulatory/intelligence';
import {assuranceFixture,future,rejects} from './helpers/assurance-fixture';
import {createAssuranceAnswer,changeAssuranceAnswer,createQuestionnaire,questionnaireWorkspace,questionnaireDetail,changeQuestionnaire,exportQuestionnaire,answerWorkspace,checkedAssuranceAnswers} from '../lib/server/customer-assurance-service';
import {automateQuestionnaire,questionnaireAutomation} from '../lib/server/questionnaire-automation-service';
import {transaction} from '../lib/server/intelligence-service';
import {prepareQuestionnaireDraft,questionnaireDrafts,saveQuestionnaireDraft} from '../lib/server/questionnaire-draft-service';

const scope='Fictional UK customer systems';
const question='How do you encrypt and restore customer backups?';
const response='Fictional customer backups are encrypted before storage and restored during a quarterly verification exercise. This is a test only.';
const notes='Independently checked the fictional wording, customer scope, review period and current supporting evidence before approval.';
type Fixture=Awaited<ReturnType<typeof assuranceFixture>>;
function configured(){Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture'});}
function importInput(x:Fixture,rows:unknown[],requestKey=randomUUID()){return {title:'Fictional buyer questionnaire',recipient:'Fictional UK buyer',scope,ownerId:x.ed.userId,requestKey,rows,confirm:true};}
async function approved(x:Fixture,fileId:string,overrides:Record<string,unknown>={}){const input={question,scope,answer:response,evidenceIds:[fileId],validUntil:future(60),confirm:true,...overrides};const answer=await createAssuranceAnswer(x.o,input);await changeAssuranceAnswer(x.ad,answer.id,{action:'APPROVE',version:1,notes,confirm:true},x.store);return {...answer,input};}
async function preview(x:Fixture,id:string){const detail=await questionnaireDetail(x.o,id);const result=await automateQuestionnaire(x.o,id,{operation:'PREVIEW',version:detail.questionnaire.version});assert.ok('previewToken' in result);return result;}
function source(row:number){return {filename:'fictional-buyer.xlsx',sha256:'b'.repeat(64),format:'XLSX' as const,sheet:'Security',row,questionCell:'C'+row,referenceCell:'A'+row,answerCell:'E'+row,contextCells:['D'+row]};}

test('structured imports preserve verified source coordinates and recover one canonical questionnaire under replay and concurrency',async()=>{
 const x=await assuranceFixture();configured();try{
  const row={reference:'SEC-1',question,instructions:'Explain the quarterly restoration test and any exceptions.',suppliedAnswer:'Original supplied text; it is not an approved response.',source:source(9)},input=importInput(x,[row]);
  const creates=await Promise.all([createQuestionnaire(x.o,input,{verifiedFile:row.source}),createQuestionnaire(x.o,input,{verifiedFile:row.source})]);
  assert.equal(creates[0].id,creates[1].id);assert.equal(creates.filter(result=>!result.reused).length,1);assert.equal(await db.assuranceQuestionnaire.count({where:{organizationId:x.a.id}}),1);
  const detail=await questionnaireDetail(x.o,creates[0].id);assert.deepEqual(detail.questions[0].source,row.source);assert.equal(detail.questions[0].instructions,row.instructions);assert.equal(detail.questions[0].suppliedAnswer,row.suppliedAnswer);assert.equal(detail.questions[0].status,'EMPTY');
  const recovery=await questionnaireWorkspace(x.o,input.requestKey);assert.equal(recovery.operation?.questionnaireId,creates[0].id);assert.equal(recovery.operation?.kind,'IMPORT');assert.equal((await questionnaireWorkspace(x.out,input.requestKey)).operation,null);
  await assert.rejects(()=>createQuestionnaire(x.o,{...input,title:'Changed buyer questionnaire'},{verifiedFile:row.source}),rejects(409));
  await assert.rejects(()=>createQuestionnaire(x.o,{...input,requestKey:randomUUID()},{verifiedFile:{filename:row.source.filename,sha256:'c'.repeat(64)}}),rejects(409));
  await assert.rejects(()=>createQuestionnaire(x.ed,input),rejects(403));
  await assert.rejects(()=>questionnaireDetail(x.out,creates[0].id),rejects(404));
  const manual=await createQuestionnaire(x.o,importInput(x,[row]));assert.equal((await questionnaireDetail(x.o,manual.id)).questions[0].source,undefined,'A client JSON source claim must not become verified file provenance');
  const gaps=(await questionnaireWorkspace(x.o)).recurringGaps;
  assert.equal(gaps?.length,1);
  assert.equal(gaps[0].questionnaireCount,2);
  assert.deepEqual(new Set(gaps[0].links.map(link=>link.questionnaireId)),new Set([creates[0].id,manual.id]));
  assert.deepEqual((await questionnaireWorkspace(x.out)).recurringGaps,[]);
  await assert.rejects(()=>createQuestionnaire(x.o,importInput(x,[row,{...row,question:'How are backup exceptions authorised and recorded?'}])),rejects(400));
 }finally{await x.cleanup();}
});

test('manual answer creation has exact read-only recovery and concurrent retries retain the original canonical draft',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),input={question,scope,answer:response,evidenceIds:[file.id],validUntil:future(60),requestKey:randomUUID(),confirm:true};
  const results=await Promise.all([createAssuranceAnswer(x.o,input),createAssuranceAnswer(x.o,input)]);
  assert.equal(results[0].id,results[1].id);assert.equal(results.filter(result=>!result.reused).length,1);assert.equal(await db.assuranceAnswer.count({where:{organizationId:x.a.id}}),1);
  const view=await answerWorkspace(x.o,input.requestKey);assert.equal(view.operation?.answerId,results[0].id);assert.equal(view.operation?.requestKey,input.requestKey);assert.equal((await answerWorkspace(x.ed,input.requestKey)).operation,null);assert.equal((await answerWorkspace(x.out,input.requestKey)).operation,null);
  await assert.rejects(()=>createAssuranceAnswer(x.o,{...input,answer:response+' This is different wording.'}),rejects(409));
  await changeAssuranceAnswer(x.ad,results[0].id,{action:'APPROVE',version:1,notes,confirm:true},x.store);
  assert.equal((await createAssuranceAnswer(x.o,input)).reused,true);assert.equal((await db.assuranceAnswer.findUniqueOrThrow({where:{id:results[0].id}})).status,'APPROVED');
 }finally{await x.cleanup();}
});

test('batch reuse previews full current answers, verifies canonical evidence and atomically suggests selected rows without approving them',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),a=await approved(x,file.id),secondQuestion='How are privileged accounts reviewed and removed?';
  const b=await approved(x,file.id,{question:secondQuestion,answer:'Fictional privileged accounts are reviewed against the current staff register and removed when their approved business need ends.'});
  const q=await createQuestionnaire(x.o,importInput(x,[{reference:'SEC-1',question,instructions:'Explain restoration exercises.',suppliedAnswer:'Not approved original buyer text.',source:source(9)},{reference:'SEC-2',question:secondQuestion,source:source(12)}]),{verifiedFile:source(9)});
  const auditCount=await db.auditEvent.count({where:{organizationId:x.a.id}}),evidenceCount=await db.evidence.count({where:{organizationId:x.a.id}}),prepared=await preview(x,q.id);
  assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id}}),auditCount,'Preview must write nothing');assert.equal(prepared.questions[0].classification,'AMBIGUOUS');assert.equal(prepared.questions[0].candidates[0].answer,response);assert.equal(prepared.questions[0].candidates[0].files[0].id,file.id);assert.equal(prepared.knowledgeHealth.current,2);assert.doesNotMatch(JSON.stringify(prepared),/storageKey|secret|bucket|credential/i);
  const input={operation:'APPLY',version:prepared.version,previewToken:prepared.previewToken,requestKey:randomUUID(),selections:[{questionId:prepared.questions[0].id,answerId:a.id},{questionId:prepared.questions[1].id,answerId:b.id}],confirm:true};
  const applied=await Promise.all([automateQuestionnaire(x.o,q.id,input,x.store),automateQuestionnaire(x.o,q.id,input,x.store)]);assert.equal(applied.filter(result=>'reused' in result&&!result.reused).length,1);
  let detail=await questionnaireDetail(x.o,q.id);assert.equal(detail.questionnaire.version,2);assert.deepEqual(detail.questions.map(question=>question.status),['SUGGESTED','SUGGESTED']);assert.equal(await db.evidence.count({where:{organizationId:x.a.id}}),evidenceCount);assert.equal(await db.assuranceAnswer.count({where:{organizationId:x.a.id}}),2);
  const recovery=await questionnaireAutomation(x.o,q.id,input.requestKey);assert.equal(recovery.operation?.applied,2);assert.equal(recovery.operation?.version,2);assert.equal(recovery.operation?.questionnaireId,q.id);
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,{...input,selections:[input.selections[0]]},x.store),rejects(409));
  await assert.rejects(()=>changeQuestionnaire(x.ad,q.id,{action:'APPROVE',version:2,notes,confirm:true},x.store),rejects(409));
  await assert.rejects(()=>changeQuestionnaire(x.o,q.id,{action:'ANSWER',version:2,questionId:detail.questions[0].id,answerId:a.id,confirm:true}),rejects(403));
  for(const [index,answer] of [a,b].entries()){await changeQuestionnaire(x.ed,q.id,{action:'ANSWER',version:detail.questionnaire.version,questionId:detail.questions[index].id,answerId:answer.id,confirm:true});detail=await questionnaireDetail(x.o,q.id);}
  await assert.rejects(()=>changeQuestionnaire(x.o,q.id,{action:'APPROVE',version:detail.questionnaire.version,notes,confirm:true},x.store),rejects(403));
  await changeQuestionnaire(x.ad,q.id,{action:'APPROVE',version:detail.questionnaire.version,notes,confirm:true},x.store);
  const exported=await exportQuestionnaire(x.ad,q.id,x.store);assert.equal(exported.questions[0].answer,response);assert.equal((exported.questions[0].source&&'questionCell' in exported.questions[0].source?exported.questions[0].source.questionCell:undefined),'C9');assert.equal(exported.questions[0].suppliedAnswer,'Not approved original buyer text.');assert.match(exported.csv,/quarterly verification/);
  const replay=await automateQuestionnaire(x.o,q.id,input,x.store);assert.ok('reused' in replay&&replay.reused);assert.equal((await questionnaireDetail(x.o,q.id)).questionnaire.status,'APPROVED');
 }finally{await x.cleanup();}
});

test('changed answers, current roles, evidence metadata and altered private bytes invalidate a batch without partial mutation',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),a=await approved(x,file.id),q=await createQuestionnaire(x.o,importInput(x,[{reference:'SEC-1',question,instructions:'Include exceptions.'}]));
  let prepared=await preview(x,q.id);const request=(token=prepared.previewToken)=>({operation:'APPLY',version:1,previewToken:token,requestKey:randomUUID(),selections:[{questionId:prepared.questions[0].id,answerId:a.id}],confirm:true});
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,request(),{...x.store,async get(){return new Uint8Array([0,1,2]);}}),rejects(409));
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ed.userId}},data:{role:'ADMIN'}});
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,request(),x.store),rejects(409));
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ed.userId}},data:{role:'EDITOR'}});
  prepared=await preview(x,q.id);
  const postReadRequest=request();let changed=false;
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,postReadRequest,{...x.store,async get(key){const bytes=await x.store.get(key);if(!changed){changed=true;await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.o.userId}},data:{role:'EDITOR'}});}return bytes;}}),rejects(403));
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.o.userId}},data:{role:'OWNER'}});
  assert.equal((await questionnaireAutomation(x.o,q.id,postReadRequest.requestKey)).operation,null);
  prepared=await preview(x,q.id);await changeAssuranceAnswer(x.o,a.id,{...a.input,action:'REVISE',version:2,answer:response+' The process now has a different review schedule.'});
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,request(),x.store),rejects(409));
  await changeAssuranceAnswer(x.ad,a.id,{action:'APPROVE',version:3,notes,confirm:true},x.store);prepared=await preview(x,q.id);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});await assert.rejects(()=>automateQuestionnaire(x.o,q.id,request(),x.store),rejects(409));
  const detail=await questionnaireDetail(x.o,q.id);assert.equal(detail.questionnaire.version,1);assert.equal(detail.questions[0].status,'EMPTY');assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id,action:'customer_assurance.reuse_completed'}}),0);
 }finally{await x.cleanup();}
});

test('knowledge gaps distinguish conflicting, expired and stale approvals and never expose foreign-scope candidates',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),a=await approved(x,file.id);await approved(x,file.id,{answer:'Fictional backups are presently unencrypted; a future project will introduce encryption and restoration verification.'});
  const expiredQuestion='How is emergency business recovery tested?',expired=await approved(x,file.id,{question:expiredQuestion});
  const expiredRow=await db.assuranceAnswer.findUniqueOrThrow({where:{id:expired.id}}),past=new Date(Date.now()-86400000);
  await db.assuranceAnswer.update({where:{id:expired.id},data:{validUntil:past,contentHash:hashValue({question:expiredRow.question,scope:expiredRow.scope,answer:expiredRow.answer,files:expiredRow.files,validUntil:past.toISOString()})}});
  await approved(x,file.id,{scope:'A separate customer scope',question:'How do you inspect lifting machinery safety?'});
  const q=await createQuestionnaire(x.o,importInput(x,[{reference:'CONFLICT',question},{reference:'EXPIRED',question:expiredQuestion},{reference:'GAP',question:'How do you inspect lifting machinery safety?'}]));
  let view=await questionnaireAutomation(x.o,q.id);assert.equal(view.questions[0].classification,'CONFLICTING');assert.equal(view.questions[0].recommendedAnswerId,null);assert.equal(view.questions[1].classification,'EXPIRED');assert.ok(view.questions[1].candidates.every(candidate=>!candidate.selectable));assert.equal(view.questions[2].classification,'UNANSWERED');assert.equal(view.questions[2].candidates.length,0);assert.equal(view.knowledgeHealth.expired,1);
  await db.assuranceAnswer.update({where:{id:a.id},data:{files:[{id:randomUUID(),filename:'foreign-secret.pdf'}] as Prisma.InputJsonValue}});
  view=await questionnaireAutomation(x.o,q.id);const corrupt=view.questions[0].candidates.find(candidate=>candidate.id===a.id);assert.equal(corrupt?.current,false);assert.deepEqual(corrupt?.files,[]);assert.doesNotMatch(JSON.stringify(view),/foreign-secret/);assert.equal(view.knowledgeHealth.stale,1);
  await assert.rejects(()=>questionnaireAutomation(x.out,q.id),rejects(404));await assert.rejects(()=>questionnaireAutomation(x.re,q.id),rejects(404));await assert.rejects(()=>automateQuestionnaire(x.ed,q.id,{operation:'PREVIEW',version:1}),rejects(403));
 }finally{await x.cleanup();}
});

test('confirmed answers require renewed owner confirmation after reassignment and approved disclosure follows current participant authority',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),a=await approved(x,file.id),q=await createQuestionnaire(x.o,importInput(x,[{reference:'SEC-1',question}]));
  let detail=await questionnaireDetail(x.o,q.id),questionId=detail.questions[0].id;
  await changeQuestionnaire(x.ed,q.id,{action:'ANSWER',version:1,questionId,answerId:a.id,confirm:true});
  const readyPreview=await preview(x,q.id);
  await assert.rejects(()=>automateQuestionnaire(x.o,q.id,{operation:'APPLY',version:2,previewToken:readyPreview.previewToken,requestKey:randomUUID(),selections:[{questionId,answerId:a.id}],confirm:true},x.store),rejects(409));
  await changeQuestionnaire(x.o,q.id,{action:'ASSIGN',version:2,questionId,ownerId:x.re.userId});detail=await questionnaireDetail(x.o,q.id);assert.equal(detail.questions[0].status,'SUGGESTED');assert.equal(detail.questions[0].changedById,null);
  await changeQuestionnaire(x.re,q.id,{action:'ANSWER',version:3,questionId,answerId:a.id,confirm:true});await changeQuestionnaire(x.ad,q.id,{action:'APPROVE',version:4,notes,confirm:true},x.store);assert.equal((await questionnaireDetail(x.o,q.id)).current,true);
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ad.userId}},data:{role:'EDITOR'}});
  assert.equal((await questionnaireDetail(x.o,q.id)).current,false);await assert.rejects(()=>exportQuestionnaire(x.o,q.id,x.store),rejects(409));
  const health=await answerWorkspace(x.o);assert.equal(health.knowledgeHealth.stale,1);assert.equal(health.answers[0].current,false);
 }finally{await x.cleanup();}
});

test('the complete 300-answer library uses bounded queries and retains exact file, role and tenant freshness checks',async()=>{
 const x=await assuranceFixture();configured();try{
  const file=await x.file(),a=await approved(x,file.id),base=await db.assuranceAnswer.findUniqueOrThrow({where:{id:a.id}});
  const data=Array.from({length:299},(_,index)=>{
   const content={question:'How is fictional business control '+index+' reviewed and supported?',scope,answer:response,files:base.files,validUntil:base.validUntil.toISOString()};
   return {organizationId:x.a.id,createdById:x.o.userId,reviewerId:x.ad.userId,question:content.question,scope,answer:response,files:base.files as Prisma.InputJsonValue,validUntil:base.validUntil,contentHash:hashValue(content),status:'APPROVED',version:2,reviewedAt:new Date()};
  });
  await db.assuranceAnswer.createMany({data});
  const rows=await db.assuranceAnswer.findMany({where:{organizationId:x.a.id},orderBy:{id:'asc'}});assert.equal(rows.length,300);
  let evidenceReads=0,participantReads=0;
  const checked=await transaction(x.o,async tx=>{
   const counted=new Proxy(tx,{get(target,property,receiver){
    if(property==='evidence')return {findMany:(args:Prisma.EvidenceFindManyArgs)=>{evidenceReads++;assert.equal(args.where?.organizationId,x.a.id);assert.equal((args.select as Record<string,unknown>)?.storageKey,undefined);return target.evidence.findMany(args);}};
    if(property==='$queryRaw')return (...args:unknown[])=>{participantReads++;return Reflect.apply(target.$queryRaw,target,args);};
    if(property==='assuranceAnswer')throw Error('The bulk projection must not read answers one at a time');
    return Reflect.get(target,property,receiver);
   }});
   return checkedAssuranceAnswers(counted,x.a.id,rows);
  });
  assert.equal(checked.filter(answer=>answer.current).length,300);assert.equal(evidenceReads,1);assert.equal(participantReads,1);
  await assert.rejects(()=>transaction(x.o,tx=>checkedAssuranceAnswers(tx,x.a.id,[...rows,rows[0]])),rejects(409));
  await assert.rejects(()=>transaction(x.o,tx=>checkedAssuranceAnswers(tx,x.a.id,[{...rows[0],organizationId:x.b.id}])),rejects(404));
  const q=await createQuestionnaire(x.o,importInput(x,[{reference:'SEC-1',question}]));assert.equal((await questionnaireAutomation(x.o,q.id)).knowledgeHealth.current,300);
  const foreignTask=await db.obligation.create({data:{organizationId:x.b.id,title:'Fictional foreign evidence task',category:'Internal',ownerName:x.foreign.email,dueDate:new Date()}}),originalFile=await db.evidence.findUniqueOrThrow({where:{id:file.id}});
  const foreignFile=await db.evidence.create({data:{...originalFile,id:randomUUID(),organizationId:x.b.id,obligationId:foreignTask.id,filename:'foreign-protected.pdf',storageKey:'foreign-private-object'}});
  const forgedFiles=[{...(base.files as Prisma.JsonArray)[0] as Prisma.JsonObject,id:foreignFile.id,filename:foreignFile.filename}];
  const changed=rows.find(answer=>answer.id!==a.id)!;
  await db.assuranceAnswer.update({where:{id:changed.id},data:{files:forgedFiles,contentHash:hashValue({question:changed.question,scope:changed.scope,answer:changed.answer,files:forgedFiles,validUntil:changed.validUntil.toISOString()})}});
  let view=await questionnaireAutomation(x.o,q.id);assert.equal(view.knowledgeHealth.current,299);assert.equal(view.knowledgeHealth.stale,1);assert.doesNotMatch(JSON.stringify(view),/foreign-protected|foreign-private-object/);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});view=await questionnaireAutomation(x.o,q.id);assert.equal(view.knowledgeHealth.current,0);assert.equal(view.knowledgeHealth.stale,300);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:originalFile.reviewVersion}});
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ad.userId}},data:{role:'EDITOR'}});view=await questionnaireAutomation(x.o,q.id);assert.equal(view.knowledgeHealth.current,0);assert.equal(view.knowledgeHealth.stale,300);
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.ad.userId}},data:{role:'ADMIN'}});
  const separate=rows.find(answer=>answer.id!==a.id&&answer.id!==changed.id)!;
  await db.assuranceAnswer.update({where:{id:separate.id},data:{scope:'Separate customer scope',contentHash:hashValue({question:separate.question,scope:'Separate customer scope',answer:separate.answer,files:separate.files,validUntil:separate.validUntil.toISOString()})}});
  view=await questionnaireAutomation(x.o,q.id);assert.equal(view.knowledgeHealth.total,299);assert.ok(view.questions.flatMap(question=>question.candidates).every(candidate=>candidate.scope===scope));
 }finally{await x.cleanup();}
});

test('the latest eligible saved response is reachable from its exact originating question among more than five approved variants',async()=>{
 const x=await assuranceFixture();configured();process.env.REGPILOT_ASSURANCE_ENABLED='true';try{
  const wording='How do you retain assurance documents?',firstFile=await x.file(),prior=await approved(x,firstFile.id,{question:wording}),q=await createQuestionnaire(x.o,importInput(x,[{reference:'SEC-1',question:wording},{reference:'SEC-2',question:wording}]));
  const detail=await questionnaireDetail(x.ed,q.id),questionId=detail.questions[0].id;
  async function prepareAndSave(fileId:string,text:string){
   const prepared=await prepareQuestionnaireDraft(x.ed,q.id,{questionId,questionnaireVersion:1,evidenceIds:[fileId],method:'CONTENT_SEARCH',requestKey:randomUUID(),confirm:true},{storage:x.store});
   const draft=(await questionnaireDrafts(x.ed,q.id,{runId:prepared.id})).drafts[0];assert.ok(draft.result?.citations.length);
   const saved=await saveQuestionnaireDraft(x.ed,q.id,prepared.id,{action:'SAVE_ANSWER',version:draft.version,answer:text,validUntil:future(30),reviewedSupport:true,confirm:true},{storage:x.store});
   return {runId:prepared.id,answerId:saved.answerId!};
  }
  const first=await prepareAndSave(firstFile.id,'The supplied fictional assurance document is retained for independent review. Its content does not establish further implemented controls.');
  await changeAssuranceAnswer(x.ad,first.answerId,{action:'APPROVE',version:1,notes,confirm:true},x.store);
  const template=await db.assuranceAnswer.findUniqueOrThrow({where:{id:prior.id}});
  const variants=Array.from({length:8},(_,index)=>{
   const answer='Earlier fictional response '+index+' records the available assurance document and explains its particular review limitations.',id='00000000-0000-4000-8000-'+String(index+1).padStart(12,'0');
   return {id,organizationId:x.a.id,createdById:x.o.userId,reviewerId:x.ad.userId,question:wording,scope,answer,files:template.files as Prisma.InputJsonValue,validUntil:template.validUntil,status:'APPROVED',version:2,reviewedAt:new Date(),contentHash:hashValue({question:wording,scope,answer,files:template.files,validUntil:template.validUntil.toISOString()})};
  });
  await db.assuranceAnswer.createMany({data:variants});
  const original=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:first.runId}});
  let view=await questionnaireAutomation(x.o,q.id),origin=view.questions.find(question=>question.id===questionId)!;
  assert.equal(origin.candidates.length,5);assert.equal(origin.candidates[0].id,first.answerId);assert.ok(origin.candidates.some(candidate=>candidate.id===prior.id));assert.equal(origin.classification,'CONFLICTING');assert.equal(origin.recommendedAnswerId,null);
  assert.ok(!view.questions[1].candidates.some(candidate=>candidate.id===first.answerId),'An origin pin must not transfer to another question with identical wording');
  const other=await createQuestionnaire(x.o,importInput(x,[{reference:'OTHER',question:wording}]));assert.ok(!(await questionnaireAutomation(x.o,other.id)).questions[0].candidates.some(candidate=>candidate.id===first.answerId));
  await assert.rejects(()=>questionnaireAutomation(x.out,q.id),rejects(404));
  await db.questionnaireDraftRun.update({where:{id:first.runId},data:{resultHash:'f'.repeat(64)}});view=await questionnaireAutomation(x.o,q.id);assert.ok(!view.questions[0].candidates.some(candidate=>candidate.id===first.answerId),'An invalid saved result must not acquire origin priority');
  await db.questionnaireDraftRun.update({where:{id:first.runId},data:{resultHash:original.resultHash}});
  const changedContext=structuredClone(original.context) as Record<string,any>;changedContext.question.instructions='A different customer instruction that is not present in this question';
  await db.questionnaireDraftRun.update({where:{id:first.runId},data:{context:changedContext,inputHash:hashValue(changedContext)}});assert.ok(!(await questionnaireAutomation(x.o,q.id)).questions[0].candidates.some(candidate=>candidate.id===first.answerId),'A different instruction context must not acquire origin priority');
  await db.questionnaireDraftRun.update({where:{id:first.runId},data:{context:original.context as Prisma.InputJsonValue,inputHash:original.inputHash}});
  const secondFile=await x.file(),later=await prepareAndSave(secondFile.id,'The newer fictional assurance document is retained with its recorded supporting quotations. Further implemented controls require separate evidence.');
  view=await questionnaireAutomation(x.o,q.id);assert.equal(view.questions[0].candidates[0].id,first.answerId,'An unapproved newer answer must not displace the approved origin');assert.ok(!view.questions[0].candidates.some(candidate=>candidate.id===later.answerId&&candidate.selectable));
  await changeAssuranceAnswer(x.ad,later.answerId,{action:'APPROVE',version:1,notes,confirm:true},x.store);
  view=await questionnaireAutomation(x.ed,q.id);assert.equal(view.questions[0].candidates[0].id,later.answerId);assert.ok(view.questions[0].candidates[0].current);
  const stale=await preview(x,q.id),apply={operation:'APPLY',version:stale.version,previewToken:stale.previewToken,requestKey:randomUUID(),selections:[{questionId,answerId:later.answerId}],confirm:true};
  await db.questionnaireDraftRun.update({where:{id:later.runId},data:{version:{increment:1}}});await assert.rejects(()=>automateQuestionnaire(x.o,q.id,apply,x.store),rejects(409));
  const fresh=await preview(x,q.id);assert.equal(fresh.questions[0].candidates[0].id,later.answerId);await automateQuestionnaire(x.o,q.id,{...apply,previewToken:fresh.previewToken,requestKey:randomUUID()},x.store);
  const saved=await questionnaireDetail(x.ed,q.id);assert.equal(saved.questions[0].answerId,later.answerId);assert.equal(saved.questions[0].status,'SUGGESTED');assert.equal(saved.questions[0].changedById,null);
  await changeAssuranceAnswer(x.ad,later.answerId,{action:'WITHDRAW',version:2,notes,confirm:true},x.store);view=await questionnaireAutomation(x.o,q.id);assert.equal(view.questions[0].candidates[0].id,first.answerId);assert.ok(!view.questions[0].candidates.some(candidate=>candidate.id===later.answerId&&candidate.selectable));
 }finally{await x.cleanup();}
});
