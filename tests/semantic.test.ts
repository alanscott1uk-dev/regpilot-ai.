import test from "node:test";
import assert from "node:assert/strict";
import {MockLanguageModelV3} from "ai/test";
import {generateSemantic} from "../lib/server/semantic-model";
import {groundSemanticOutput,type SemanticInput} from "../lib/regulatory/semantic";
import {analysePublication} from "../lib/regulatory/intelligence";

const main="Operators keeping fictional blue widgets retain records for five years, unless they hold an exemption.";
const input:SemanticInput={sourceId:"uk-data-protection",text:main+" This fictional exercise applies only to registered widget keepers in Scotland.",profile:{activities:["personal-data"],jurisdictions:["Scotland"]}};
const proposal={quote:main,kind:"duty",subject:"Registered fictional widget keepers",action:"Review the record retention procedure for fictional blue widgets.",applicabilityReason:"The publication describes record handling; registration and territorial scope are not confirmed.",conditions:["registered widget keepers in Scotland"],exceptions:["unless they hold an exemption"],dateQuotes:[],controlIds:["records"],questions:["Does this fictional registration category apply?"]};
const output=(overrides:Record<string,unknown>={})=>({obligations:[{...proposal,...overrides}],limitations:["Fictional evaluation material only."]});
test("semantic drafts can represent duties without must and retain condition, exception and context anchors",()=>{
  assert.equal(analysePublication(input).candidates.length,0);
  const result=groundSemanticOutput(output(),input),candidate=result.candidates[0];
  assert.equal(candidate.interpretation?.kind,"duty");
  for(const a of [candidate,...candidate.interpretation!.conditions,...candidate.interpretation!.exceptions,candidate.interpretation!.context])assert.equal(input.text.slice(a.start,a.end),a.quote);
  assert.equal(candidate.interpretation!.meaningVerified,false);
  assert.equal(candidate.applicability,"needs-context");
  assert.deepEqual(result.grounding,{proposed:1,retained:1,rejected:0,meaningVerified:false});
});
for(const [name,overrides] of Object.entries({
  "fabricated duty":{quote:"Every operator must report to the invented regulator within seven days."},
  "fabricated exception":{exceptions:["unless the company has fewer than ten staff"]},
  "fabricated condition":{conditions:["if you operate in England"]},
  "invented deadline":{dateQuotes:["before 1 January 2030"]},
  "stitched citation":{quote:main.slice(0,30)+" ... "+main.slice(-30)}
}))test("grounding withholds "+name,()=>{const result=groundSemanticOutput(output(overrides),input);assert.equal(result.candidates.length,0);assert.equal(result.grounding?.rejected,1);});
test("ambiguous repeated quotes are withheld and exemptions remain exemptions",()=>{
  assert.equal(groundSemanticOutput(output(),{...input,text:input.text+main}).candidates.length,0);
  assert.equal(groundSemanticOutput(output({kind:"exemption"}),input).candidates[0].language,"exemption");
});
test("unknown framework IDs, extra properties, and oversized outputs fail the schema",()=>{
  assert.throws(()=>groundSemanticOutput(output({controlIds:["ISO27001-certified"]}),input));
  assert.throws(()=>groundSemanticOutput({...output(),compliant:true},input));
  assert.throws(()=>groundSemanticOutput({...output(),obligations:Array(13).fill(proposal)},input));
});
test("deduplicates identical grounded proposals and computes change from current source text",()=>{
  const result=groundSemanticOutput({...output(),obligations:[proposal,proposal]}, {...input,previousText:"An older fictional publication."});
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].change,"added-or-reworded");assert.equal(result.candidates[0].priority,"review-first");
});
test("SDK structured-output adapter uses a bounded single call with no tools and treats content as untrusted",async()=>{
  let calls=0;
  const model=new MockLanguageModelV3({doGenerate:async options=>{
    calls++;assert.equal(options.maxOutputTokens,5000);assert.equal(options.tools?.length||0,0);
    assert.match(JSON.stringify(options.prompt),/untrusted data/);
    return {content:[{type:"text",text:JSON.stringify(output())}],finishReason:{unified:"stop",raw:undefined},usage:{inputTokens:{total:20,noCache:20,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:20,text:20,reasoning:undefined}},warnings:[]};
  }});
  const result=groundSemanticOutput(await generateSemantic(input,model),input);
  assert.equal(calls,1);assert.equal(result.candidates.length,1);
});
test("a provider failure is not automatically retried",async()=>{
  let calls=0;const model=new MockLanguageModelV3({doGenerate:async()=>{calls++;throw new Error("fictional provider failure");}});
  await assert.rejects(()=>generateSemantic(input,model));assert.equal(calls,1);
});
