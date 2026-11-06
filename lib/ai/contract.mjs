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
 const fields=[["documentText",16000],["question",1500],["businessContext",2500],["sourceId",120],["pdfBase64",2_666_680]];
 for(const [key,max] of fields)if(body[key]!==undefined&&!string(body[key],max))throw new InputError("Invalid or oversized "+key);
 const documentText=(body.documentText||"").trim(),question=(body.question||"").trim(),businessContext=(body.businessContext||"").trim();
 const sourceId=(body.sourceId||"").trim(),pdfBase64=(body.pdfBase64||"").trim();
 if(body.mode==="document"&&documentText.length<40&&!pdfBase64)throw new InputError("Provide at least 40 characters of policy text or a PDF");
 if(body.mode==="change"&&!sourceId)throw new InputError("Choose an official source");
 if(body.mode==="assistant"&&question.length<8)throw new InputError("Enter a question");
 if(pdfBase64&&body.mode!=="document")throw new InputError("PDF is only supported in document review");
 let fileBytes=null;
 if(pdfBase64){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)||pdfBase64.length%4!==0)throw new InputError("Invalid PDF encoding");
  const bytes=Buffer.from(pdfBase64,"base64");
  if(bytes.length<20||bytes.length>MAX_PDF_BYTES||bytes.toString("ascii",0,5)!=="%PDF-")throw new InputError("PDF must be a valid 2 MB-or-smaller file");
  fileBytes=new Uint8Array(bytes);
 }
 return {organizationId:body.organizationId,mode:body.mode,documentText,question,businessContext,sourceId,fileBytes};
}
export function normaliseQuote(quote){return typeof quote==="string"?quote.replace(/\s+/g," ").trim().toLowerCase():""}
export function corroborateQuote(quote,content){
 const q=normaliseQuote(quote);
 return q.length>=12&&typeof content==="string"&&normaliseQuote(content).includes(q);
}
export function validateAndAnnotateAiOutput(output,input){
 const original=Array.isArray(output?.findings)?output.findings:[];
 const findings=original.slice(0,8).map(f=>({
   type:f.type,priority:f.priority,title:f.title,rationale:f.rationale,recommendation:f.recommendation,
   sourceQuote:f.sourceQuote||"",documentQuote:f.documentQuote||"",
   sourceQuoteMatched:corroborateQuote(f.sourceQuote,input.sourceText),
   documentQuoteMatched:!input.hadPdf&&corroborateQuote(f.documentQuote,input.documentText),
   citationStatus:corroborateQuote(f.sourceQuote,input.sourceText)?"source-excerpt-matched":"source-unverified"
 }));
 return {...output,findings,reviewRequired:true,sourceVerified:input.sourceVerified===true,scope:"AI drafts only — independent human assessment required. No legal or compliance conclusion."};
}
export function safeModelName(model){
 if(typeof model!=="string"||model.length>90||!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model))throw new Error("Invalid model configuration");
 return model;
}
