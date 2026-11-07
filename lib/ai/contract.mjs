export const AI_MODES=Object.freeze(["document","change","assistant"]);
export const MAX_PDF_BYTES=2_000_000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types=new Set(AI_MODES);
const string=(v,max)=>typeof v==="string"&&v.length<=max;
export class InputError extends Error {constructor(message){super(message);this.name="InputError"}}
export function validateAiRequest(body){
 if(!body||typeof body!=="object"||Array.isArray(body))throw new InputError("Invalid request");
 if(!uuid.test(body.organizationId||""))throw new InputError("Choose an authorised organisation");
 if(!types.has(body.mode))throw new InputError("Unknown AI workflow");
 if(body.consent!==true)throw new InputError("Agree to send fictional/non-sensitive content to the external AI provider");
 if(body.retainDraft!==undefined&&typeof body.retainDraft!=="boolean")throw new InputError("Invalid saving preference");
 const fields=[["documentText",16000],["question",1500],["businessContext",2500],["sourceId",120],["evidenceId",60],["pdfBase64",2_666_680],["docxBase64",2_666_680]];
 for(const [key,max] of fields)if(body[key]!==undefined&&!string(body[key],max))throw new InputError("Invalid or oversized "+key);
 const documentText=(body.documentText||"").trim(),question=(body.question||"").trim(),businessContext=(body.businessContext||"").trim();
 const docxBase64=(body.docxBase64||"").trim();
 const sourceId=(body.sourceId||"").trim(),pdfBase64=(body.pdfBase64||"").trim(),evidenceId=(body.evidenceId||"").trim();
 if(evidenceId&&!uuid.test(evidenceId))throw new InputError("Invalid private evidence ID");
 if(evidenceId&&body.mode!=="document")throw new InputError("Evidence references are only valid for document review");
 if([!!evidenceId,!!pdfBase64,!!docxBase64].filter(Boolean).length>1)throw new InputError("Choose one uploaded document or an existing evidence file");
 if(body.mode==="document"&&documentText.length<40&&!pdfBase64&&!docxBase64&&!evidenceId)throw new InputError("Provide at least 40 characters of policy text or a PDF");
 if(body.mode==="change"&&!sourceId)throw new InputError("Choose an official source");
 if(body.mode==="assistant"&&question.length<8)throw new InputError("Enter a question");
 if((pdfBase64||docxBase64)&&body.mode!=="document")throw new InputError("PDF is only supported in document review");
 let fileBytes=null;
 if(docxBase64){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(docxBase64)||docxBase64.length%4!==0)throw new InputError("Invalid Word encoding");
  const bytes=Buffer.from(docxBase64,"base64");
  if(bytes.length<30||bytes.length>MAX_PDF_BYTES||bytes.readUInt32LE(0)!==0x04034b50)throw new InputError("Word file must be a valid 2 MB-or-smaller .docx");
  fileBytes=new Uint8Array(bytes);
 }
 if(pdfBase64){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)||pdfBase64.length%4!==0)throw new InputError("Invalid PDF encoding");
  const bytes=Buffer.from(pdfBase64,"base64");
  if(bytes.length<20||bytes.length>MAX_PDF_BYTES||bytes.toString("ascii",0,5)!=="%PDF-")throw new InputError("PDF must be a valid 2 MB-or-smaller file");
  fileBytes=new Uint8Array(bytes);
 }
 return {organizationId:body.organizationId,mode:body.mode,documentText,question,businessContext,sourceId,evidenceId,fileBytes,fileFormat:docxBase64?"DOCX":"PDF",retainDraft:body.retainDraft===true};
}
export function normaliseQuote(quote){return typeof quote==="string"?quote.replace(/\s+/g," ").trim().toLowerCase():""}
export function corroborateQuote(quote,content){
 const q=normaliseQuote(quote);
 return q.length>=12&&typeof content==="string"&&normaliseQuote(content).includes(q);
}
// Coordinates refer to whitespace-normalised, lower-case text, never PDF pages.
export function quoteAnchor(quote,content){
 const q=normaliseQuote(quote),text=normaliseQuote(content),start=q.length>=12?text.indexOf(q):-1;
 if(start<0)return null;
 return {start,end:start+q.length,coordinateSystem:"normalised-text",ambiguous:text.indexOf(q,start+1)>=0};
}
export function pdfQuoteAnchor(quote,pages){
 const matches=[];
 for(const page of Array.isArray(pages)?pages:[]){const anchor=quoteAnchor(quote,page.text);if(anchor)matches.push({...anchor,page:page.page,coordinateSystem:"normalised-pdf-page"});}
 if(!matches.length)return null;
 return {...matches[0],ambiguous:matches.length!==1||matches[0].ambiguous};
}
export function validateAndAnnotateAiOutput(output,input){
 const anchoredDocument=input.hadPdf||input.documentUnitKind==="block";
 const anchor=(quote)=>{const result=pdfQuoteAnchor(quote,input.documentPages);if(!result||input.documentUnitKind!=="block")return result;return {...result,coordinateSystem:"normalised-word-block",label:input.documentPages.find(p=>p.page===result.page)?.label};};
 const original=Array.isArray(output?.findings)?output.findings:[];
 const findings=original.slice(0,8).map(f=>({
   type:f.type,priority:f.priority,title:f.title,rationale:f.rationale,recommendation:f.recommendation,
   sourceQuote:f.sourceQuote||"",documentQuote:f.documentQuote||"",
   sourceQuoteMatched:input.sourceVerified===true&&corroborateQuote(f.sourceQuote,input.sourceText),
   documentQuoteMatched:anchoredDocument?!!anchor(f.documentQuote)&&!anchor(f.documentQuote).ambiguous:corroborateQuote(f.documentQuote,input.documentText),
   citationStatus:input.sourceVerified===true&&corroborateQuote(f.sourceQuote,input.sourceText)?"official-excerpt-text-matched":"source-unverified"
 })).map(f=>{
  const grounding=f.sourceQuoteMatched&&f.documentQuoteMatched?"source-and-document":f.sourceQuoteMatched?"source-only":f.documentQuoteMatched?"document-only":"unverified";
  return {...f,grounding,sourceAnchor:f.sourceQuoteMatched?quoteAnchor(f.sourceQuote,input.sourceText):null,
   documentAnchor:anchoredDocument?anchor(f.documentQuote):f.documentQuoteMatched?quoteAnchor(f.documentQuote,input.documentText):null,
   reviewChecks:[
    ...(!f.sourceQuoteMatched?["Locate an authoritative source for this finding before treating it as a requirement."]:[]),
    ...(!f.documentQuoteMatched?[anchoredDocument?"The quotation was not uniquely located in the extracted document text. Check the original file, including images and tables.":"Locate the supporting passage in the document, or establish that this is a question about missing evidence."]:[]),
    "Confirm the cited passages support the proposed conclusion; a text match does not prove entailment.",
    "Confirm applicability, exceptions and effective dates with the responsible reviewer."
   ]};
 });
 const suggestedActions=(Array.isArray(output?.suggestedActions)?output.suggestedActions:[]).slice(0,5).map(s=>({
  ...s,sourceQuoteMatched:input.sourceVerified===true&&corroborateQuote(s.sourceQuote,input.sourceText)
 }));
 const suggestedAmendments=(Array.isArray(output?.suggestedAmendments)?output.suggestedAmendments:[]).slice(0,3).map(s=>({
  ...s,supportingSourceQuoteMatched:input.sourceVerified===true&&corroborateQuote(s.supportingSourceQuote,input.sourceText)
 }));
 const groundingSummary={findings:findings.length,dualTextMatches:findings.filter(f=>f.grounding==="source-and-document").length,unverified:findings.filter(f=>f.grounding==="unverified").length,pdfRequiresManualCheck:input.hadPdf===true,pdfTextExtracted:Array.isArray(input.documentPages)&&input.documentPages.some(page=>typeof page.text==="string"&&page.text.trim().length>0),...(input.documentCoverage?(input.documentUnitKind==="block"?{documentCoverage:input.documentCoverage}:{pdfCoverage:input.documentCoverage}):{}),meaningVerified:false};
 return {...output,findings,suggestedActions,suggestedAmendments,groundingSummary,reviewRequired:true,sourceVerified:input.sourceVerified===true,scope:"AI drafts only — independent human assessment required. No legal or compliance conclusion."};
}
export function safeModelName(model){
 if(typeof model!=="string"||model.length>90||!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model))throw new Error("Invalid model configuration");
 return model;
}
