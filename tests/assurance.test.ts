import test from "node:test";
import assert from "node:assert/strict";
import {MockLanguageModelV3} from "ai/test";
import {contentAssessment,groundedAssessment,assertPassages,type EvidenceDocument} from "../lib/evidence/assurance";
import {generateAssurance} from "../lib/server/assurance-model";
import {pdfQuoteAnchor,validateAndAnnotateAiOutput} from "../lib/ai/contract.mjs";
const id="123e4567-e89b-42d3-a456-426614174000";
const source="Fictional widget staff must complete documented training before working alone.";
const quote="Widget staff completed training on 4 November 2026 with a supervisor.";
const documents:EvidenceDocument[]=[{id,filename:"fictional.pdf",document:{version:"test",totalPages:2,pages:[{page:1,text:"Our policy promises that widget staff will complete training."},{page:2,text:quote}],characters:150,truncated:false,skippedPages:[],requiresVisualReview:true}}];
const check={criterion:"Demonstrate completed training before unsupervised work",sourceQuote:source,verdict:"SUPPORTED",explanation:"The provided fictional record describes completion; scope and authenticity still require independent assessment.",citations:[{evidenceId:id,page:2,quote}]};
test("content search locates actual page passages without converting a policy promise into proof",()=>{
  const result=contentAssessment(source,documents);
  assert.equal(result.checks[0].verdict,"UNASSESSED");assert.equal(result.passages.length,2);
  for(const p of result.passages)assert.equal(documents[0].document.pages.find(page=>page.page===p.page)!.text.slice(p.start,p.end),p.quote);
  assertPassages(result,documents,[result.passages[0].key]);assert.throws(()=>assertPassages(result,documents,[]));assert.throws(()=>assertPassages(result,documents,["invented"]));
});
for(const [name,changes] of Object.entries({"invented quote":{citations:[{evidenceId:id,page:2,quote:"All staff are verified as fully competent and compliant."}]},"wrong page":{citations:[{evidenceId:id,page:1,quote}]},"wrong file":{citations:[{evidenceId:"223e4567-e89b-42d3-a456-426614174000",page:2,quote}]},"invented source":{sourceQuote:"Every employer must provide records to an invented regulator."},"no supporting quote":{citations:[]}}))test("AI grounding withholds "+name,()=>{
  const result=groundedAssessment({checks:[{...check,...changes}],limitations:[]},source,documents);assert.equal(result.rejectedClaims,1);assert.equal(result.checks[0].verdict,"UNASSESSED");assert.equal(result.checks[0].passageKeys.length,0);
});
test("grounded contradiction remains visible while missing evidence is scoped to the extraction",()=>{
  const contradiction=groundedAssessment({checks:[{...check,verdict:"CONTRADICTED"}],limitations:[]},source,documents);
  assert.equal(contradiction.checks[0].verdict,"CONTRADICTED");assert.equal(contradiction.rejectedClaims,0);
  const missing=groundedAssessment({checks:[{...check,verdict:"NOT_FOUND",citations:[]}],limitations:[]},source,documents);assert.equal(missing.checks[0].verdict,"NOT_FOUND");
});
test("duplicate quotations on one page cannot create a uniquely grounded AI claim",()=>{
  const repeated=[{...documents[0],document:{...documents[0].document,pages:[{page:2,text:quote+" "+quote}]}}];
  assert.equal(groundedAssessment({checks:[check],limitations:[]},source,repeated).rejectedClaims,1);
});
test("PDF AI Studio citations carry page coordinates and repeated cross-page text remains unverified",()=>{
  assert.deepEqual(pdfQuoteAnchor(quote,documents[0].document.pages),{page:2,start:0,end:quote.length,coordinateSystem:"normalised-pdf-page",ambiguous:false});
  const result=validateAndAnnotateAiOutput({findings:[{documentQuote:quote,sourceQuote:source}]},{hadPdf:true,documentPages:documents[0].document.pages,sourceText:source,sourceVerified:true});assert.equal(result.findings[0].grounding,"source-and-document");assert.equal(result.findings[0].documentAnchor.page,2);
  const repeated=[{page:1,text:quote},{page:2,text:quote}];assert.equal(pdfQuoteAnchor(quote,repeated)?.ambiguous,true);
  assert.equal(validateAndAnnotateAiOutput({findings:[{documentQuote:quote}]},{hadPdf:true,documentPages:repeated}).findings[0].documentQuoteMatched,false);
});
test("SDK assessment adapter constrains tools, retries, output and policy-versus-implementation reasoning",async()=>{
  let calls=0;const model=new MockLanguageModelV3({doGenerate:async options=>{calls++;assert.equal(options.tools?.length||0,0);assert.equal(options.maxOutputTokens,4000);assert.match(JSON.stringify(options.prompt),/written intent from proof of implementation/);return {content:[{type:"text",text:JSON.stringify({checks:[check],limitations:[]})}],finishReason:{unified:"stop",raw:undefined},usage:{inputTokens:{total:10,noCache:10,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:10,text:10,reasoning:undefined}},warnings:[]};}});
  const raw=await generateAssurance({sourceQuote:source,documents},model);assert.equal(calls,1);assert.equal(groundedAssessment(raw,source,documents).checks[0].verdict,"SUPPORTED");
});
