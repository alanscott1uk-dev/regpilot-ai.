import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {MockLanguageModelV3} from "ai/test";
import {groundedQuestionnaireDraft,searchedQuestionnaireDraft,verifyDraftCitations} from "../lib/questionnaire-drafts";
import {generateQuestionnaireDraft} from "../lib/server/questionnaire-draft-model";
import type {EvidenceDocument} from "../lib/evidence/assurance";
const quote="Fictional staff access is reviewed every quarter by the operations manager.";
const documents:EvidenceDocument[]=[{id:randomUUID(),filename:"fictional-access.docx",document:{version:"fixture",format:"DOCX",unitKind:"block",totalPages:1,pages:[{page:1,text:quote}],characters:quote.length,truncated:false,skippedPages:[],requiresVisualReview:true}}];
const raw=()=>({paragraphs:[{text:"Our documented process calls for a quarterly access review by the operations manager.",citations:[{evidenceId:documents[0].id,unit:1,quote}]}],gaps:["The policy does not establish that the latest review was completed."],limitations:[]});
test("questionnaire drafting retains exact Word block citations and separately records implementation gaps",()=>{
 const result=groundedQuestionnaireDraft(raw(),documents);assert.equal(result.status,"DRAFT");assert.equal(result.citations[0].unitKind,"block");assert.equal(result.citations[0].start,0);assert.equal(result.gaps.length,1);verifyDraftCitations(result,documents);
 const broken=structuredClone(result);broken.citations[0].quote="Invented quotation.";assert.throws(()=>verifyDraftCitations(broken,documents),/quotation changed/);
});
test("ungrounded, wrong-company and ambiguous citations withhold the complete proposed paragraph",()=>{
 for(const change of [(r:ReturnType<typeof raw>)=>{r.paragraphs[0].citations[0].evidenceId=randomUUID();},(r:ReturnType<typeof raw>)=>{r.paragraphs[0].citations[0].unit=2;},(r:ReturnType<typeof raw>)=>{r.paragraphs[0].citations[0].quote="A fabricated compliance certification was awarded.";}]){const r=raw();change(r);const result=groundedQuestionnaireDraft(r,documents);assert.equal(result.answer,"");assert.equal(result.status,"INSUFFICIENT_SUPPORT");assert.equal(result.rejectedParagraphs,1);}
 const duplicate=structuredClone(documents);duplicate[0].document.pages[0].text=quote+" "+quote;assert.equal(groundedQuestionnaireDraft(raw(),duplicate).rejectedParagraphs,1);
});
test("content search provides review material without inventing an answer or a sufficiency score",()=>{
 const result=searchedQuestionnaireDraft("How often is staff access reviewed?",documents);assert.equal(result.answer,"");assert.equal(result.status,"INSUFFICIENT_SUPPORT");assert.equal(result.citations.length,1);assert.match(result.gaps[0],/word overlap/);
 const incomplete=structuredClone(documents);incomplete[0].document.truncated=true;assert.throws(()=>searchedQuestionnaireDraft("staff",incomplete),/incomplete/);
});
test("real AI SDK structured generation has no tools, bounded output, exact evidence input and no automatic provider retries",async()=>{
 let calls=0;const model=new MockLanguageModelV3({doGenerate:async options=>{calls++;assert.equal(options.tools?.length||0,0);assert.equal(options.maxOutputTokens,4000);assert.match(JSON.stringify(options.prompt),/UNTRUSTED DATA/);assert.match(JSON.stringify(options.prompt),/quarter/);return {content:[{type:"text",text:JSON.stringify(raw())}],finishReason:{unified:"stop",raw:undefined},usage:{inputTokens:{total:10,noCache:10,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:10,text:10,reasoning:undefined}},warnings:[]};}});
 const output=await generateQuestionnaireDraft({question:"How do you review access?",instructions:"Give frequency and responsibility",scope:"Fictional UK service",documents},model);assert.equal(groundedQuestionnaireDraft(output,documents).status,"DRAFT");assert.equal(calls,1);
 const failing=new MockLanguageModelV3({doGenerate:async()=>{calls++;throw Error("Fictional failure");}});await assert.rejects(()=>generateQuestionnaireDraft({question:"How do you review access?",instructions:"",scope:"Fictional",documents},failing));assert.equal(calls,2);
});
