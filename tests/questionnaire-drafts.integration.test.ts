import "./helpers/paid-fixture";
import test from "node:test";import assert from "node:assert/strict";import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {assuranceFixture,rejects,future} from "./helpers/assurance-fixture";
import {createQuestionnaire,questionnaireDetail,changeAssuranceAnswer} from "../lib/server/customer-assurance-service";
import {prepareQuestionnaireDraft,questionnaireDrafts,saveQuestionnaireDraft} from "../lib/server/questionnaire-draft-service";
import {hashValue} from "../lib/regulatory/intelligence";
import type {Prisma} from "@prisma/client";
const config=()=>Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_ASSURANCE_ENABLED:"true",REGPILOT_ASSURANCE_AI_ENABLED:"true",REGPILOT_QUESTIONNAIRE_AI_ENABLED:"true",REGPILOT_AI_ENABLED:"true",REGPILOT_AI_SAFEGUARDS_VERIFIED:"true",REGPILOT_AI_PROCESSOR_REVIEWED:"true",REGPILOT_AI_TRANSFER_REVIEWED:"true",REGPILOT_AI_INTENDED_USE_REVIEWED:"true",REGPILOT_AI_MODEL:"test/fictional",AI_GATEWAY_API_KEY:"fixture-never-used",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_DAILY_USER_LIMIT:"10",REGPILOT_AI_DAILY_ORG_LIMIT:"20"});
async function setup(){const x=await assuranceFixture();config();const f=await x.file(),q=await createQuestionnaire(x.o,{title:"Fictional evidence questionnaire",recipient:"Fictional recipient",scope:"Fictional UK service",ownerId:x.ed.userId,csv:'reference,question\nQ1,How do you retain assurance documents?\nQ2,How are your records independently checked?',confirm:true}),d=await questionnaireDetail(x.ed,q.id);return {...x,f,q,d};}
const input=(questionId:string,file:string)=>({questionId,questionnaireVersion:1,evidenceIds:[file],method:"CONTENT_SEARCH",requestKey:randomUUID(),confirm:true});
test("persistent private drafting: real PDF quotations, tenant and owner authority, atomic DRAFT save, retry and independent approval",async()=>{
 const x=await setup();try{
  const request=input(x.d.questions[0].id,x.f.id);await assert.rejects(()=>prepareQuestionnaireDraft(x.out,x.q.id,request,{storage:x.store}),rejects(404));await assert.rejects(()=>prepareQuestionnaireDraft(x.ad,x.q.id,request,{storage:x.store}),rejects(403));
  const prepared=await prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store});assert.equal(prepared.status,"DRAFT");assert.equal((await prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store})).reused,true);
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,questionId:x.d.questions[1].id},{storage:x.store}),rejects(409));await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID()},{storage:x.store}),rejects(409));
  const view=await questionnaireDrafts(x.ed,x.q.id,{requestKey:request.requestKey}),run=view.drafts[0];assert.equal(run.current,true);assert.equal(run.result!.answer,"");assert.ok(run.result!.citations[0].quote.includes("Fictional assurance document"));assert.equal(run.canSave,true);assert.equal((await questionnaireDrafts(x.re,x.q.id).catch((e:any)=>e.status)),404);
  const save={action:"SAVE_ANSWER",version:run.version,answer:"The supplied fictional assurance document is retained for review. Its content does not establish any further implemented controls.",validUntil:future(30),reviewedSupport:true,confirm:true};
  await assert.rejects(()=>saveQuestionnaireDraft(x.ed,x.q.id,run.id,save,{storage:{...x.store,async get(){return Uint8Array.from([0]);}}}),rejects(409));assert.equal(await db.assuranceAnswer.count({where:{organizationId:x.a.id}}),0);
  const saved=await saveQuestionnaireDraft(x.ed,x.q.id,run.id,save,{storage:x.store});assert.equal((await saveQuestionnaireDraft(x.ed,x.q.id,run.id,save,{storage:x.store})).answerId,saved.answerId);assert.equal(await db.assuranceAnswer.count({where:{organizationId:x.a.id}}),1);
  await assert.rejects(()=>saveQuestionnaireDraft(x.ed,x.q.id,run.id,{...save,answer:save.answer+" Changed."},{storage:x.store}),rejects(409));
  const answer=await db.assuranceAnswer.findUniqueOrThrow({where:{id:saved.answerId!}});assert.equal(answer.status,"DRAFT");assert.equal((await questionnaireDetail(x.ed,x.q.id)).questions[0].status,"EMPTY");
  await assert.rejects(()=>changeAssuranceAnswer(x.ed,answer.id,{action:"APPROVE",version:1,notes:"Reviewed this fictional answer against the supplied evidence.",confirm:true},x.store),rejects(403));await changeAssuranceAnswer(x.ad,answer.id,{action:"APPROVE",version:1,notes:"Independently reviewed this fictional answer against the supplied evidence.",confirm:true},x.store);
  const events=await db.auditEvent.findMany({where:{organizationId:x.a.id,entityType:"QuestionnaireDraftRun"}});assert.doesNotMatch(JSON.stringify(events),/Fictional assurance document|storageKey/);
 }finally{await x.cleanup();}
});
test("AI preparation is metered once across concurrent/replayed requests and becomes stale when source review changes",async()=>{
 const x=await setup();try{
  let calls=0;const generate=async(args:any)=>{calls++;const doc=args.documents[0],quote=doc.document.pages[0].text;return {paragraphs:[{text:"The supplied fictional document records an assurance document for independent review.",citations:[{evidenceId:doc.id,unit:1,quote}]}],gaps:["This document does not establish completed operational controls."],limitations:[]};};
  const request={...input(x.d.questions[0].id,x.f.id),method:"AI"},pair=await Promise.all([prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store,generate}),prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store,generate})]);assert.equal(pair[0].id,pair[1].id);assert.equal(calls,1);assert.equal((await db.aiDailyUsage.aggregate({where:{organizationId:x.a.id},_sum:{count:true}}))._sum.count,1);
  let view=await questionnaireDrafts(x.ed,x.q.id);assert.equal(view.drafts[0].result!.status,"DRAFT");assert.equal(view.drafts[0].current,true);
  await db.evidence.update({where:{id:x.f.id},data:{reviewVersion:{increment:1}}});view=await questionnaireDrafts(x.ed,x.q.id);assert.equal(view.drafts[0].current,false);
  await assert.rejects(()=>saveQuestionnaireDraft(x.ed,x.q.id,pair[0].id,{action:"SAVE_ANSWER",version:view.drafts[0].version,answer:view.drafts[0].result!.answer,validUntil:future(),reviewedSupport:true,confirm:true},{storage:x.store}),rejects(409));
  const fresh={...request,requestKey:randomUUID()};await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,fresh,{storage:x.store,generate:async()=>{calls++;throw Error("Fictional provider failure");}}),rejects(502));const failed=await questionnaireDrafts(x.ed,x.q.id,{requestKey:fresh.requestKey});assert.equal(failed.drafts[0].status,"FAILED");await prepareQuestionnaireDraft(x.ed,x.q.id,fresh,{storage:x.store,generate});assert.equal(calls,2);
 }finally{await db.aiDailyUsage.deleteMany({where:{organizationId:x.a.id}});await x.cleanup();}
});
test("in-flight context change and interrupted attempts cannot publish a misleading or duplicate draft",async()=>{
 const x=await setup();try{
  const request={...input(x.d.questions[0].id,x.f.id),method:"AI"};await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store,generate:async(args:any)=>{await db.assuranceQuestionnaire.update({where:{id:x.q.id},data:{scope:"A changed business scope"}});return {paragraphs:[{text:"The supplied fictional assurance document is available for review.",citations:[{evidenceId:x.f.id,unit:1,quote:args.documents[0].document.pages[0].text}]}],gaps:[],limitations:[]};}}),rejects(409));
  const run=await db.questionnaireDraftRun.findFirstOrThrow({where:{questionnaireId:x.q.id}});assert.equal(run.status,"FAILED");assert.equal(run.result,null);
  await db.questionnaireDraftRun.update({where:{id:run.id},data:{status:"PROCESSING",failureCode:null,createdAt:new Date(Date.now()-180000)}});const view=await questionnaireDrafts(x.ed,x.q.id);assert.equal(view.drafts[0].status,"FAILED");assert.equal(view.drafts[0].failureCode,"INTERRUPTED");
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.editor.id}},data:{role:"VIEWER"}});await assert.rejects(()=>questionnaireDrafts(x.ed,x.q.id),rejects(403));
 }finally{await db.aiDailyUsage.deleteMany({where:{organizationId:x.a.id}});await x.cleanup();}
});
test("a full 100-run history uses one current snapshot and isolates stale text, permissions, foreign files and invalid results",async()=>{
 const x=await assuranceFixture();config();try{
  const first=await x.file(),second=await x.file();
  const q=await createQuestionnaire(x.o,{title:"Fictional full questionnaire history",recipient:"Fictional recipient",scope:"Fictional UK service",ownerId:x.ed.userId,csv:'reference,question\n'+Array.from({length:100},(_,i)=>`Q${i},How is fictional assurance document ${i} retained?`).join('\n'),confirm:true});
  const detail=await questionnaireDetail(x.ed,q.id);
  const firstRun=await prepareQuestionnaireDraft(x.ed,q.id,input(detail.questions[0].id,first.id),{storage:x.store});
  const secondRun=await prepareQuestionnaireDraft(x.ed,q.id,input(detail.questions[1].id,second.id),{storage:x.store});
  const templates=await Promise.all([firstRun,secondRun].map(run=>db.questionnaireDraftRun.findUniqueOrThrow({where:{id:run.id}})));
  const records:Prisma.QuestionnaireDraftRunCreateManyInput[]=detail.questions.slice(2).map((question,index)=>{
   const template=templates[index+2>=50?1:0],context=structuredClone(template.context) as any;
   context.question={id:question.id,reference:question.reference,question:question.question,instructions:question.instructions||"",ownerId:question.ownerId};
   return {id:randomUUID(),organizationId:x.a.id,questionnaireId:q.id,questionId:question.id,createdById:x.ed.userId,requestKey:randomUUID(),requestHash:hashValue({fixture:question.id}),inputHash:hashValue(context),engineVersion:template.engineVersion,method:template.method,status:"DRAFT",version:2,evidenceManifest:template.evidenceManifest as Prisma.InputJsonValue,context,result:template.result as Prisma.InputJsonValue,resultHash:template.resultHash,createdAt:new Date(Date.now()-(index+2)*1000)};
  });
  await db.questionnaireDraftRun.createMany({data:records});
  let view=await questionnaireDrafts(x.o,q.id);assert.equal(view.drafts.length,100);assert.equal(view.drafts.filter(run=>run.current).length,100,'every unmodified snapshot remains current at the supported history limit');
  const byQuestion=(index:number)=>view.drafts.find(run=>run.questionId===detail.questions[index].id)!;
  const saved=await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:q.id}}),changed=structuredClone(saved.questions) as any[];
  changed[10].question+=' Include the latest review.';changed[11].instructions='Limit the response to the newest business scope.';changed[30].ownerId=x.re.userId;
  await db.assuranceQuestionnaire.update({where:{id:q.id},data:{questions:changed,version:{increment:1}}});
  await db.evidence.update({where:{id:second.id},data:{reviewVersion:{increment:1}}});
  const originalFile=await db.evidence.findUniqueOrThrow({where:{id:first.id}}),foreignTask=await db.obligation.create({data:{organizationId:x.b.id,title:"Foreign questionnaire fixture",category:"Internal",ownerName:x.foreign.email,dueDate:new Date()}});
  const foreignFile=await db.evidence.create({data:{...originalFile,id:randomUUID(),organizationId:x.b.id,obligationId:foreignTask.id,filename:'private-foreign-questionnaire-source.pdf',storageKey:'fixture-only-'+randomUUID()}});
  const foreignRun=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:byQuestion(20).id}}),foreignContext=structuredClone(foreignRun.context) as any;
  foreignContext.files[0]={...foreignContext.files[0],id:foreignFile.id,filename:foreignFile.filename};
  await db.questionnaireDraftRun.update({where:{id:foreignRun.id},data:{context:foreignContext,evidenceManifest:foreignContext.files,inputHash:hashValue(foreignContext)}});
  const wrongModel=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:byQuestion(25).id}}),wrongModelContext=structuredClone(wrongModel.context) as any;wrongModelContext.model='wrong/recorded-model';
  await db.questionnaireDraftRun.update({where:{id:wrongModel.id},data:{context:wrongModelContext,inputHash:hashValue(wrongModelContext)}});
  await db.questionnaireDraftRun.update({where:{id:byQuestion(15).id},data:{resultHash:'f'.repeat(64)}});
  view=await questionnaireDrafts(x.o,q.id);assert.equal(view.drafts.length,100);assert.equal(byQuestion(31).current,true);
  for(const index of [1,10,11,15,20,25,30,50,99])assert.equal(byQuestion(index).current,false,'changed record '+index+' must not remain current');
  assert.equal(byQuestion(15).result,null,'failed result integrity must not expose an unverified proposal');
  assert.doesNotMatch(JSON.stringify(view),/private-foreign-questionnaire-source/,'current evidence projection never reads foreign organization metadata');
  const reassigned=await questionnaireDrafts(x.re,q.id);assert.equal(reassigned.drafts.length,1);assert.equal(reassigned.drafts[0].questionId,detail.questions[30].id);assert.equal(reassigned.drafts[0].canSave,false);
  await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.admin.id}},data:{role:"OWNER"}});
  view=await questionnaireDrafts(x.o,q.id);assert.equal(view.drafts.filter(run=>run.current).length,0,'even an eligible reviewer role change invalidates the captured participant snapshot');
 }finally{await x.cleanup();}
});
