import test from "node:test";
import assert from "node:assert/strict";
import {validateAiRequest,validateAndAnnotateAiOutput,corroborateQuote,safeModelName,InputError} from "../lib/ai/contract.mjs";
const example={organizationId:"123e4567-e89b-42d3-a456-426614174000",mode:"document",consent:true,documentText:"This is a fictional example policy with details about weekly reviews and quality management.",sourceId:"mhra-safety"};
test("requires an authorised organisation and explicit AI processing consent",()=>{
 assert.throws(()=>validateAiRequest({...example,consent:false}),InputError);
 assert.throws(()=>validateAiRequest({...example,organizationId:"../../other-org"}),InputError);
 assert.equal(validateAiRequest(example).mode,"document");
});
test("rejects oversized data, invalid mode and false PDF content",()=>{
 assert.throws(()=>validateAiRequest({...example,documentText:"x".repeat(16001)}),InputError);
 assert.throws(()=>validateAiRequest({...example,mode:"delete-all"}),InputError);
 assert.throws(()=>validateAiRequest({...example,documentText:"",pdfBase64:Buffer.from("not a pdf").toString("base64")}),InputError);
});
test("permits only PDF magic signature, size bound",()=>{
 const b=Buffer.from("%PDF-1.7\\n1 0 obj\\n<<>>\\nendobj\\n%%EOF").toString("base64");
 assert.equal(validateAiRequest({...example,documentText:"",pdfBase64:b}).fileBytes.length>20,true);
});
test("assistant and regulatory impact have appropriate input constraints",()=>{
 assert.throws(()=>validateAiRequest({...example,mode:"change",sourceId:""}),InputError);
 assert.throws(()=>validateAiRequest({...example,mode:"assistant",question:"Hi"}),InputError);
 assert.equal(validateAiRequest({...example,mode:"assistant",question:"What must be reviewed?"}).mode,"assistant");
});
test("quotes must match supplied source and text, not model assertion",()=>{
 assert.equal(corroborateQuote("annual records should be reviewed","Annual records should be reviewed in a safe way."),true);
 assert.equal(corroborateQuote("fabricated source quote","Annual records should be reviewed."),false);
 const sample={summary:"Draft",findings:[{type:"question",priority:"review",title:"Training review",rationale:"Test",recommendation:"Review",sourceQuote:"fabricated source quote",documentQuote:"This is a fictional example policy"}],suggestedActions:[]};
 const x=validateAndAnnotateAiOutput(sample,{sourceText:"Real source",documentText:example.documentText,sourceVerified:true,hadPdf:false});
 assert.equal(x.findings[0].sourceQuoteMatched,false);
 assert.equal(x.findings[0].documentQuoteMatched,true);
 assert.equal(x.reviewRequired,true);
});
test("PDF quote cannot be independently verified by server text matching",()=>{
 const r=validateAndAnnotateAiOutput({findings:[{documentQuote:"example policy"}]}, {sourceText:"",documentText:"example policy",sourceVerified:false,hadPdf:true});
 assert.equal(r.findings[0].documentQuoteMatched,false);
});
test("model selected from strict provider/model identifier, not user request",()=>{
 assert.equal(safeModelName("openai/gpt-5.4-mini"),"openai/gpt-5.4-mini");
 assert.throws(()=>safeModelName("http://unknown"),/Invalid model/);
});

test("saving a review is opt-in only and cannot be spoofed as a string",()=>{
 assert.equal(validateAiRequest({...example}).retainDraft,false);
 assert.equal(validateAiRequest({...example,retainDraft:true}).retainDraft,true);
 assert.throws(()=>validateAiRequest({...example,retainDraft:"true"}),InputError);
});

test("model-produced action and amendment source quotations are independently checked",()=>{
 const ai={summary:"Provisional",findings:[],
  suggestedActions:[{title:"Review",sourceQuote:"This requirement is mandatory."}],
  suggestedAmendments:[{section:"Training",supportingSourceQuote:"A fabricated government legal quote"}]};
 const result=validateAndAnnotateAiOutput(ai,{
  sourceText:"This requirement is mandatory.",documentText:"",sourceVerified:true,hadPdf:false
 });
 assert.equal(result.suggestedActions[0].sourceQuoteMatched,true);
 assert.equal(result.suggestedAmendments[0].supportingSourceQuoteMatched,false);
 const offline=validateAndAnnotateAiOutput(ai,{
  sourceText:"This requirement is mandatory.",documentText:"",sourceVerified:false,hadPdf:false
 });
 assert.equal(offline.suggestedActions[0].sourceQuoteMatched,false);
});
