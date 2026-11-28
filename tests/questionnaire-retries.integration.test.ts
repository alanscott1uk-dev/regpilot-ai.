import "./helpers/paid-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {createQuestionnaire,questionnaireDetail} from "../lib/server/customer-assurance-service";
import {prepareQuestionnaireDraft,questionnaireDrafts} from "../lib/server/questionnaire-draft-service";

async function setup(){
 const x=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_EVIDENCE_ENABLED:"true",REGPILOT_ASSURANCE_ENABLED:"true",REGPILOT_ASSURANCE_AI_ENABLED:"true",REGPILOT_QUESTIONNAIRE_AI_ENABLED:"true",REGPILOT_AI_ENABLED:"true",REGPILOT_AI_SAFEGUARDS_VERIFIED:"true",REGPILOT_AI_PROCESSOR_REVIEWED:"true",REGPILOT_AI_TRANSFER_REVIEWED:"true",REGPILOT_AI_INTENDED_USE_REVIEWED:"true",REGPILOT_AI_MODEL:"test/fictional",AI_GATEWAY_API_KEY:"fixture-never-used",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",SUPABASE_SECRET_KEY:"fixture",REGPILOT_EVIDENCE_BUCKET:"fixture",REGPILOT_CLAMD_HOST:"fixture",REGPILOT_AI_DAILY_USER_LIMIT:"10",REGPILOT_AI_DAILY_ORG_LIMIT:"20"});
 const file=await x.file(),q=await createQuestionnaire(x.o,{title:"Fictional recoverable questionnaire",recipient:"Fictional customer",scope:"Fictional UK service",ownerId:x.ed.userId,csv:'reference,question\nQ1,How are fictional assurance documents retained?',confirm:true}),detail=await questionnaireDetail(x.ed,q.id);
 const request={questionId:detail.questions[0].id,questionnaireVersion:1,evidenceIds:[file.id],method:"AI",requestKey:randomUUID(),confirm:true};
 return {...x,file,q,request,async dispose(){await db.aiDailyUsage.deleteMany({where:{organizationId:x.a.id}});await x.cleanup();}};
}
async function grounded(input:any){const file=input.documents[0];return {paragraphs:[{text:"The supplied fictional assurance document is retained for independent review.",citations:[{evidenceId:file.id,unit:1,quote:file.document.pages[0].text}]}],gaps:["The fictional document does not establish operational implementation."],limitations:[]};}

test("failed AI attempts retain history; an explicitly consented concurrent retry invokes the model and meter only once",async()=>{
 const x=await setup();try{
  let calls=0;
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,x.request,{storage:x.store,generate:async()=>{calls++;throw Error("Controlled provider failure");}}),rejects(502));
  const failed=(await questionnaireDrafts(x.ed,x.q.id,{requestKey:x.request.requestKey})).drafts[0];
  assert.equal(failed.status,"FAILED");assert.equal(failed.attempt,1);assert.equal(failed.canRetry,true);
  const original=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:failed.id}});
  await prepareQuestionnaireDraft(x.ed,x.q.id,x.request,{storage:x.store,generate:async args=>{calls++;return grounded(args);}});
  assert.equal(calls,1,"recovering the original request must not re-bill or call the provider");
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...x.request,requestKey:randomUUID()},{storage:x.store}),rejects(409));
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...x.request,requestKey:randomUUID(),retryOfId:randomUUID()},{storage:x.store}),rejects(409));
  const request={...x.request,requestKey:randomUUID(),retryOfId:failed.id},dependencies={storage:x.store,generate:async(input:any)=>{calls++;return grounded(input);}};
  const pair=await Promise.all([prepareQuestionnaireDraft(x.ed,x.q.id,request,dependencies),prepareQuestionnaireDraft(x.ed,x.q.id,request,dependencies)]);
  assert.equal(pair[0].id,pair[1].id);assert.equal(calls,2);
  const retry=await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:pair[0].id}});
  assert.equal(retry.status,"DRAFT");assert.equal(retry.attempt,2);assert.equal(retry.retryOfId,failed.id);assert.equal(retry.inputHash,original.inputHash);
  assert.deepEqual(await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:failed.id}}),original,"a retry must not rewrite the failed attempt");
  assert.equal((await db.aiDailyUsage.aggregate({where:{organizationId:x.a.id},_sum:{count:true}}))._sum.count,2);
  assert.equal((await questionnaireDrafts(x.ed,x.q.id,{requestKey:x.request.requestKey})).drafts[0].canRetry,false,"exact recovery of old failure must discover the later attempt");
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID()},dependencies),rejects(409));
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID(),retryOfId:retry.id},dependencies),rejects(409));
  const events=await db.auditEvent.findMany({where:{organizationId:x.a.id,action:"questionnaire_draft.retry_consented"}});assert.equal(events.length,1);assert.doesNotMatch(JSON.stringify(events),/Fictional assurance document|storageKey/);
 }finally{await x.dispose();}
});

test("three failed attempts are bounded; another company and a changed question owner cannot retry them",async()=>{
 const x=await setup();try{
  let retryOfId:string|undefined,calls=0;
  for(let attempt=1;attempt<=3;attempt++){
   const request={...x.request,requestKey:randomUUID(),...(retryOfId?{retryOfId}:{})};
   await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store,generate:async()=>{calls++;throw Error("Controlled provider outage");}}),rejects(502));
   const failed=(await questionnaireDrafts(x.ed,x.q.id,{requestKey:request.requestKey})).drafts[0];assert.equal(failed.attempt,attempt);assert.equal(failed.canRetry,attempt<3);retryOfId=failed.id;
  }
  const request={...x.request,requestKey:randomUUID(),retryOfId};
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:x.store,generate:grounded}),rejects(409));assert.equal(calls,3);
  await assert.rejects(()=>prepareQuestionnaireDraft(x.out,x.q.id,request,{storage:x.store}),rejects(404));
  const q=await db.assuranceQuestionnaire.findUniqueOrThrow({where:{id:x.q.id}}),questions=structuredClone(q.questions) as any[];questions[0].ownerId=x.re.userId;
  await db.assuranceQuestionnaire.update({where:{id:x.q.id},data:{questions,version:{increment:1}}});
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,questionnaireVersion:2},{storage:x.store}),rejects(404));
  assert.equal(await db.questionnaireDraftRun.count({where:{questionnaireId:x.q.id}}),3);
 }finally{await x.dispose();}
});

test("content preparation retries verify restored original bytes and reject retrying a changed source basis",async()=>{
 const x=await setup();try{
  const request={...x.request,method:"CONTENT_SEARCH"};
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,request,{storage:{...x.store,async get(){return Uint8Array.from([0]);}}}),rejects(409));
  const failed=(await questionnaireDrafts(x.ed,x.q.id,{requestKey:request.requestKey})).drafts[0];assert.equal(failed.canRetry,true);assert.deepEqual(failed.evidenceIds,[x.file.id]);
  const retried=await prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID(),retryOfId:failed.id},{storage:x.store});assert.equal(retried.status,"DRAFT");assert.equal(await db.aiDailyUsage.count({where:{organizationId:x.a.id}}),0);
  await db.evidence.update({where:{id:x.file.id},data:{reviewVersion:{increment:1}}});
  const stale=(await questionnaireDrafts(x.ed,x.q.id,{runId:failed.id})).drafts[0];assert.equal(stale.canRetry,false);assert.deepEqual(stale.evidenceIds,[]);
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID(),retryOfId:failed.id},{storage:x.store}),rejects(409));
  const fresh=await prepareQuestionnaireDraft(x.ed,x.q.id,{...request,requestKey:randomUUID()},{storage:x.store});assert.equal(fresh.status,"DRAFT");assert.equal((await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:fresh.id}})).attempt,1);
 }finally{await x.dispose();}
});

test("an interrupted attempt needs explicit recovery before a retry; a late original result cannot replace its successor",async()=>{
 const x=await setup();let releasePending=()=>{};try{
  let start!:()=>void,finish!:()=>void;
  const started=new Promise<void>(resolve=>{start=resolve;}),release=new Promise<void>(resolve=>{finish=resolve;releasePending=resolve;});
  const pending=prepareQuestionnaireDraft(x.ed,x.q.id,x.request,{storage:x.store,generate:async input=>{start();await release;return grounded(input);}});
  const caught=pending.then(()=>null,error=>error);await Promise.race([started,caught.then(error=>{throw error||Error("Preparation finished before reaching the provider");})]);
  const original=await db.questionnaireDraftRun.findFirstOrThrow({where:{organizationId:x.a.id,requestKey:x.request.requestKey}});
  await assert.rejects(()=>prepareQuestionnaireDraft(x.ed,x.q.id,{...x.request,requestKey:randomUUID(),retryOfId:original.id},{storage:x.store}),rejects(409));
  await db.questionnaireDraftRun.update({where:{id:original.id},data:{createdAt:new Date(Date.now()-180000)}});
  const recovered=(await questionnaireDrafts(x.ed,x.q.id,{runId:original.id})).drafts[0];assert.equal(recovered.failureCode,"INTERRUPTED");assert.equal(recovered.canRetry,true);
  const next=await prepareQuestionnaireDraft(x.ed,x.q.id,{...x.request,requestKey:randomUUID(),retryOfId:original.id},{storage:x.store,generate:grounded});
  finish();assert.equal((await caught).status,409);assert.equal((await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:original.id}})).status,"FAILED");assert.equal((await db.questionnaireDraftRun.findUniqueOrThrow({where:{id:next.id}})).status,"DRAFT");
 }finally{releasePending();await x.dispose();}
});
