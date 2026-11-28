import './helpers/paid-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects,future} from './helpers/assurance-fixture';
import {createProduct,changeProduct,setEvidenceApplicability} from '../lib/server/product-service';
import {createQuestionnaire,questionnaireDetail,changeAssuranceAnswer} from '../lib/server/customer-assurance-service';
import {prepareQuestionnaireDraft,questionnaireDrafts,saveQuestionnaireDraft,savedQuestionnaireAnswerOrigin} from '../lib/server/questionnaire-draft-service';

test('product-aware preparation fences evidence, preserves legacy hashes and invalidates only relevant product context',async()=>{
 const x=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',REGPILOT_ASSURANCE_ENABLED:'true',REGPILOT_AI_ENABLED:'false',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture'});
 try{
  const file=await x.file(),legacyFile=await x.file();
  const makeQuestionnaire=(productIds?:string[])=>createQuestionnaire(x.o,{title:'Fictional product assurance',recipient:'Fictional customer',scope:'Fictional UK service',ownerId:x.ed.userId,csv:'reference,question\nQ1,How are fictional assurance documents retained?',...(productIds?{productIds}:{}),confirm:true});
  const legacy=await makeQuestionnaire(),legacyQuestion=(await questionnaireDetail(x.ed,legacy.id)).questions[0];
  const prepare=(id:string,questionId:string,evidenceId:string)=>prepareQuestionnaireDraft(x.ed,id,{questionId,questionnaireVersion:1,evidenceIds:[evidenceId],method:'CONTENT_SEARCH',requestKey:randomUUID(),confirm:true},{storage:x.store});
  const legacyRun=await prepare(legacy.id,legacyQuestion.id,legacyFile.id),legacySaved=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:legacyRun.id}});
  assert.equal(Object.hasOwn(legacySaved.context as object,'productContext'),false,'legacy snapshots retain their original hash representation');
  const a=await createProduct(x.o,{code:'FPA',name:'Fictional Product A',description:'First fictional service',requestKey:randomUUID(),confirm:true}),b=await createProduct(x.o,{code:'FPB',name:'Fictional Product B',description:'Second fictional service',requestKey:randomUUID(),confirm:true});
  assert.equal((await questionnaireDrafts(x.ed,legacy.id)).drafts[0].current,true,'adding a product catalogue does not invalidate a legacy draft');
  async function scopeTo(productId:string){const current=await db.evidence.findUniqueOrThrow({where:{id:file.id}});return setEvidenceApplicability(x.o,{evidenceId:file.id,reviewVersion:current.reviewVersion,mode:'PRODUCT',productIds:[productId],notes:'The reviewed document applies exclusively to the selected fictional product.',requestKey:randomUUID(),confirm:true});}
  await scopeTo(a.id);
  const questionnaire=await makeQuestionnaire([a.id,b.id]),detail=await questionnaireDetail(x.ed,questionnaire.id),qa=detail.questions.find(q=>q.productId===a.id)!,qb=detail.questions.find(q=>q.productId===b.id)!;
  assert.equal(detail.questions.length,2);assert.ok(qa&&qb);assert.notEqual(qa.id,qb.id);
  let view=await questionnaireDrafts(x.ed,questionnaire.id);
  assert.ok(view.evidenceByQuestion[qa.id].some(f=>f.id===file.id));assert.equal(view.evidenceByQuestion[qb.id].some(f=>f.id===file.id),false);
  await assert.rejects(()=>prepare(questionnaire.id,qb.id,file.id),rejects(409));
  const prepared=await prepare(questionnaire.id,qa.id,file.id);view=await questionnaireDrafts(x.ed,questionnaire.id);const draft=view.drafts.find(run=>run.id===prepared.id)!;assert.equal(draft.current,true);
  const saved=await saveQuestionnaireDraft(x.ed,questionnaire.id,prepared.id,{action:'SAVE_ANSWER',version:draft.version,answer:'The supplied fictional assurance document is retained for Product A review. It does not establish any additional implemented controls.',validUntil:future(30),reviewedSupport:true,confirm:true},{storage:x.store});
  const answer=await db.assuranceAnswer.findUniqueOrThrow({where:{id:saved.answerId!}});assert.equal(answer.productId,a.id);assert.equal((answer.productContext as any).mode,'PRODUCT');
  const origin=savedQuestionnaireAnswerOrigin(await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:prepared.id}}));assert.equal(origin.productId,a.id);assert.equal(origin.productContext?.product.name,'Fictional Product A');
  await changeAssuranceAnswer(x.ad,answer.id,{action:'APPROVE',version:1,notes:'Independently reviewed the exact Product A wording, scope and supporting fictional document.',confirm:true},x.store);
  await changeProduct(x.o,b.id,{action:'UPDATE',version:1,code:'FPB',name:'Fictional Product B renamed',description:'Revised unrelated service',notes:'Rename the unrelated fictional product without changing Product A.',confirm:true});
  view=await questionnaireDrafts(x.ed,questionnaire.id);assert.equal(view.drafts.find(run=>run.id===prepared.id)!.current,true,'unrelated product metadata must not stale Product A');
  await scopeTo(b.id);view=await questionnaireDrafts(x.ed,questionnaire.id);assert.equal(view.drafts.find(run=>run.id===prepared.id)!.current,false,'moving evidence out of Product A invalidates its prior draft');
  await scopeTo(a.id);
  const refreshed=await makeQuestionnaire([a.id]),freshQuestion=(await questionnaireDetail(x.ed,refreshed.id)).questions[0],freshDraft=await prepare(refreshed.id,freshQuestion.id,file.id);
  assert.equal((await questionnaireDrafts(x.ed,refreshed.id)).drafts[0].current,true);
  await changeProduct(x.o,a.id,{action:'UPDATE',version:1,code:'FPA',name:'Fictional Product A revised',description:'The selected product scope changed',notes:'Change the selected fictional product and require fresh preparation.',confirm:true});
  const stale=(await questionnaireDrafts(x.ed,refreshed.id)).drafts.find(run=>run.id===freshDraft.id)!;assert.equal(stale.current,false);assert.equal(stale.canSave,false);
  assert.equal((await questionnaireDrafts(x.ed,legacy.id)).drafts[0].current,true);assert.equal((await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:legacyRun.id}})).inputHash,legacySaved.inputHash);
 }finally{await x.cleanup();}
});
